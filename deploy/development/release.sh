#!/usr/bin/env bash
#
# Release a published CartOptix build on the development host.
#
# Issue #7. The host never builds: CI builds and publishes arm64 images tagged
# with the Git commit that produced them, and this script pulls them by that
# tag. Two consequences matter here:
#
#   * migrations and the seed import run once per release, from the released
#     image, not on every start and not on every instance;
#   * an earlier release is restored by running this script with its commit SHA,
#     which needs no schema rollback.
#
# Usage
#   bash release.sh <commit-sha>
#   SKIP_PULL=1 bash release.sh <commit-sha>   # use an image already on the host
#
# The exit status is 0 only when /health/ready returned 200 for the new release.
# See RUNBOOK.md for the release, rollback and smoke-check procedures.

set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$script_dir"

readonly POSTGRES_VOLUME="cartoptix-postgres-data"
readonly NETWORK="cartoptix-net"
readonly READY_ATTEMPTS="${READY_ATTEMPTS:-30}"

say() { printf '\n==> %s\n' "$*"; }
fail() { printf '\nRelease failed: %s\n' "$*" >&2; exit 1; }

release="${1:-${RELEASE:-}}"
if [[ ! "$release" =~ ^[0-9a-f]{40}$ ]]; then
  fail "expected a 40-character Git commit SHA.
Usage: bash release.sh <commit-sha>"
fi
# docker compose reads RELEASE from the environment before .env, so the argument
# always wins. That is what makes a rollback a plain re-run of this script.
export RELEASE="$release"

[[ -f .env ]] || fail "missing deploy/development/.env; copy .env.example to .env and fill it in."

# Read the registry without sourcing the file, so the database password never
# enters this shell's environment.
image_registry="$(sed -n 's/^IMAGE_REGISTRY=//p' .env | tail -n 1)"
[[ -n "$image_registry" ]] || fail "IMAGE_REGISTRY is not set in .env; see .env.example."

# Probe the port compose publishes web on, resolved the same way compose does:
# the environment first, then .env, then the default.
web_port="${WEB_PORT:-$(sed -n 's/^WEB_PORT=//p' .env | tail -n 1)}"
readonly READY_URL="http://127.0.0.1:${web_port:-80}/health/ready"

compose() { docker compose "$@"; }

say "Releasing $release"

say 'Checking host prerequisites'
command -v docker >/dev/null 2>&1 || fail "docker is not installed."
command -v curl >/dev/null 2>&1 || fail "curl is not installed."
docker info >/dev/null 2>&1 || fail "Docker is not running."
docker compose version >/dev/null

say 'Ensuring the persistent Docker resources exist'
# The PostgreSQL volume must survive redeployment; a release must never delete it.
docker volume inspect "$POSTGRES_VOLUME" >/dev/null 2>&1 \
  || docker volume create "$POSTGRES_VOLUME"
docker network inspect "$NETWORK" >/dev/null 2>&1 \
  || docker network create "$NETWORK"

if [[ "${SKIP_PULL:-}" == "1" ]]; then
  say 'Skipping the image pull (SKIP_PULL=1)'
else
  if [[ "$image_registry" == *.amazonaws.com* ]] && command -v aws >/dev/null 2>&1; then
    # The instance profile grants read access to the registry, but Docker still
    # needs a login token before it can pull.
    region="${AWS_REGION:-$(printf '%s' "$image_registry" | cut -d. -f4)}"
    say "Authenticating to $image_registry in $region"
    aws ecr get-login-password --region "$region" \
      | docker login --username AWS --password-stdin "$image_registry"
  fi

  say 'Pulling the release images'
  compose pull postgres api web
fi

say 'Starting PostgreSQL'
compose up --detach --wait postgres

say 'Applying database migrations (once per release)'
compose --profile ops run --rm migrate

say 'Importing the curated seed (once per release)'
compose --profile ops run --rm seed

say 'Recreating api'
compose up --detach --force-recreate api

# web is nginx and proxies /api and /health to the hostname "api". Recreating api
# replaces its container, so web must be recreated afterwards or it keeps
# resolving the old address and returns 502.
say 'Restarting web after api'
compose up --detach --force-recreate web

say "Waiting for $READY_URL to return 200"
ready="no"
for attempt in $(seq 1 "$READY_ATTEMPTS"); do
  status="$(curl --silent --output /dev/null --write-out '%{http_code}' \
    --max-time 5 "$READY_URL" || true)"
  if [[ "$status" == "200" ]]; then
    printf 'Readiness returned 200 on attempt %s.\n' "$attempt"
    ready="yes"
    break
  fi
  sleep 2
done

if [[ "$ready" != "yes" ]]; then
  printf '\n' >&2
  compose ps >&2
  compose logs --tail 50 api >&2
  fail "$READY_URL did not return 200 for release $release"
fi

say 'Running release'
# This is how a reviewer confirms which commit is live. Docker's template
# language has no trimPrefix, so drop the leading slash with slice instead.
docker inspect \
  --format '{{slice .Name 1}}  {{.Config.Image}}  release={{index .Config.Labels "com.cartoptix.release"}}' \
  cartoptix-api cartoptix-web

printf '\nRelease %s is live.\n' "$release"
