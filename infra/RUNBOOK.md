# Presentation stack runbook

Issue #20. How to deploy, load, check, scale and destroy the presentation
stack (`CartOptixPresentation`). The architecture and its limitations are in the
[technical spec](../docs/technical-implementation-spec.md), section 2.

The stack runs only while someone is working on it or presenting. **Destroy it at
the end of every working session**, and keep the development host stopped while
it is up. It is deployed from an engineer's machine only, never from CI.

## What gets deployed

| Part | Detail |
| --- | --- |
| Frontend | `apps/web/dist`, built from your checkout, uploaded to a private S3 bucket and served by CloudFront |
| API | `cartoptix-api:<release>` from ECR, one Docker container per EC2 `t4g.micro` instance in an Auto Scaling Group (max 3) |
| Release | a full commit SHA whose image the Release workflow has already published, which means it has landed on `main` |
| Database | RDS PostgreSQL 18.6, `db.t4g.micro`, Single-AZ, no backups. Empty until you load it, below |
| Entry point | `https://<id>.cloudfront.net`, printed as the `Url` output. `/api/*` and `/health/*` go to the API, uncached; everything else is the frontend |
| Observability | A CloudWatch dashboard and five alarms, printed as the `Dashboard` output. Logs are kept three days |
| Spending alert | A separate `CartOptixGuardrails` stack, deployed once and **not** destroyed between sessions |

## Network design

The layout is chosen for cost, with security groups doing the isolation.

| Tier | Subnets | Reachable from |
| --- | --- | --- |
| ALB | isolated, no public address | CloudFront only: an internal ALB behind a CloudFront VPC origin, with ingress limited to CloudFront's origin-facing prefix list |
| API instances | public, each with a public IPv4 address | the ALB's security group only, on the API port. No SSH; administration goes through Session Manager |
| RDS | isolated, no public address | the API instances' security group only, on 5432. No outbound access |

The API instances need outbound access to ECR, Systems Manager, Secrets Manager,
CloudWatch Logs and the package mirrors at boot. Public subnets give them that
through the internet gateway for about USD 0.12 a day per instance (public IPv4).
The alternatives, which would let the instances sit in private subnets, are a
NAT gateway (about USD 1.40 a day plus data processing) or an interface
endpoint per service (about USD 0.30 a day per endpoint per AZ, so roughly
USD 3 a day for five services across two AZs). Approximate on-demand prices for
`ap-southeast-1`; check current pricing before relying on them.

The trade-off: the instances have public addresses, so their protection rests on
the security group. The API port is open on the instance itself, but the group
drops any inbound traffic that doesn't come from the ALB, and no other port is
allowed. For a long-lived production deployment, move the instances to private
subnets behind a NAT gateway or VPC endpoints.

## Prerequisites (once)

- Node 24 and pnpm, as in the [README](../README.md); run `pnpm install` at the root.
- AWS CLI v2 with a `cartoptix` profile: `aws login --profile cartoptix`. Repeat it
  whenever a command reports an expired session.
- The [Session Manager plugin](https://docs.aws.amazon.com/systems-manager/latest/userguide/session-manager-working-with-install-plugin.html)
  and `jq`, for the database tunnel.
- From the account admin, once: `cdk bootstrap` for `ap-southeast-1`, permission to
  assume the `cdk-hnb659fds-*` roles, and, for the tunnel, `ssm:StartSession` on
  the stack's instances and `secretsmanager:GetSecretValue` on its database
  secret. See the admin request on #20.

Once per project, deploy the spending alert. It is a separate stack on purpose:
`pnpm destroy` tears down the presentation stack after every session, and an
alert that went with it would be absent whenever nothing is being watched.

```bash
ALERT_EMAIL=you@example.com pnpm --filter @cartoptix/infra deploy:budget
```

Then activate the cost allocation tag, or the budget reports zero spend forever:
**Billing and Cost Management -> Cost allocation tags -> user-defined ->
`Project` -> Activate**. Activation is not retroactive.

Helper used below, from the repository root:

```bash
export AWS_PROFILE=cartoptix
out() { aws cloudformation describe-stacks --stack-name CartOptixPresentation \
  --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue" --output text; }
```

## Deploy

From a clean checkout:

```bash
pnpm --filter @cartoptix/infra run deploy                   # one instance, while building
MIN_INSTANCES=2 pnpm --filter @cartoptix/infra run deploy    # evaluation and the presentation
```

`scripts/deploy.sh` refuses to run with uncommitted changes, checks that
`cartoptix-api:<release>` exists in ECR, builds the frontend and runs
`cdk deploy`. The release defaults to `HEAD`. Only the API comes from the
release's image; the frontend is always built from your checkout. To run an
earlier image, or to deploy an infra-only or web-only branch before it merges,
set `RELEASE=<sha>`. That is allowed only when `apps/api` and `packages/` are
identical at both commits, so the API and the shared contracts match the
frontend.

CDK asks for confirmation before adding IAM or security-group permissions. A
first deploy takes about 15 minutes, mostly RDS and CloudFront. Creation waits
until every instance's API answers `/health/live`.

A redeploy with a different release replaces instances one at a time and waits
for each new one to report healthy; if one fails, CloudFormation rolls the stack
back to the previous release. Changing only `MIN_INSTANCES` resizes the group
without replacing instances.

## Load the database (once per stack)

The database is private, so connect through an SSM tunnel via one of the app
instances. Migrations and the seed import come from a checkout of the release
the stack runs.

Terminal 1, the tunnel (leave it open):

```bash
group=$(out AutoScalingGroupName)
instance=$(aws autoscaling describe-auto-scaling-groups --auto-scaling-group-names "$group" \
  --query 'AutoScalingGroups[0].Instances[?LifecycleState==`InService`]|[0].InstanceId' --output text)
aws ssm start-session --target "$instance" \
  --document-name AWS-StartPortForwardingSessionToRemoteHost \
  --parameters "host=$(out DatabaseEndpoint),portNumber=5432,localPortNumber=15432"
```

Terminal 2, from the repository root at the deployed release (`git checkout "$(out Release)"`):

```bash
secret=$(aws secretsmanager get-secret-value --secret-id "$(out DatabaseSecretArn)" \
  --query SecretString --output text)
# no-verify: the certificate names the RDS host, not localhost. The tunnel itself is encrypted.
export DATABASE_URL=$(jq -r '"postgresql://\(.username):\(.password|@uri)@localhost:15432/\(.dbname)?sslmode=no-verify"' <<<"$secret")
pnpm --filter @cartoptix/api db:migrate
pnpm --filter @cartoptix/api seed:import data/seed/seed.json
```

Run `db:migrate` again whenever a new release adds a migration. Re-importing the
seed replaces the catalogue in one transaction.

## Smoke checks

```bash
url=$(out Url)
curl -i "$url/health/live"                   # 200, {"status":"ok"}
curl -i "$url/health/ready"                  # 200; 503 means the API cannot reach RDS
curl -i "$url/api/v1/catalogue"              # 200 once the seed is loaded
curl -i "$url/api/v1/products?page=1&pageSize=5"
curl -I "$url/"                              # 200, the frontend
```

Then open the URL in a browser and run a basket comparison.

Which release each instance runs:

```bash
aws ec2 describe-instances \
  --filters "Name=tag:aws:autoscaling:groupName,Values=$(out AutoScalingGroupName)" \
            "Name=instance-state-name,Values=running" \
  --query 'Reservations[].Instances[].[InstanceId,LaunchTime]' --output table
out Release
```

API logs are in CloudWatch Logs, one stream per instance, kept for three days.

## Observability (#21)

`out Dashboard` prints the CloudWatch dashboard link. Six widgets, in the order
a problem is usually diagnosed:

| Widget | Answers |
| --- | --- |
| Requests and failures | Is the service taking traffic, and is anything 5xx? ALB 5xx with no target 5xx means no healthy instance, not an application bug |
| Latency against SC-05 | ALB p50/p99 in seconds, comparison p99 in milliseconds on the right axis. A gap between them is time spent outside the comparison |
| Comparison outcomes | Recommended against no-feasible-plan, and clicks that never reached storage |
| Capacity and target health | Desired against in-service instances, with the costed maximum of 3 marked. This is what a scaling experiment is read from |
| CPU and burst credits | A `t4g.micro` that exhausts credits gets slower, not broken, so latency rises with no error anywhere |
| Database connections | Measured connections against the 18 that three instances demand, and against the pinned `max_connections` of 100 |

Five alarms are created, and none of them notify anyone. The stack runs for a
working session with an engineer watching the dashboard, and the one thing that
must reach someone who is not watching is money, which the budget handles. The
alarms are on-screen state and evidence for #22:
`TargetFailures`, `ComparisonLatency`, `UnhealthyTargets`, `DatabaseConnections`,
`DatabaseCpuCredits`.

### Connection budget

One instance holds at most six connections: four in the comparison pool
(`apps/api/src/database.ts`) and two in the click recorder's own pool
(`apps/api/src/events/outbound-click.ts`). Three instances therefore demand 18,
against a pinned ceiling of 100, leaving room for the migration tunnel and
PostgreSQL's reserved superuser slots. **Changing either pool size changes this
budget**: update `CONNECTIONS_PER_INSTANCE` in `src/presentation-stack.ts` to
match, or the dashboard annotation and the leak alarm both become wrong.

### Calibrating the scaling policy

The policy holds a target of requests per minute per instance. The default of
300 is a starting point reasoned from the load model, **not a measurement**.
Calibrate it once, with the stack deployed at `MIN_INSTANCES=1`:

1. Drive a steady, increasing request rate at `out Url` and watch the latency
   widget. Find the rate at which one instance's ALB p99 reaches the SC-05 bound
   of two seconds, or at which its CPU credit balance starts falling.
2. Take about 70% of that rate as the per-instance target, so an instance scales
   out before it degrades rather than after.
3. Redeploy with it, and record the measured figure and the date in the #21
   thread:

   ```bash
   TARGET_RPM=<measured> pnpm --filter @cartoptix/infra deploy
   ```

4. Confirm both directions: hold a load above the target until a second instance
   is in service, then stop and confirm scale-in. Scale-out reacts within roughly
   three minutes; a new instance needs around eight more before it serves traffic
   (`estimatedInstanceWarmup`), and scale-in waits five minutes (`cooldown`).

Record the calibrated value, the run it came from and the observed scale-out and
scale-in times. Until that is done, the policy is configured but not calibrated,
and #21's first acceptance criterion is not met.

## Destroy

Dump anything worth keeping first; the database has no backups. With the tunnel
open and `DATABASE_URL` set as above:

```bash
pg_dump "$DATABASE_URL" --data-only --table=click_events > "click-events-$(date +%F).sql"
```

Then:

```bash
pnpm --filter @cartoptix/infra run destroy
```

This deletes everything in the presentation stack, including the database, the
frontend bucket, the dashboard and the alarms. The ECR images, the `CDKToolkit`
stack and `CartOptixGuardrails` stay: the script names the presentation stack
explicitly, because a bare `cdk destroy` would take the spending alert with it
and leave the account unwatched. Check what is left:

```bash
aws cloudformation describe-stacks --stack-name CartOptixPresentation   # "does not exist"
aws cloudformation describe-stacks --stack-name CartOptixGuardrails \
  --query 'Stacks[0].StackStatus'                                      # still CREATE_COMPLETE
aws rds describe-db-instances --query 'DBInstances[].DBInstanceIdentifier'
```

## Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| `Your session has expired` | Run `aws login --profile cartoptix`. |
| `deploy: no cartoptix-api image for <sha>` | That commit has not landed on `main`, or its Release run failed. Deploy a released commit, or set `RELEASE`. |
| `deploy: apps/api or packages/ differ` | `RELEASE` points at a commit whose API or contracts differ from your checkout. Check out that commit, or deploy after your change lands on `main` and its image is published. |
| Deploy fails with `Received 0 SUCCESS signal(s)` | An instance's boot script failed or the API never answered `/health/live`. Read `/var/log/cloud-init-output.log` on the instance through Session Manager before the rollback terminates it, or the instance's log stream. |
| `/health/ready` returns 503 | The API cannot reach RDS. Check the API log stream for the connection error. |
| `/api/v1/...` returns 500 on a new stack | The database is empty. Load it, above. |
| CloudFront returns 502 or 504 for `/api/*` | No healthy instance behind the ALB. Check the target group's health in the EC2 console. |
| `start-session` is denied | Your user lacks `ssm:StartSession` on the instance. Ask the admin. |
