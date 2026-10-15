#!/usr/bin/env bash
# Deletes the presentation stack and everything in it. See infra/RUNBOOK.md.
# Dump any click events you need first; the database is not backed up.
# Extra arguments go to `cdk destroy`.
set -euo pipefail
cd "$(dirname "$0")/.."
export AWS_PROFILE=${AWS_PROFILE:-cartoptix}

# CDK synthesises the app before deleting, which needs a release and a web build.
pnpm --filter @cartoptix/web build
# CartOptixPresentation by name. A bare `cdk destroy` would also delete
# CartOptixGuardrails, leaving the project with no spending alert at exactly
# the time nothing is being watched.
pnpm exec cdk destroy CartOptixPresentation \
  -c release="$(git rev-parse HEAD)" \
  -c alertEmail=unused@example.invalid "$@"
