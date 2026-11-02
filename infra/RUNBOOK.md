# Presentation stack runbook

Issue #20. How to deploy, load, check, scale and destroy the presentation
stack (`CartOptixPresentation`). The architecture and its limitations are in the
[technical spec](../docs/technical-implementation-spec.md), section 2.

The stack runs only while someone is working on it, testing it or presenting.
**Destroy it when it is not in use, checked daily.** Engineers create and destroy
the stack; CI deploys application releases only to an existing stack and cannot
change unrelated infrastructure.

## What gets deployed

| Part | Detail |
| --- | --- |
| Frontend | `apps/web/dist`, built from the release commit and uploaded to a private S3 bucket; served by CloudFront |
| API | `cartoptix-api:<release>` from ECR, one Docker container per EC2 `t4g.micro` instance in an Auto Scaling Group (max 3) |
| Release identity | Full commit SHAs tracked separately by the `Release`, `WebRelease` and `InfraRelease` outputs |
| Database | RDS PostgreSQL 18.6, `db.t4g.micro`, Single-AZ, no backups. Empty until you load it, below |
| Entry point | `https://cartoptix.hellodon.dev`, printed as the `Url` output. `/api/*` and `/health/*` go to the API, uncached; everything else is the frontend |
| TLS | Reused ACM certificates or separately managed certificate stacks, private ALB HTTPS listener, nginx HTTPS on each instance, HTTP only over EC2 loopback (#92) |
| Observability | A CloudWatch dashboard and five alarms, printed as the `Dashboard` output. Logs are kept three days |
| Spending alert | A separate `CartOptixGuardrails` stack, deployed once and **not** destroyed between sessions |

## Network design

The layout is chosen for cost, with security groups doing the isolation.

| Tier | Subnets | Reachable from |
| --- | --- | --- |
| ALB | isolated, no public address | CloudFront only on 443: an internal ALB behind an HTTPS-only CloudFront VPC origin, with ingress limited to CloudFront's origin-facing prefix list |
| API instances | public, each with a public IPv4 address | the ALB's security group only, on nginx's HTTPS port 443. Docker publishes API port 3001 only on host loopback. No SSH; administration goes through Session Manager |
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
the security group. Only nginx's HTTPS port accepts ALB traffic; the API port is
bound to loopback, and no other ingress is allowed. For a long-lived production deployment, move the instances to private
subnets behind a NAT gateway or VPC endpoints.

The ALB encrypts target connections but **does not validate target certificates**.
Each instance generates its own self-signed certificate and root-only key at boot;
the security boundary is the VPC plus ALB-only ingress, not certificate-authenticated
backend identity. Certificates last 90 days, beyond the 13 November teardown;
do not extend this deployment past that validity without a rotation design.

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
- For application releases, separate GitHub OIDC roles for ECR publishing and
  presentation deployment, plus the repository variables `AWS_PUBLISH_ROLE_ARN`
  and `AWS_DEPLOY_ROLE_ARN`. The deploy role is trusted only for this repository's `main` branch. See
  [CI application releases](#ci-application-releases).

Once per project, deploy the spending alert. It is a separate stack on purpose:
`pnpm destroy` tears down the presentation stack whenever it is idle, and an
alert that went with it would be absent whenever nothing is being watched.

```bash
ALERT_EMAIL=you@example.com pnpm --filter @cartoptix/infra deploy:budget
```

Then activate the cost allocation tag, or the budget reports zero spend forever:
**Billing and Cost Management -> Cost allocation tags -> user-defined ->
`Project` -> Activate**. Activation is not retroactive.

Two limits on what this alert can tell you early:

- The budget notifies at 80% of actual spend and at 100% of forecast. AWS needs
  several weeks of usage history before it will forecast at all, so in the
  project's first weeks **expect only the 80% actual alert to fire**. Treat the
  forecast notification as something that starts working later, not as cover
  for the opening weeks.
- Billing data lags by several hours, so neither notification is immediate.
  Neither replaces destroying the stack when it is idle.

Helper used below, from the repository root:

```bash
export AWS_PROFILE=cartoptix
out() { aws cloudformation describe-stacks --stack-name CartOptixPresentation \
  --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue" --output text; }
```

## Deploy

### TLS setup and DNS (engineer only, #92)

Implementation does not authorise deployment or DNS changes. Schedule the accepted
maintenance window first. Keep the existing domain and unrelated DNS records intact.
The `hellodon.dev` nameservers were Namecheap's `registrar-servers.com` when checked;
verify they still are before editing **Advanced DNS**. `.dev` browsers require HTTPS.

1. Ask the AWS account administrator to bootstrap **us-east-1** as well as Singapore,
   and grant the engineer certificate/CloudFormation deployment permissions there.
   The US region hosts only CloudFront's required viewer certificate, not application compute.
2. **Check for existing certificates before requesting any.** Reuse the teammate-created
   certificates used for the 2 November cutover: viewer in `us-east-1`, private origin in
   `ap-southeast-1`. In ACM, verify each certificate is **Issued**, covers its intended
   hostname, and is a standard non-exportable public certificate. Record its ARN, region,
   owner, validation records and whether a CloudFormation stack manages it in the private
   deployment inventory. Do not publish that inventory or validation values in issues.
   Passing an ARN to the presentation stack does not transfer certificate ownership.

   For a reused certificate, skip issuance below. Only if a suitable certificate is
   missing, obtain approval to issue it. From `infra/`, deploy only the missing certificate
   stack (one at a time):

   ```bash
   pnpm exec cdk deploy CartOptixViewerCertificate --app 'node bin/certificates.ts' --output cdk.out-certificates
   pnpm exec cdk deploy CartOptixOriginCertificate --app 'node bin/certificates.ts' --output cdk.out-certificates
   ```

   Each deploy waits for DNS validation. While it waits, open ACM in the corresponding
   region, find the pending certificate, and copy its validation CNAME name/value into
   Namecheap. Enter the host relative to `hellodon.dev` (do not append the domain twice).
   Do not use a URL redirect record. Check any existing CAA restrictions allow Amazon
   certificate issuance; do not delete unrelated CAA records. Wait for **Issued** and
   stack completion; the `CertificateArn` output is the input below. Use standard
   non-exportable ACM public certificates, not paid exportable certificates or Private CA.
3. For reused certificates, set `VIEWER_CERTIFICATE_ARN` and `ORIGIN_CERTIFICATE_ARN`
   in the deployment shell from the verified private inventory or ACM console. Do not
   create certificate stacks just to obtain outputs. Only for certificates actually
   owned by the repository's certificate stacks, export the corresponding stack outputs:

   ```bash
   export VIEWER_CERTIFICATE_ARN=$(aws cloudformation describe-stacks --region us-east-1 --stack-name CartOptixViewerCertificate --query 'Stacks[0].Outputs[?OutputKey==`CertificateArn`].OutputValue' --output text)
   export ORIGIN_CERTIFICATE_ARN=$(aws cloudformation describe-stacks --region ap-southeast-1 --stack-name CartOptixOriginCertificate --query 'Stacks[0].Outputs[?OutputKey==`CertificateArn`].OutputValue' --output text)
   ```

4. Deploy the presentation stack using the commands below. For an existing HTTP stack,
   use the [staged migration](#initial-http-to-https-migration) instead of a direct update.
   Skip that migration for fresh creation or an already-HTTPS stack. Add/update these
   **routing CNAMEs** using the presentation stack's
   `OriginDnsTarget` and `ViewerDnsTarget` outputs (values are hostnames, not URLs):

   | Namecheap host | Target |
   | --- | --- |
   | `cartoptix-origin` | internal ALB DNS name (`OriginDnsTarget`) |
   | `cartoptix` | distribution DNS name (`ViewerDnsTarget`) |

   On a first creation, the ALB exists before the distribution finishes. If origin DNS
   is needed while CloudFront is provisioning, obtain the ALB DNS name from the EC2
   load balancer console and add `cartoptix-origin` then. Publishing the private ALB's
   DNS name does not make it internet-reachable. On daily recreation both AWS target
   names can change: replace stale routing records, and wait for DNS propagation.
5. Complete the TLS and application smoke checks below before ending maintenance.

These are standard ACM certificates attached to AWS services, with no additional
certificate charge. Existing domain registration is reused; no Route 53 hosted zone,
Private CA or new domain is provisioned. nginx uses the existing instances; its CPU,
memory and boot-time impact still need measurement. Do not claim the SGD 84 budget
or previous load-test performance has been revalidated by this change.

### Create or update the presentation stack

For fresh creation or an already-HTTPS stack, from a clean checkout (an existing HTTP
stack requires the staged migration below first):

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
until every instance serves `/health/live` through nginx over HTTPS. The boot probe
trusts that instance's exact self-signed certificate and checks its SAN, not `--insecure`.

`VIEWER_CERTIFICATE_ARN` and `ORIGIN_CERTIFICATE_ARN` are required by the engineer's
deploy script. CloudFormation validates their regions and stores them as stack
parameters. CI application releases use the previous parameter values and the existing
change-set guard rejects parameter changes; CI never issues certificates or edits DNS.

### Cutover and rollback

Before the first TLS update, record the deployed `Release`, `WebRelease`, `InfraRelease`,
capacity/scaling settings, both routing records (if present), and the prior CloudFront URL.
Back up required click events. Announce a maintenance window: replacing the target group
and updating CloudFront can temporarily interrupt API traffic even with rolling instances.

#### Initial HTTP-to-HTTPS migration

This is a one-time engineer operation, not a CI application release. The 2 November
cutover is complete; **do not repeat these steps on the healthy HTTPS stack**. Fresh
TLS stack creation does not need them either.

The CloudFront origin-facing managed prefix list consumes **55 security-group rule
slots per rule**. CloudFormation can add the new 443 ingress before deleting the old
80 ingress, exceeding the default 60-rule quota. The initial direct update failed with
`The maximum number of rules per security group has been reached.` Use two reviewed
CloudFormation change sets, not a quota increase or an out-of-band security-group edit:

1. **Capture the rollback baseline.** Save the deployed original template, stack
   parameters (including SSM parameter keys and resolved values), outputs, current
   launch-template version/AMI, releases, capacity/scaling settings and routing records.
   Preserve required click events. Use encrypted private storage, not Git or public
   comments. Pause concurrent engineer/CI deployments for both phases.
2. **Prepare phase 1 from the deployed template, not the new TLS template.** Remove
   only the standalone `AWS::EC2::SecurityGroupIngress` resource allowing port 80 from
   the CloudFront prefix list into the ALB security group. Leave the HTTP listener,
   target group, distribution, instance configuration and other rules unchanged.
   Temporarily change the launch-template AMI parameter from
   `AWS::SSM::Parameter::Value<AWS::EC2::Image::Id>` to `String` and explicitly pass
   the AMI ID used by the current launch-template version. Preserve its parameter
   name and references. `UsePreviousValue` on an SSM parameter preserves its **key**,
   but refreshes its resolved value; it can otherwise trigger an unwanted rollout.
3. **Review and execute phase 1.** Create an UPDATE change set using that temporary
   template, the pinned AMI value and all other existing parameter values. Compare the
   templates and inspect resource changes: the sole resource change must be removal
   of the old 80 prefix-list ingress. If a launch-template/ASG modification, replacement
   or any unrelated change appears, discard the change set and investigate. Execute
   only after review, then wait for `UPDATE_COMPLETE`. API traffic is interrupted
   until phase 2 completes; this is part of the accepted maintenance window.
4. **Prepare phase 2 from the unmodified TLS release template.** Build/package its
   assets using frontend sources matching the recorded web release, and synthesise
   with the recorded API/web releases and capacity/scaling settings; do not silently
   replace them with `HEAD` or defaults. Restore the normal
   SSM AMI parameter type and explicitly pass its recorded **SSM key**, not the pinned
   AMI ID. Supply the verified certificate ARNs. Review the UPDATE change set for the
   intended HTTPS listener/targets, VPC origin, 443 rules, nginx bootstrap and alias.
   An SSM AMI refresh and the planned TLS instance replacement belong in this phase,
   not phase 1. Do not execute if it changes unrelated resources or releases.
5. **Finish and verify.** Execute phase 2, wait for `UPDATE_COMPLETE` (including old
   resource cleanup) and CloudFront `Deployed`, and complete the smoke checks below.
   Confirm only the ALB HTTPS listener and intended 443 ingress remain, HTTPS targets
   are healthy, API port 3001 is loopback-only, and capacity/application releases match
   the baseline. Keep only the normal SSM-based TLS template in source; the temporary
   template and literal AMI pin are private migration artefacts, not deployment defaults.

**Rollback is phase-specific.** Phase 1 rollback should restore the original HTTP
ingress. If phase 2 rolls back, its baseline is the phase-1 stack, which intentionally
has no CloudFront ingress on port 80: `UPDATE_ROLLBACK_COMPLETE` alone does not restore
API service. Inspect the actual listener/rules before choosing a retry or rollback.
For an authorised return to HTTP, remove conflicting HTTPS prefix-list ingress first
if necessary, then restore the saved pre-phase-1 template, parameter values and routing
records through reviewed change sets. Check quota/order and AMI resolution again;
do not blindly re-add a 55-slot rule alongside another one. Verify readiness and
application behaviour after recovery. Never roll back a healthy site merely because
cleanup is still running.

#### Other update failures

If the update fails, allow CloudFormation to roll back and check its events, nginx
`/var/log/nginx/error.log`, instance boot logs and ALB target health. Diagnose a 502 by
checking certificate issuance, origin hostname/SAN matching, DNS and the 443 rules.
For a completed but faulty update, an engineer can redeploy the recorded prior infra
commit and release, with its recorded settings, then restore the old routing record
or direct viewers to the old CloudFront URL. Use a separate checkout so current work
is not discarded. Restoring the pre-TLS version restores HTTP internally: treat it as
temporary incident rollback, never as a successful TLS cutover. Keep certificates and
validation records available for the retry. After success, verify there is no HTTP
listener or API-port ingress.

A redeploy with a different release replaces instances one at a time and waits
for each new one to report healthy; if one fails, CloudFormation rolls the stack
back to the previous release. Changing only `MIN_INSTANCES` resizes the group
without replacing instances.

#### Private backup lifecycle

Keep rollback templates/state and required event backups encrypted and access-restricted
through cutover verification and the agreed recovery window. Record their owner,
location and retention/deletion decision privately; never post storage paths, event
contents or access URLs publicly. The completed cutover retained encrypted rollback
and event backups; this documentation change does not delete them. Before final
teardown, preserve only required reporting artefacts, obtain owner approval for any
retention, record retained storage costs, and delete unneeded objects and versions
by 13 November. Do not remove shared bootstrap buckets or unrelated assets.

## CI application releases

After the successful CI workflow for a push to `main`, `release.yml` publishes
the immutable `cartoptix-api:<sha>` image and, **only when the repository
variable `AWS_DEPLOY_ROLE_ARN` is set**, deploys application changes to an
existing `CartOptixPresentation` stack. With the variable unset the deploy job is
skipped and the run summary says so; that is the default, so merging changes to
the release tooling never activates deployment. A superseded main commit is
skipped. If the stack is absent, the job reports that and exits without creating
it. The workflow never creates or destroys stacks and does not publish
`cartoptix-web`; the old ECR repository and its images are left untouched.

### Prerequisites before setting `AWS_DEPLOY_ROLE_ARN`

Issue #88 must be complete and its result verified. The release scripts validate
every change set, but that is a guard against mistakes, not a security boundary:
whatever CI can assume can do whatever those roles allow. So, before enabling:

- The GitHub deployment role is trusted only by this repository's `main` branch
  (below), and cannot assume the default CDK bootstrap roles.
- The CloudFormation **execution** role, the CDK **deploy** role and the
  **file-publishing** role that CI uses are restricted ones, scoped to what
  application releases change (the API launch template and Auto Scaling group,
  and the web deployment and its asset bucket) and to the `CartOptixPresentation`
  stack. A permissions boundary on the GitHub role alone does not constrain a role
  it assumes, so the restriction must be on the downstream roles themselves. If
  #88 introduces a new bootstrap qualifier, the qualifier in the CDK app and the
  role names in this runbook must be updated to match.
- Effective permissions were verified (for example with the IAM policy
  simulator against each role in the chain), not only the policy documents.
- `DRY_RUN=true RELEASE=<sha> infra/scripts/deploy-release.sh` has been run
  against the live stack, with the deploy role's credentials where possible. It
  prepares and validates each change set, then discards it: no migrations, no
  execution.

### What a release deploys

The stack's `Release`, `WebRelease` and `InfraRelease` outputs record the
deployed API, web and infrastructure commits independently.
`infra/scripts/release_scope.py` compares them with the release, using
repository-root paths whatever the working directory:

| Changes since deployed release | Deployment |
| --- | --- |
| `apps/api` | Run that release's database migrations once through SSM, then roll out the API and wait for `/health/ready` |
| `apps/web` | Build and publish the web assets to the existing private bucket |
| `packages/contracts` | API rollout first, then web publication |
| Documentation, `infra/RUNBOOK.md`, `infra/scripts` | No application deployment |
| Any other `infra/` file, lockfile or patch | Stop and require an engineer to deploy infrastructure first |

The release script reads the live ASG minimum/maximum, target-tracking threshold
and warm-up and passes them back unchanged. The ASG may temporarily launch one
replacement instance during a rolling API update.

### Change-set guard

`infra/scripts/check_release_change_set.py` diffs the deployed template against
the change set's template and compares stack parameters. Only an explicit
allowlist may differ:

| Stage | Allowed differences |
| --- | --- |
| API | `Outputs.Release`, and the API launch template's `UserData` where the only difference is the release SHA |
| Web | `Outputs.WebRelease`, and `WebDeployment.SourceObjectKeys` (the asset key) |

Anything else aborts the release: instance type, security groups, scaling
capacity, deployment destinations, custom-resource service tokens, other
outputs, and any parameter change. Parameters include the Amazon Linux AMI, so
when AWS publishes a new image the guard blocks API releases until an engineer
redeploys infrastructure with `infra/scripts/deploy.sh`. The change set's own
resource changes must also stay within the stage's resources (for the API: the
launch template, the Auto Scaling group, its scaling policy and the dashboard).
CloudFormation reports the ASG and scaling policy as `Conditional` replacements
because they follow a dynamic reference; that is accepted only when the cause is
the upstream resource (launch template version, then ASG) and the template diff
shows their own properties unchanged. A definite replacement, removal, or a
dynamic change from anything else is rejected. The rollback change set goes through the same guard.

A web release whose built assets are identical produces no resource changes. The
guard accepts that only when the template differs solely in `WebRelease`, so the
pointer advances. If CloudFormation reports no change set at all, the release
succeeds with nothing published only when the live stack's `WebRelease` output
already equals the release; otherwise it fails, so a missing change set can never
report a release that was not deployed.

### Migrations

`infra/scripts/run-migrations.sh` runs the release image's migrations on one
healthy instance through SSM Run Command, with a 900-second execution limit, and
polls until SSM reports a terminal status. The API rollout starts only on
`Success`. On timeout or interruption it cancels the command and waits for a
terminal status; if that cannot be confirmed it fails with the command ID and the
state is uncertain, so do not retry until the command is terminal. A new run
refuses to start while an earlier `CartOptix migrations` command is pending, in
progress or cancelling (on any instance, for any release), and the container name is fixed per release, so a leftover container
blocks a retry rather than running alongside it. Drizzle applies each migration in
a transaction, so an interrupted run rolls back rather than leaving a half-applied
change. Migrations must stay backward compatible with the API that is still
running during the rollout.

### Failures

For releases containing both API and web changes, migrations and the API rollout
finish first; if either fails, web publication does not start. If the API
readiness check fails after rollout, CI restores the previous API release and
skips web publication. A web failure does not roll back the healthy API; the
failed change set rolls back to the prior assets, and rerunning the Release
workflow retries only the web stage. The previous API image must still exist in
ECR. No seed import runs automatically: follow **Load the database** below for
the initial seed and perform future seed updates manually.

### GitHub OIDC roles

Set repository variable `AWS_DEPLOY_ROLE_ARN` to a dedicated deployment role.
Keep it separate from the existing `AWS_PUBLISH_ROLE_ARN` ECR publisher role;
the publisher does not receive deployment permissions. The publishing workflow
checks for an existing immutable API tag, so the publisher also needs
`ecr:DescribeImages` on `cartoptix-api` in addition to its existing ECR push
permissions. Leave its existing permissions on the legacy `cartoptix-web`
repository unchanged; this workflow never uses them.

The deployment role's trust policy must restrict OIDC to this repository's
`main` branch (the subject includes the repository's immutable owner/repository
IDs):

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": {
      "Federated": "arn:aws:iam::<account-id>:oidc-provider/token.actions.githubusercontent.com"
    },
    "Action": "sts:AssumeRoleWithWebIdentity",
    "Condition": {
      "StringEquals": {
        "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
        "token.actions.githubusercontent.com:sub": "repo:CS5224-Group-3@325644622/CartOptix@1359158441:ref:refs/heads/main"
      }
    }
  }]
}
```

Capabilities the role needs, to be scoped by #88: read the presentation stack,
its templates and change sets, the ASG and scaling policy, and the API ECR
image; delete a change set it created; `ssm:SendCommand` with `AWS-RunShellScript`
against instances tagged `Project=cartoptix`, plus `ssm:GetCommandInvocation`,
`ssm:ListCommands` and `ssm:CancelCommand`; and assume only the restricted
deploy and file-publishing roles described above, plus
`ssm:GetParameter` on the bootstrap version parameter. It gets no direct stack
create/delete or broad CloudFormation mutation permissions.

Set `AWS_DEPLOY_ROLE_ARN` in **Settings → Secrets and variables → Actions →
Variables** alongside the existing `AWS_PUBLISH_ROLE_ARN`. No long-lived AWS
credentials are needed. The deployment role is used only after the
successful-main CI gate; PR runs never receive its OIDC token.

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
seed replaces the catalogue in one transaction. When a release changes the seed's
shape, import its seed straight after migrating and before the smoke checks: until
then the API leaves out multibuys stored in the older shape.

## Smoke checks

### TLS evidence

- Confirm `https://cartoptix.hellodon.dev/` serves a valid matching public certificate
  without bypassing validation; `http://cartoptix.hellodon.dev/` redirects to HTTPS
  when tested with curl (browsers may upgrade it using HSTS).
- In CloudFront, confirm the VPC origin uses `https-only`, TLS 1.2, and distribution
  origin domain `cartoptix-origin.hellodon.dev`. Confirm its ALB certificate is issued
  in Singapore for that name. A viewer HTTPS response alone does not prove origin TLS.
- In ELB, confirm the private ALB has only an HTTPS 443 listener, TLS 1.2/1.3 policy,
  an HTTPS 443 target group and HTTPS `/health/live` checks; all targets must be healthy.
- Through SSM on each instance, run `sudo nginx -t`, inspect `sudo ss -lntp`, and verify
  3001 is published only on `127.0.0.1`, nginx listens on 443 and nothing listens on 80.
  Inspect the instance certificate's dates/SAN with
  `sudo openssl x509 -in /etc/cartoptix/tls/cert.pem -noout -dates -ext subjectAltName`.
  Repeat the boot script's HTTPS curl probe with that instance ID and `--cacert`.
- Confirm the instance security group permits 443 only from the ALB group, not
  80/3001 or public CIDRs. The ALB group permits 443 only from CloudFront's origin list.
- Save redacted configuration/health evidence in #92, without keys, credentials or
  database secrets. Check two-instance replacement/scale-out during the evaluation
  window and repeat the load calibration before reusing its previous figures.

### Application checks

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

The policy holds a target of requests per minute per instance. The default,
**3300**, was calibrated on 18 October 2026 against release `d2bc862`
([#21 results](https://github.com/CS5224-Group-3/CartOptix/issues/21#issuecomment-6244650495)):

| Measurement | Result |
| --- | --- |
| Knee on one instance | 4800 RPM of mixed traffic (catalogue:products:offers:basket = 1:5:5:1), where CPU reached the `t4g.micro` baseline of 10% and the credit balance stopped rising. p99 stayed under 200 ms |
| Target | about 70% of the knee: 3300 |
| Scale-out at 7200 RPM | 1 to 3 instances serving in about 15 minutes; each new instance took about 8 minutes from launch to healthy |
| Scale-in after the load stopped | started after about 18 minutes, then 3 to 1 within 2 minutes |
| At 3 instances | 12 database connections at peak (budget 18); RDS CPU about 24% with its credits falling slowly |

Recalibrate if the API's cost per request changes:

1. Deploy at `MIN_INSTANCES=1` and suspend alarm-driven scaling, so the group
   stays at one instance while you measure:
   `aws autoscaling suspend-processes --auto-scaling-group-name "$(out AutoScalingGroupName)" --scaling-processes AlarmNotification`
2. Drive a steady rate in steps of a few minutes each and watch the latency and
   CPU credit widgets. Find the rate at which ALB p99 reaches the SC-05 bound of
   two seconds, or at which the CPU credit balance starts falling.
3. Take about 70% of that rate as the target, so an instance scales out before it
   degrades. Redeploy with it, then resume scaling with `resume-processes` and the
   same arguments:

   ```bash
   TARGET_RPM=<measured> pnpm --filter @cartoptix/infra deploy
   ```

4. Hold a load above the target until new instances are in service, then stop
   and confirm scale-in. Record the figures in #21 and update the default in
   `bin/presentation.ts`.

Target tracking sets its own timing through the two alarms AWS creates with the
policy: three one-minute datapoints above the target before scaling out, and
fifteen below it before scaling in. There is no cooldown setting to tune here;
CloudFormation honours `Cooldown` only for simple scaling policies.

New instances join the target group in slow start for 120 seconds, so traffic
reaches them gradually. They start with a cold database pool and, in standard
credit mode, no CPU credits; without slow start the calibration run failed 0.3%
of requests in the minute each one joined.

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
stack, any certificate stacks, externally created certificates and `CartOptixGuardrails`
stay: the script names the presentation stack explicitly, because a bare `cdk destroy` would take the spending alert with it
and leave the account unwatched. Check what is left:

Remove the two deployment routing CNAMEs after daily teardown so they do not point
at deleted AWS resources. Keep the privately inventoried ACM certificates and validation
CNAMEs across daily teardown; retain any owning certificate stacks too. On recreation,
verify issuance and reuse the same ARNs, then update only stale routing targets.

After the **final teardown, by 13 November**, check certificate ownership and ACM
`InUseBy` in each region, after CloudFront and ALB have released their certificates:

- **Stack-managed:** destroy only the certificate stacks verified to own the project
  certificates. For the repository's two certificate stacks, from `infra/`:

  ```bash
  pnpm exec cdk destroy CartOptixViewerCertificate CartOptixOriginCertificate --app 'node bin/certificates.ts' --output cdk.out-certificates
  ```

- **Externally created (the certificates reused for this cutover):** the command above
  does not delete them. With the owner's approval, delete each unused project
  certificate directly in ACM in its own region. If another stack owns one, use that
  stack's lifecycle instead. Do not delete a shared/in-use certificate; resolve ownership
  and record any approved retention explicitly.

Verify the inventoried certificates are gone or have an approved retention record;
successful stack destruction alone is insufficient. Remove only their validation
CNAMEs after checking no other certificate or region uses the same record. Preserve
unrelated `hellodon.dev` records and the domain registration. Apply the private backup
lifecycle above, inspect bootstrap resources in both regions for retained billable
assets, and include them in final teardown evidence.

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
