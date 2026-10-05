# Release runbook

Issue #7. How a release is published, deployed, verified and rolled back on the
development POC.

## What a release is

A release is one Git commit and the two `linux/arm64` images built from it:

| | |
| --- | --- |
| Identity | the full Git commit SHA, used as the image tag |
| Where it lives | `$IMAGE_REGISTRY/cartoptix-api:<sha>` and `$IMAGE_REGISTRY/cartoptix-web:<sha>` |
| Where it is built | CI, on a native arm64 runner. **Never on the development host** |
| What identifies it at runtime | the `com.cartoptix.release` label on the `cartoptix-api` and `cartoptix-web` containers |

Images are only ever tagged with a commit SHA. There is no moving tag such as
`latest`, so a tag always names exactly one immutable build, and restoring an
earlier release is a pull rather than a rebuild.

Migrations and the seed import are **release steps, not startup steps**. They run
once per release, from the released image, by hand or by the release script.
`/health/ready` deliberately does not inspect the seed, so nothing else can be
relied on to load it.

## Prerequisites

### AWS account (admin, once)

| Item | Why |
| --- | --- |
| `AmazonSSMManagedInstanceCore` on the instance profile | lets Systems Manager reach the host at all |
| `AmazonEC2ContainerRegistryReadOnly` on the instance profile | lets the host pull the release images. **SSM alone is not enough** |
| Elastic IP associated with the instance | the public address must survive stop/start |
| Two ECR repositories, `cartoptix-api` and `cartoptix-web`, tag immutability **on** | one tag must never be overwritten |
| GitHub OIDC identity provider in IAM | replaces long-lived access keys |
| Publishing role and deployment role | see below |

The deployment role, allowed to reach this instance only:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "ssm:SendCommand",
      "Resource": [
        "arn:aws:ec2:ap-southeast-1:<account-id>:instance/<instance-id>",
        "arn:aws:ssm:ap-southeast-1::document/AWS-RunShellScript"
      ]
    },
    {
      "Effect": "Allow",
      "Action": "ssm:GetCommandInvocation",
      "Resource": "*"
    }
  ]
}
```

The publishing role needs `ecr:GetAuthorizationToken`, plus the push actions
(`ecr:BatchCheckLayerAvailability`, `ecr:InitiateLayerUpload`, `ecr:UploadLayerPart`,
`ecr:CompleteLayerUpload`, `ecr:PutImage`) on the two repositories.

Both roles trust the GitHub OIDC provider:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Federated": "arn:aws:iam::<account-id>:oidc-provider/token.actions.githubusercontent.com"
      },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "token.actions.githubusercontent.com:aud": "sts.amazonaws.com"
        },
        "StringLike": {
          "token.actions.githubusercontent.com:sub": "repo:CS5224-Group-3/CartOptix:*"
        }
      }
    }
  ]
}
```

Tighten the `sub` condition to `:ref:refs/heads/main` once the workflows have
settled. `workflow_run`-triggered runs are evaluated against the default branch.

### Repository variables (once, Settings → Secrets and variables → Actions → Variables)

| Variable | Value |
| --- | --- |
| `AWS_PUBLISH_ROLE_ARN` | ARN of the publishing role |
| `AWS_DEPLOY_ROLE_ARN` | ARN of the deployment role |
| `DEV_INSTANCE_ID` | EC2 instance id of the development host, e.g. `i-0abc…` |
| `DEV_REPOSITORY_DIR` | absolute path of the repository checkout on the host, e.g. `/home/ec2-user/CartOptix` |

No secrets are needed. If a variable is missing, the workflow fails with an
explicit message instead of an obscure AWS error.

### Development host (once)

- Docker, Docker Compose, Docker Buildx, git, curl, and the AWS CLI.
- A clone of this repository with read access, at `$DEV_REPOSITORY_DIR`.
- `deploy/development/.env`, created from `.env.example` and `chmod 600`. It now
  needs `IMAGE_REGISTRY` as well as the three `POSTGRES_*` values. **An `.env`
  written before Issue #7 must be updated**, or compose stops with
  `IMAGE_REGISTRY is required`.
- The `cartoptix-postgres-data` volume and `cartoptix-net` network. `release.sh`
  creates them if they are absent.
- The host does not need to build anything, so it does not need swap or spare
  memory for a build.

## Release procedure

### Automatic

1. A pull request merges into `main`.
2. **CI** runs `pnpm check` and `pnpm build`. A red run stops here: the Publish
   workflow only starts from a successful CI run for a push to `main`.
3. **Publish** builds both images for `linux/arm64` and pushes them tagged with
   the merge commit SHA.
4. **Deploy** assumes the deployment role and sends an SSM command to the host,
   which runs:

   ```bash
   cd "$DEV_REPOSITORY_DIR"
   git fetch --prune origin
   git checkout --force <sha>
   bash deploy/development/release.sh <sha>
   ```

5. `release.sh` pulls the images, applies migrations, imports the seed,
   recreates `api`, recreates `web`, and fails the run unless `/health/ready`
   returns 200.

### On the host, by hand

Same steps, for a reviewer or an engineer without GitHub access:

```bash
cd "$DEV_REPOSITORY_DIR"
git fetch --prune origin
git checkout --force <sha>
bash deploy/development/release.sh <sha>
```

Expected output:

```
==> Releasing <sha>
==> Checking host prerequisites
==> Ensuring the persistent Docker resources exist
==> Authenticating to <account-id>.dkr.ecr.ap-southeast-1.amazonaws.com in ap-southeast-1
==> Pulling the release images
==> Starting PostgreSQL
==> Applying database migrations (once per release)
==> Importing the curated seed (once per release)
==> Recreating api
==> Restarting web after api
==> Waiting for http://127.0.0.1/health/ready to return 200
Readiness returned 200 on attempt 1.
==> Running release
cartoptix-api  <registry>/cartoptix-api:<sha>  release=<sha>
cartoptix-web  <registry>/cartoptix-web:<sha>  release=<sha>

Release <sha> is live.
```

Migration and seed output is repeatable. When nothing is pending the migration
task reports `Database migrations are up to date.`, and repeated seed imports
leave the counts unchanged.

## Rollback

Restore a previous release by deploying its commit SHA again. Nothing is rebuilt
and no schema is rolled back.

**Through GitHub:** Actions → **Deploy** → *Run workflow* → set `release` to the
commit SHA of the release to restore.

**On the host:**

```bash
cd "$DEV_REPOSITORY_DIR"
git fetch --prune origin
git checkout --force <previous-sha>
bash deploy/development/release.sh <previous-sha>
```

Only re-run the migration task if the restored release predates migrations that
have already been applied, and only when those migrations are backward
compatible. The technical specification requires backward-compatible schema
changes for exactly this reason: Drizzle migrations are forward-only, so the way
to make a rollback safe is to keep every migration safe for the previous
release to run against. Add columns as nullable or with defaults, and drop
columns in a later release rather than the one that stops using them.

To find a previous release:

```bash
aws ecr describe-images \
  --repository-name cartoptix-api \
  --query 'sort_by(imageDetails,&imagePushedAt)[-10:].[imageTags[0],imagePushedAt]' \
  --output table
```

## Smoke checks

Run on the host after every release and rollback.

```bash
curl -i http://127.0.0.1/health/live     # 200, {"status":"ok"}
curl -i http://127.0.0.1/health/ready    # 200, database check ok
curl -i http://127.0.0.1/api/v1/catalogue
curl -i "http://127.0.0.1/api/v1/products?page=1&pageSize=5"
curl -I http://127.0.0.1/                 # 200
```

Every one of these must return HTTP 200. `/health/ready` returning 503 means the
API cannot reach PostgreSQL.

Which release is running:

```bash
docker inspect \
  --format '{{slice .Name 1}}  {{.Config.Image}}  release={{index .Config.Labels "com.cartoptix.release"}}' \
  cartoptix-api cartoptix-web
```

Expected, for a release of `$SHA`:

```
cartoptix-api  <registry>/cartoptix-api:$SHA  release=$SHA
cartoptix-web  <registry>/cartoptix-web:$SHA  release=$SHA
```

The image tag and the label must both equal the commit SHA you deployed. Do not
use `trimPrefix` here - Docker's template language does not define it and the
command fails with `function "trimPrefix" not defined`.

Container state:

```bash
docker compose -f deploy/development/compose.yml ps
```

`cartoptix-postgres`, `cartoptix-api` and `cartoptix-web` should all report
`healthy`, and the API and PostgreSQL must not publish host ports.

## Verifying before merging (assignee)

Two things have to pass before this is offered for review: the workflow files
pass `actionlint`, and `release.sh` completes against a local Compose stack.

### On Windows

```powershell
powershell -ExecutionPolicy Bypass -File deploy/development/verify-local.ps1
```

That script runs every check that needs no cloud access, prints one line per
check, and exits non-zero if any of them failed. Useful flags:

| Flag | Effect |
| --- | --- |
| `-SkipBuild` | reuse images already tagged locally, for a fast second run |
| `-SkipRollback` | do not run the rollback check |
| `-SkipStack` | run only the checks that need no Docker engine |
| `-WebPort 8080` | publish the stack on a spare port when 80 is taken |
| `-NoDownload` | never download `actionlint`; fail the check if it is absent |

`actionlint` is looked for on `PATH` and in `.tools`, then in the
`rhysd/actionlint` image, and only then downloaded into `.tools` with its
published SHA-256 checksum verified. `.tools/` is ignored by Git.

### On Linux or macOS, or by hand

```bash
cd "$REPO_ROOT"
sha="$(git rev-parse HEAD)"
export IMAGE_REGISTRY=cartoptix-local
docker build -f apps/api/Dockerfile -t "$IMAGE_REGISTRY/cartoptix-api:$sha" .
docker build -f deploy/development/web.Dockerfile -t "$IMAGE_REGISTRY/cartoptix-web:$sha" .
cd deploy/development
# .env must set IMAGE_REGISTRY=cartoptix-local for the tags above to match
SKIP_PULL=1 bash release.sh "$sha"
```

And the workflow check:

```bash
docker run --rm -v "$PWD:/repo" --workdir /repo rhysd/actionlint:1.7.12 \
  .github/workflows/ci.yml .github/workflows/publish.yml .github/workflows/deploy.yml
```

Note the tag has no `v` prefix. The GitHub release is `v1.7.12`, but the Docker
Hub image tag is `1.7.12`; using the release spelling fails with `manifest
unknown`.

Name the workflow files explicitly. `actionlint` looks for a Git project to
locate `.github/workflows` itself, and a checkout without a `.git` directory,
such as a downloaded ZIP, is not detected as one.

### Why these builds are local-architecture

The check that matters here is the deploy path, so the images are built for
whatever machine is running the check. Architecture correctness belongs to CI:
`publish.yml` builds `linux/arm64` on a native arm64 runner. Emulating arm64
locally through QEMU would only make `pnpm install` and `tsc` slow without
proving anything extra.

`SKIP_PULL=1` is only for this local path. On the host the pull must run, because
using a stale local image instead of the released one would defeat the point of
the tag.

### What local verification cannot show

The Deploy workflow, the SSM command, the ECR pull, the Elastic IP, the arm64
images themselves, and whether an older image runs correctly against a newer
schema. Those need the development instance, and they are the reviewer's checks.
The rollback check in `verify-local.ps1` exercises the rollback path by
retagging one local build, which is not the same as proving compatibility
between two different releases.

## Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| `IMAGE_REGISTRY is required` | `.env` predates Issue #7. Add `IMAGE_REGISTRY` and `RELEASE` from `.env.example`. |
| `unknown flag: --wait` | Docker Compose on the host is older than v2.17. Update the Compose plugin; `release.sh` uses `up --wait` to wait for PostgreSQL. |
| `denied: Your authorization token has expired` or a 401 on pull | The instance profile lacks `AmazonEC2ContainerRegistryReadOnly`, or `aws ecr get-login-password` failed. |
| `release.sh` reports `Docker is not running` | Start Docker on the host. |
| `/health/ready` returns 503 | The API cannot reach PostgreSQL. Check `docker compose logs postgres` and `docker compose logs api`. |
| Browser or `curl http://127.0.0.1/api/...` returns 502 | `web` was not recreated after `api`. Recreate it: `docker compose up -d --force-recreate web`. |
| Deploy workflow fails with `Missing repository variables` | Set the variables listed above. |
| Deploy workflow fails with an SSM error | The instance profile is missing, or the instance is not registered with Systems Manager. Check `aws ssm describe-instance-information`. |
| `Publish` never starts | CI did not succeed on `main`. The publish job intentionally does nothing after a failed or pull-request run. |
| `docker: Cannot connect to the Docker daemon` naming `dockerDesktopLinuxEngine` | The engine is not running, or the CLI is on the legacy `default` context. Start Docker Desktop, then `docker context use desktop-linux`, then confirm with `docker info --format "{{.ServerVersion}}"`. |
| `verify-local.ps1 cannot be loaded because running scripts is disabled` | PowerShell execution policy. Run it as the example shows, with `-ExecutionPolicy Bypass`, which applies to that process only. |
| `actionlint` reports `no project was found in any parent directories` | The checkout has no `.git` directory. Name the workflow files explicitly, or run `git init`. |
| `verify-local.ps1` reports `.env has no IMAGE_REGISTRY` | A pre-#7 `.env`. Add `IMAGE_REGISTRY` as `.env.example` shows. |
| `Bind for 0.0.0.0:80 failed: port is already allocated` | Another service holds port 80. Set `WEB_PORT` to a spare port; `release.sh` probes readiness on it. `verify-local.ps1` picks a free port by itself. |
| `release.sh: line 23: dirname: command not found` (exit 127) | Only on Windows. Git for Windows keeps `dirname`, `sed`, `tail`, `cut` and `seq` in `<git>\usr\bin`, which is added only for a login shell. Run `release.sh` with `bash -l`, or use `verify-local.ps1`, which does. Prepending that directory to `PATH` does not work. |
| `template parsing error: function "trimPrefix" not defined` | Docker's template language has no `trimPrefix`. Use `{{slice .Name 1}}` to drop the leading slash. |
| `template parsing error: function "com" not defined` | Seen when a quoted template such as `{{index .Config.Labels "com.cartoptix.release"}}` is passed to `docker.exe` from PowerShell: the inner double quotes are stripped. Under bash it is fine. From PowerShell use `{{json .Config.Labels}}` and parse the result. |
| `manifest for rhysd/actionlint:v1.7.12 not found` | The Docker Hub image tag has no `v` prefix (`1.7.12`); only the GitHub release tag does. |
