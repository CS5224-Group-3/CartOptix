#!/usr/bin/env bash
# Run the released API image's migrations once on a healthy presentation instance.
set -euo pipefail
cd "$(dirname "$0")/.."

export AWS_REGION="${AWS_REGION:-ap-southeast-1}"
if [[ -z "${AWS_PROFILE:-}" && "${CI:-false}" != "true" ]]; then
  export AWS_PROFILE=cartoptix
fi

die() { echo "migrations: $*" >&2; exit 1; }
release="${1:-}"
group="${2:-}"
[[ "$release" =~ ^[0-9a-f]{40}$ ]] || die "expected a full release SHA."
[[ -n "$group" ]] || die "expected the presentation Auto Scaling Group name."

instance="$(aws autoscaling describe-auto-scaling-groups --auto-scaling-group-names "$group" \
  --query 'AutoScalingGroups[0].Instances[?LifecycleState==`InService` && HealthStatus==`Healthy`]|[0].InstanceId' --output text)"
[[ -n "$instance" && "$instance" != "None" ]] || die "no healthy in-service instance is available for migrations."

registry="485530831349.dkr.ecr.${AWS_REGION}.amazonaws.com"
image="$registry/cartoptix-api:$release"
remote_command=$(cat <<EOF
set -eu
password=\$(aws ecr get-login-password --region ${AWS_REGION})
printf '%s' "\$password" | docker login --username AWS --password-stdin ${registry}
docker pull ${image}
docker run --rm --env-file /etc/cartoptix/api.env -v /etc/cartoptix/rds-ca.pem:/certs/rds-ca.pem:ro --entrypoint node ${image} apps/api/dist/db/migrate-cli.js
EOF
)
parameters="$(jq -n --arg command "$remote_command" '{commands:[$command]}')"
command_id="$(aws ssm send-command \
  --document-name AWS-RunShellScript \
  --instance-ids "$instance" \
  --comment "CartOptix migrations $release" \
  --timeout-seconds 600 \
  --parameters "$parameters" \
  --query 'Command.CommandId' --output text)"

if ! aws ssm wait command-executed --command-id "$command_id" --instance-id "$instance"; then
  invocation="$(aws ssm get-command-invocation --command-id "$command_id" --instance-id "$instance" --output json)"
  jq -r '.StandardOutputContent, .StandardErrorContent' <<<"$invocation" >&2
  die "migration command did not complete successfully."
fi

invocation="$(aws ssm get-command-invocation --command-id "$command_id" --instance-id "$instance" --output json)"
status="$(jq -r '.Status' <<<"$invocation")"
jq -r '.StandardOutputContent' <<<"$invocation"
[[ "$status" == "Success" ]] || {
  jq -r '.StandardErrorContent' <<<"$invocation" >&2
  die "migration command finished with status $status."
}
