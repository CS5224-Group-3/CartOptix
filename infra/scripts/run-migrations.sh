#!/usr/bin/env bash
# Run the released API image's migrations once, through SSM, and wait for a
# definitive result. Exits 0 only when SSM reports Success.
set -euo pipefail
cd "$(dirname "$0")/.."

export AWS_REGION="${AWS_REGION:-ap-southeast-1}"
if [[ -z "${AWS_PROFILE:-}" && "${CI:-false}" != "true" ]]; then
  export AWS_PROFILE=cartoptix
fi

# executionTimeout bounds the script on the instance. The poll deadline is a
# little longer; the other knobs exist so tests do not have to wait.
timeout_seconds="${MIGRATION_TIMEOUT_SECONDS:-900}"
margin_seconds="${MIGRATION_DEADLINE_MARGIN_SECONDS:-60}"
cancel_wait_seconds="${MIGRATION_CANCEL_WAIT_SECONDS:-60}"
poll_seconds="${MIGRATION_POLL_SECONDS:-5}"

die() { echo "migrations: $*" >&2; exit 1; }
release="${1:-}"
group="${2:-}"
[[ "$release" =~ ^[0-9a-f]{40}$ ]] || die "expected a full release SHA."
[[ -n "$group" ]] || die "expected the presentation Auto Scaling Group name."

# A command from an earlier run may still be migrating; never start a second one.
busy="$(aws ssm list-commands \
  --query "Commands[?starts_with(Comment, 'CartOptix migrations') && (Status=='Pending' || Status=='InProgress')].CommandId" \
  --output text)"
[[ -z "$busy" || "$busy" == "None" ]] || die "migration command $busy is still active; do not retry until it reaches a terminal status."

instance="$(aws autoscaling describe-auto-scaling-groups --auto-scaling-group-names "$group" \
  --query 'AutoScalingGroups[0].Instances[?LifecycleState==`InService` && HealthStatus==`Healthy`]|[0].InstanceId' --output text)"
[[ -n "$instance" && "$instance" != "None" ]] || die "no healthy in-service instance is available for migrations."

registry="485530831349.dkr.ecr.${AWS_REGION}.amazonaws.com"
image="$registry/cartoptix-api:$release"
# A fixed container name means a leftover container blocks a retry instead of
# letting two migrations run side by side.
remote_command=$(cat <<EOF
set -eu
password=\$(aws ecr get-login-password --region ${AWS_REGION})
printf '%s' "\$password" | docker login --username AWS --password-stdin ${registry}
docker pull ${image}
docker run --rm --name cartoptix-migrate-${release} --env-file /etc/cartoptix/api.env -v /etc/cartoptix/rds-ca.pem:/certs/rds-ca.pem:ro --entrypoint node ${image} apps/api/dist/db/migrate-cli.js
EOF
)
parameters="$(jq -n --arg command "$remote_command" --arg timeout "$timeout_seconds" '{commands:[$command], executionTimeout:[$timeout]}')"
command_id="$(aws ssm send-command \
  --document-name AWS-RunShellScript \
  --instance-ids "$instance" \
  --comment "CartOptix migrations $release" \
  --timeout-seconds 60 \
  --parameters "$parameters" \
  --query 'Command.CommandId' --output text)"

status="Pending"
# Returns 0 once the command reaches a terminal status, 1 if the budget runs out first.
poll_status() {
  local deadline=$((SECONDS + $1))
  while :; do
    status="$(aws ssm get-command-invocation --command-id "$command_id" --instance-id "$instance" \
      --query Status --output text 2>/dev/null || echo Pending)"
    case "$status" in
      Pending | InProgress | Delayed | Cancelling) ;;
      *) return 0 ;;
    esac
    if ((SECONDS >= deadline)); then return 1; fi
    sleep "$poll_seconds"
  done
}

cancel_and_confirm() {
  aws ssm cancel-command --command-id "$command_id" --instance-ids "$instance" >/dev/null 2>&1 || true
  poll_status "$cancel_wait_seconds" \
    || die "migration state is uncertain: command $command_id is still $status. Do not retry until it reaches a terminal status."
}

on_signal() {
  trap - INT TERM
  echo "migrations: interrupted; cancelling command $command_id." >&2
  cancel_and_confirm
  die "interrupted; command $command_id ended as $status."
}
trap on_signal INT TERM

if ! poll_status $((timeout_seconds + margin_seconds)); then
  echo "migrations: command $command_id did not finish in time; cancelling." >&2
  cancel_and_confirm
  die "timed out after ${timeout_seconds}s; command $command_id ended as $status."
fi

invocation="$(aws ssm get-command-invocation --command-id "$command_id" --instance-id "$instance" --output json)"
jq -r '.StandardOutputContent' <<<"$invocation"
if [[ "$status" != "Success" ]]; then
  jq -r '.StandardErrorContent' <<<"$invocation" >&2
  die "migration command finished with status $status."
fi
