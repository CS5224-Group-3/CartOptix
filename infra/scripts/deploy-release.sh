#!/usr/bin/env bash
# Deploy changed application components to an existing presentation stack.
set -euo pipefail
cd "$(dirname "$0")/.."

export AWS_REGION="${AWS_REGION:-ap-southeast-1}"
if [[ -z "${AWS_PROFILE:-}" && "${CI:-false}" != "true" ]]; then
  export AWS_PROFILE=cartoptix
fi

die() { echo "release: $*" >&2; exit 1; }
changed() {
  local base="$1" head="$2"
  shift 2
  git cat-file -e "${base}^{commit}" 2>/dev/null || die "missing deployed commit $base; fetch full history before releasing."
  git cat-file -e "${head}^{commit}" 2>/dev/null || die "missing release commit $head."
  if git diff --quiet "$base" "$head" -- "$@"; then
    return 1
  else
    local status=$?
    [[ "$status" == 1 ]] || die "could not compare $base with $head."
    return 0
  fi
}

release="${RELEASE:-${GITHUB_SHA:-}}"
[[ "$release" =~ ^[0-9a-f]{40}$ ]] || die "RELEASE must be a full commit SHA."
command -v aws >/dev/null || die "AWS CLI is required."
command -v jq >/dev/null || die "jq is required."
command -v python3 >/dev/null || die "Python 3 is required."

if ! stack_json="$(aws cloudformation describe-stacks --stack-name CartOptixPresentation --output json 2>&1)"; then
  if [[ "$stack_json" == *"does not exist"* ]]; then
    echo "Presentation stack is absent; application deployment skipped."
    if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then
      echo "Presentation stack is absent; application deployment skipped." >> "$GITHUB_STEP_SUMMARY"
    fi
    exit 0
  fi
  die "$stack_json"
fi

output() {
  jq -r --arg key "$1" '[.Stacks[0].Outputs[]? | select(.OutputKey == $key) | .OutputValue][0] // empty' <<<"$stack_json"
}

current_api="$(output Release)"
current_web="$(output WebRelease)"
current_infra="$(output InfraRelease)"
group="$(output AutoScalingGroupName)"
url="$(output Url)"
[[ "$current_api" =~ ^[0-9a-f]{40}$ ]] || die "stack has no valid Release output."
[[ "$current_web" =~ ^[0-9a-f]{40}$ ]] || current_web="$current_api"
[[ "$current_infra" =~ ^[0-9a-f]{40}$ ]] || current_infra="$current_api"
[[ -n "$group" && "$group" != "null" ]] || die "stack has no AutoScalingGroupName output."
[[ "$url" == https://* ]] || die "stack has no valid Url output."

if changed "$current_infra" "$release" infra \
  ':(exclude)infra/RUNBOOK.md' \
  ':(exclude)infra/scripts/deploy-release.sh' \
  ':(exclude)infra/scripts/run-migrations.sh' \
  ':(exclude)infra/scripts/check_release_change_set.py' \
  ':(exclude)infra/scripts/deploy.sh' \
  ':(exclude)infra/scripts/destroy.sh' \
  ':(exclude)infra/scripts/deploy-budget.sh' \
  pnpm-lock.yaml pnpm-workspace.yaml patches; then
  die "infrastructure sources changed since InfraRelease=$current_infra; deploy infrastructure from an engineer's machine first."
fi

api_changed=false
web_changed=false
if changed "$current_api" "$release" apps/api packages/contracts; then api_changed=true; fi
if changed "$current_web" "$release" apps/web packages/contracts; then web_changed=true; fi
if [[ "$api_changed" == false && "$web_changed" == false ]]; then
  echo "No API, web, or shared-contract changes since the deployed release."
  if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then
    echo "No API, web, or shared-contract changes since the deployed release; no services deployed." >> "$GITHUB_STEP_SUMMARY"
  fi
  exit 0
fi

group_json="$(aws autoscaling describe-auto-scaling-groups --auto-scaling-group-names "$group" --output json)"
min_instances="$(jq -er '.AutoScalingGroups[0].MinSize' <<<"$group_json")"
max_instances="$(jq -er '.AutoScalingGroups[0].MaxSize' <<<"$group_json")"
scaling_policy="$(aws autoscaling describe-policies --auto-scaling-group-name "$group" --policy-types TargetTrackingScaling --output json)"
target_rpm="$(jq -er '[.ScalingPolicies[] | select(.TargetTrackingConfiguration != null) | .TargetTrackingConfiguration.TargetValue][0]' <<<"$scaling_policy")"
scaling_warmup="$(jq -r '[.ScalingPolicies[] | select(.TargetTrackingConfiguration != null) | .EstimatedInstanceWarmup][0] // 480' <<<"$scaling_policy")"

tmp_dir="$(mktemp -d)"
old_web_worktree=""
pending_change_set=""
cleanup() {
  if [[ -n "$pending_change_set" ]]; then
    aws cloudformation delete-change-set --stack-name CartOptixPresentation --change-set-name "$pending_change_set" >/dev/null 2>&1 || true
  fi
  if [[ -n "$old_web_worktree" ]]; then git worktree remove --force "$old_web_worktree" >/dev/null 2>&1 || true; fi
  rm -rf "$tmp_dir"
}
trap cleanup EXIT

build_web_at() {
  local sha="$1"
  if [[ "$sha" == "$release" ]]; then
    pnpm --filter @cartoptix/web build >&2
    printf '%s\n' "$PWD/../apps/web/dist"
    return
  fi
  old_web_worktree="$tmp_dir/web-$sha"
  git worktree add --detach "$old_web_worktree" "$sha" >&2
  pnpm --dir "$old_web_worktree" install --frozen-lockfile >&2
  pnpm --dir "$old_web_worktree" --filter @cartoptix/web build >&2
  printf '%s\n' "$old_web_worktree/apps/web/dist"
}

deploy_change_set() {
  local method="$1" change_set="$2" api_sha="$3" web_sha="$4" web_dist="$5"
  pnpm exec cdk deploy CartOptixPresentation \
    -c release="$api_sha" \
    -c webRelease="$web_sha" \
    -c infraRelease="$current_infra" \
    -c webDist="$web_dist" \
    -c minInstances="$min_instances" \
    -c maxInstances="$max_instances" \
    -c targetRequestsPerMinute="$target_rpm" \
    -c scalingWarmupSeconds="$scaling_warmup" \
    -c alertEmail=unused@example.invalid \
    --method "$method" \
    --change-set-name "$change_set" \
    --require-approval never \
    --exclusively --ci
}

prepare_change_set() {
  local stage="$1" api_sha="$2" web_sha="$3" web_dist="$4"
  pending_change_set="cartoptix-${GITHUB_RUN_ID:-local}-$(date +%s)-$stage"
  deploy_change_set prepare-change-set "$pending_change_set" "$api_sha" "$web_sha" "$web_dist"
  local changes
  changes="$(aws cloudformation describe-change-set --stack-name CartOptixPresentation --change-set-name "$pending_change_set" --output json)"
  python3 scripts/check_release_change_set.py "$stage" <<<"$changes"
}

execute_change_set() {
  local api_sha="$1" web_sha="$2" web_dist="$3"
  deploy_change_set execute-change-set "$pending_change_set" "$api_sha" "$web_sha" "$web_dist"
  pending_change_set=""
}

wait_for_api() {
  local ready_url="$url/health/ready"
  for attempt in {1..60}; do
    if curl --fail --silent --show-error --max-time 10 "$ready_url" >/dev/null; then
      echo "API readiness passed at $ready_url."
      return
    fi
    sleep 5
  done
  return 1
}

api_release="$current_api"
web_dist=""
if [[ "$api_changed" == true ]]; then
  aws ecr describe-images --repository-name cartoptix-api --image-ids "imageTag=$release" >/dev/null \
    || die "no cartoptix-api image for $release. The Release publish job must succeed first."
  aws ecr describe-images --repository-name cartoptix-api --image-ids "imageTag=$current_api" >/dev/null \
    || die "the deployed API image $current_api is unavailable; refusing an API update without a rollback image."
  web_dist="$(build_web_at "$current_web")"
  prepare_change_set api "$release" "$current_web" "$web_dist"
  ./scripts/run-migrations.sh "$release" "$group"
  execute_change_set "$release" "$current_web" "$web_dist"
  if ! wait_for_api; then
    echo "API readiness failed; restoring API release $current_api before stopping." >&2
    prepare_change_set api "$current_api" "$current_web" "$web_dist"
    execute_change_set "$current_api" "$current_web" "$web_dist"
    wait_for_api || die "API readiness failed and restoring $current_api did not recover it."
    die "API readiness failed; restored $current_api and skipped web publication."
  fi
  api_release="$release"
fi

if [[ "$web_changed" == true ]]; then
  if [[ -z "$web_dist" || "$current_web" != "$release" ]]; then
    pnpm --filter @cartoptix/web build
    web_dist="$PWD/../apps/web/dist"
  fi
  prepare_change_set web "$api_release" "$release" "$web_dist"
  execute_change_set "$api_release" "$release" "$web_dist"
fi

echo "Presentation release complete: API=$api_release web=$([[ "$web_changed" == true ]] && echo "$release" || echo "$current_web")."
