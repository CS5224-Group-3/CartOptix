#!/usr/bin/env bash
# Deploys the presentation stack from this checkout. See infra/RUNBOOK.md.
#
#   MIN_INSTANCES  baseline app instances: 1 while building (default), 2 for
#                  evaluation and the presentation
#   RELEASE        API image to run (default: HEAD). The frontend is always built
#                  from this checkout and uploaded to S3; only the API comes from
#                  ECR. Another commit is allowed only when apps/api and
#                  packages/ (the API image's sources, including the shared
#                  contracts) are identical to HEAD, so infra-only and web-only
#                  changes can deploy before their own image exists.
#   AWS_PROFILE    defaults to cartoptix
#
# Extra arguments go to `cdk deploy`.
set -euo pipefail
cd "$(dirname "$0")/.."
export AWS_PROFILE=${AWS_PROFILE:-cartoptix}

die() { echo "deploy: $*" >&2; exit 1; }

[[ -z "$(git status --porcelain)" ]] || die "the working tree has uncommitted changes; commit or stash them first."

release=$(git rev-parse "${RELEASE:-HEAD}")
if [[ "$release" != "$(git rev-parse HEAD)" ]] && ! git diff --quiet "$release" HEAD -- ../apps/api ../packages; then
  die "apps/api or packages/ differ between $release and HEAD, so the image would not run this checkout's API or contracts."
fi

aws ecr describe-images --repository-name cartoptix-api --image-ids "imageTag=$release" >/dev/null 2>&1 \
  || die "no cartoptix-api image for $release. Images are published when a commit lands on main (release.yml)."

pnpm --filter @cartoptix/web build
pnpm exec cdk deploy -c release="$release" -c minInstances="${MIN_INSTANCES:-1}" "$@"
