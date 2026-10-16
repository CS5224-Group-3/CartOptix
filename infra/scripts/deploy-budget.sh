#!/usr/bin/env bash
# Deploys the spending alert. Run this ONCE, not per session. See infra/RUNBOOK.md.
#
#   ALERT_EMAIL    required; where budget alerts are sent
#   MONTHLY_LIMIT  monthly ceiling in USD (default 40)
#   AWS_PROFILE    defaults to cartoptix
#
# Separate from deploy.sh because this stack must outlive the presentation
# stack: destroy.sh tears that one down after every session, and a spending
# alert that disappears with it would be absent whenever nothing is watching.
set -euo pipefail
cd "$(dirname "$0")/.."
export AWS_PROFILE=${AWS_PROFILE:-cartoptix}

die() { echo "deploy-budget: $*" >&2; exit 1; }

[[ -n "${ALERT_EMAIL:-}" ]] || die "set ALERT_EMAIL to the address that should receive budget alerts."

# The release and web build are only needed because the app synthesises both
# stacks; this one uses neither.
pnpm --filter @cartoptix/web build
pnpm exec cdk deploy CartOptixGuardrails \
  -c release="$(git rev-parse HEAD)" \
  -c alertEmail="$ALERT_EMAIL" \
  -c monthlyLimit="${MONTHLY_LIMIT:-40}" "$@"

cat <<'NOTE'

The budget filters on the Project=cartoptix cost allocation tag. If that tag is
not activated, the budget reports zero spend and never alerts:

  Billing and Cost Management -> Cost allocation tags -> user-defined
  -> select "Project" -> Activate

Activation applies to costs from the current month onward, not retroactively.
NOTE
