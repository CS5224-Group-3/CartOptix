#!/usr/bin/env bash
# Read-only check of the development host. Run on the instance in the repo's
# deploy/development directory, or pass that directory's path as $1.
#   EXPECT_SHA   commit the host should be running (default: origin/main)
#   EXPECT_COUNTS products|listings|retailers (default: 294|623|3)
set -u
cd "${1:-.}" || exit 2
fail=0
check() { # check <name> <command...>
  local name=$1; shift
  if out=$("$@" 2>&1); then printf 'PASS  %s\n' "$name"; else printf 'FAIL  %s: %s\n' "$name" "$out"; fail=1; fi
}
eq() { [ "$1" = "$2" ] || { echo "got '$1', want '$2'"; return 1; }; }

git fetch -q origin
want=${EXPECT_SHA:-$(git rev-parse origin/main)}
check "deployed commit is $want" eq "$(git rev-parse HEAD)" "$want"
check ".env present" test -f .env
check "volume cartoptix-postgres-data" docker volume inspect cartoptix-postgres-data
check "network cartoptix-net" docker network inspect cartoptix-net
for c in cartoptix-api cartoptix-postgres cartoptix-web; do
  check "$c running" eq "$(docker inspect -f '{{.State.Status}}' $c)" running
done
check "postgres healthy" eq "$(docker inspect -f '{{.State.Health.Status}}' cartoptix-postgres)" healthy
# docker port lists a container's published ports on every address family.
check "cartoptix-web publishes a port" test -n "$(docker port cartoptix-web)"
for c in cartoptix-api cartoptix-postgres; do
  check "$c publishes no port" eq "$(docker port $c)" ""
done
check "/health/ready is 200" eq "$(curl -s -o /dev/null -w '%{http_code}' localhost/health/ready)" 200
check "/api/v1/catalogue is 200" eq "$(curl -s -o /dev/null -w '%{http_code}' localhost/api/v1/catalogue)" 200
seed_counts() {
  local got
  got=$(docker exec cartoptix-postgres sh -c 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc "select (select count(*) from products)||chr(124)||(select count(*) from listings)||chr(124)||(select count(*) from retailers)"' 2>&1) || { echo "query failed: $got"; return 1; }
  eq "$got" "${EXPECT_COUNTS:-294|623|3}"
}
check "seed counts" seed_counts
exit $fail
