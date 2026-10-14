#!/usr/bin/env bash
# Deploys the presentation stack from this checkout. See infra/RUNBOOK.md.
#
#   MIN_INSTANCES  baseline app instances: 1 while building (default), 2 for
#                  evaluation and the presentation
#   RELEASE        API image to run (default: HEAD). Another commit is allowed
#                  only when apps/ and packages/ are identical to HEAD, so the
#                  web build from this checkout always matches the API image.
#   AWS_PROFILE    defaults to cartoptix
#
# Extra arguments go to `cdk deploy`.
set -euo pipefail
cd "$(dirname "$0")/.."
export AWS_PROFILE=${AWS_PROFILE:-cartoptix}

die() { echo "deploy: $*" >&2; exit 1; }

[[ -z "$(git status --porcelain)" ]] || die "the working tree has uncommitted changes; commit or stash them first."

release=$(git rev-parse "${RELEASE:-HEAD}")
if [[ "$release" != "$(git rev-parse HEAD)" ]] && ! git diff --quiet "$release" HEAD -- ../apps ../packages; then
  die "apps/ or packages/ differ between $release and HEAD, so the web build would not match the API image."
fi

aws ecr describe-images --repository-name cartoptix-api --image-ids "imageTag=$release" >/dev/null 2>&1 \
  || die "no cartoptix-api image for $release. Images are published when a commit lands on main (release.yml)."

pnpm --filter @cartoptix/web build
pnpm exec cdk deploy -c release="$release" -c minInstances="${MIN_INSTANCES:-1}" "$@"
