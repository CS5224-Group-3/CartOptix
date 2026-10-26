#!/usr/bin/env bash
# Deploy changed application components to an existing presentation stack.
#
#   RELEASE   full commit SHA to release (default: GITHUB_SHA)
#   DRY_RUN   true: prepare and validate each change set against the live stack,
#             then discard it. No migrations, no execution.
set -euo pipefail
cd "$(dirname "$0")/.."

export AWS_REGION="${AWS_REGION:-ap-southeast-1}"
if [[ -z "${AWS_PROFILE:-}" && "${CI:-false}" != "true" ]]; then
  export AWS_PROFILE=cartoptix
fi

die() { echo "release: $*" >&2; exit 1; }
summary() {
  echo "$*"
  if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then echo "$*" >> "$GITHUB_STEP_SUMMARY"; fi
}

dry_run="${DRY_RUN:-false}"
release="${RELEASE:-${GITHUB_SHA:-}}"
[[ "$release" =~ ^[0-9a-f]{40}$ ]] || die "RELEASE must be a full commit SHA."
command -v aws >/dev/null || die "AWS CLI is required."
command -v jq >/dev/null || die "jq is required."
command -v python3 >/dev/null || die "Python 3 is required."

if ! stack_json="$(aws cloudformation describe-stacks --stack-name CartOptixPresentation --output json 2>&1)"; then
  if [[ "$stack_json" == *"does not exist"* ]]; then
    summary "Presentation stack is absent; application deployment skipped."
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

scope="$(python3 scripts/release_scope.py "$release" "$current_api" "$current_web" "$current_infra")"
if [[ "$(jq -r .infra <<<"$scope")" == true ]]; then
  die "infrastructure sources changed since InfraRelease=$current_infra; deploy infrastructure from an engineer's machine first."
fi
api_changed="$(jq -r .api <<<"$scope")"
web_changed="$(jq -r .web <<<"$scope")"
if [[ "$api_changed" == false && "$web_changed" == false ]]; then
  summary "No API, web, or shared-contract changes since the deployed release; no services deployed."
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
  pnpm exec cdk deploy CartOptixPresentation \
    -c release="$pending_api" \
    -c webRelease="$pending_web" \
    -c infraRelease="$current_infra" \
    -c webDist="$pending_dist" \
    -c minInstances="$min_instances" \
    -c maxInstances="$max_instances" \
    -c targetRequestsPerMinute="$target_rpm" \
    -c scalingWarmupSeconds="$scaling_warmup" \
    -c alertEmail=unused@example.invalid \
    --method "$1" \
    --change-set-name "$pending_change_set" \
    --require-approval never \
    --exclusively --ci
}

# What is deployed now; updated after each executed change set.
live_api="$current_api"
live_web="$current_web"
verdict=""

# Prepare a change set and validate it against the live stack. Sets $verdict
# to "execute" or "noop"; any unexpected change aborts the release.
prepare_change_set() {
  local stage="$1" file="$tmp_dir/$1"
  pending_api="$2" pending_web="$3" pending_dist="$4"
  pending_change_set="cartoptix-${GITHUB_RUN_ID:-local}-$(date +%s)-$stage"
  deploy_change_set prepare-change-set

  aws cloudformation describe-stacks --stack-name CartOptixPresentation --query 'Stacks[0]' --output json > "$file-stack.json"
  aws cloudformation get-template --stack-name CartOptixPresentation --template-stage Original \
    --query TemplateBody --output json > "$file-current.json"
  local description
  if description="$(aws cloudformation describe-change-set --stack-name CartOptixPresentation --change-set-name "$pending_change_set" --output json 2>&1)"; then
    :
  elif [[ "$description" == *ChangeSetNotFound* ]]; then
    # CDK discards a change set that CloudFormation reports as having no changes.
    description='{"Status":"FAILED","StatusReason":"The submitted information didn'"'"'t contain changes."}'
  else
    die "$description"
  fi
  printf '%s' "$description" > "$file-changes.json"
  if [[ "$(jq -r .Status "$file-changes.json")" == CREATE_COMPLETE ]]; then
    aws cloudformation get-template --stack-name CartOptixPresentation --change-set-name "$pending_change_set" \
      --template-stage Original --query TemplateBody --output json > "$file-proposed.json"
  else
    echo null > "$file-proposed.json"
  fi

  verdict="$(python3 scripts/check_release_change_set.py "$stage" \
    --change-set "$file-changes.json" --stack "$file-stack.json" \
    --current-template "$file-current.json" --proposed-template "$file-proposed.json" \
    --api-from "$live_api" --api-to "$pending_api" --web-from "$live_web" --web-to "$pending_web")" \
    || die "$stage change set rejected."
  if [[ "$dry_run" == true || "$verdict" == noop ]]; then discard_change_set; fi
}

discard_change_set() {
  aws cloudformation delete-change-set --stack-name CartOptixPresentation --change-set-name "$pending_change_set" >/dev/null 2>&1 || true
  pending_change_set=""
}

execute_change_set() {
  deploy_change_set execute-change-set
  live_api="$pending_api"
  live_web="$pending_web"
  pending_change_set=""
}

wait_for_api() {
  local ready_url="$url/health/ready"
  for _ in {1..60}; do
    if curl --fail --silent --show-error --max-time 10 "$ready_url" >/dev/null; then
      echo "API readiness passed at $ready_url."
      return
    fi
    sleep 5
  done
  return 1
}

web_dist=""
if [[ "$api_changed" == true ]]; then
  aws ecr describe-images --repository-name cartoptix-api --image-ids "imageTag=$release" >/dev/null \
    || die "no cartoptix-api image for $release. The Release publish job must succeed first."
  aws ecr describe-images --repository-name cartoptix-api --image-ids "imageTag=$current_api" >/dev/null \
    || die "the deployed API image $current_api is unavailable; refusing an API update without a rollback image."
  web_dist="$(build_web_at "$current_web")"
  prepare_change_set api "$release" "$current_web" "$web_dist"
  if [[ "$dry_run" == true ]]; then
    summary "Dry run: API change set for $release passed validation and was discarded."
  else
    ./scripts/run-migrations.sh "$release" "$group"
    execute_change_set
    if ! wait_for_api; then
      echo "API readiness failed; restoring API release $current_api before stopping." >&2
      prepare_change_set api "$current_api" "$current_web" "$web_dist"
      execute_change_set
      wait_for_api || die "API readiness failed and restoring $current_api did not recover it."
      die "API readiness failed; restored $current_api and skipped web publication."
    fi
  fi
fi

if [[ "$web_changed" == true ]]; then
  if [[ -z "$web_dist" || "$current_web" != "$release" ]]; then
    pnpm --filter @cartoptix/web build
    web_dist="$PWD/../apps/web/dist"
  fi
  prepare_change_set web "$live_api" "$release" "$web_dist"
  if [[ "$dry_run" == true ]]; then
    summary "Dry run: web change set for $release ($verdict) passed validation and was discarded."
  elif [[ "$verdict" == execute ]]; then
    execute_change_set
  else
    summary "Web assets for $release are unchanged; nothing to publish."
  fi
fi

if [[ "$dry_run" == true ]]; then exit 0; fi
summary "Presentation release complete: API=$live_api web=$live_web."
