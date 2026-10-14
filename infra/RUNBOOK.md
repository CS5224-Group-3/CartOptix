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
`cdk deploy`. The release defaults to `HEAD`. To run an earlier image, or to
deploy an infra-only branch before it merges, set `RELEASE=<sha>`. That is
allowed only when `apps/` and `packages/` are identical at both commits, so the
frontend always matches the API.

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

This deletes everything in the stack, including the database and the frontend
bucket. The ECR images and the `CDKToolkit` stack stay. Check that nothing is
left:

```bash
aws cloudformation describe-stacks --stack-name CartOptixPresentation   # "does not exist"
aws rds describe-db-instances --query 'DBInstances[].DBInstanceIdentifier'
```

## Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| `Your session has expired` | Run `aws login --profile cartoptix`. |
| `deploy: no cartoptix-api image for <sha>` | That commit has not landed on `main`, or its Release run failed. Deploy a released commit, or set `RELEASE`. |
| `deploy: apps/ or packages/ differ` | `RELEASE` points at a commit whose app code differs from your checkout. Check out that commit instead. |
| Deploy fails with `Received 0 SUCCESS signal(s)` | An instance's boot script failed or the API never answered `/health/live`. Read `/var/log/cloud-init-output.log` on the instance through Session Manager before the rollback terminates it, or the instance's log stream. |
| `/health/ready` returns 503 | The API cannot reach RDS. Check the API log stream for the connection error. |
| `/api/v1/...` returns 500 on a new stack | The database is empty. Load it, above. |
| CloudFront returns 502 or 504 for `/api/*` | No healthy instance behind the ALB. Check the target group's health in the EC2 console. |
| `start-session` is denied | Your user lacks `ssm:StartSession` on the instance. Ask the admin. |
