#!/usr/bin/env bash
# Reset the local database and run every SQL suite in supabase/tests, in order.
#
# A failing assertion raises errcode P0001 ('FAIL: ...'), which none of the
# suites' handlers catch, so psql aborts under ON_ERROR_STOP and this script
# exits non-zero.
set -uo pipefail

cd "$(dirname "$0")/.."
PROJECT_ID="$(grep -m1 '^project_id' supabase/config.toml | cut -d'"' -f2)"
CONTAINER="supabase_db_${PROJECT_ID}"

if ! docker info >/dev/null 2>&1; then
  echo "Docker is not running. Start Docker Desktop, then re-run." >&2
  exit 1
fi

echo "==> Resetting local database"
# `db reset` can exit non-zero purely because the CLI's storage healthcheck is
# stale against a newer storage image, so its status is not a reliable signal.
# Verify the reset by asking the database what it actually has instead.
env -u SUPABASE_ACCESS_TOKEN supabase db reset >/dev/null 2>&1 || true

applied="$(docker exec "$CONTAINER" psql -U postgres -d postgres -tAc \
  "select count(*) from supabase_migrations.schema_migrations" 2>/dev/null || echo 0)"
expected="$(ls supabase/migrations/*.sql | wc -l | tr -d ' ')"
if [ "$applied" != "$expected" ]; then
  echo "Reset failed: $applied/$expected migrations applied." >&2
  exit 1
fi
echo "    $applied/$expected migrations applied"

status=0
out="$(mktemp)"
trap 'rm -f "$out"' EXIT

for f in supabase/tests/*.sql; do
  echo "==> $(basename "$f")"
  docker cp "$f" "$CONTAINER:/tmp/$(basename "$f")" >/dev/null

  if ! docker exec "$CONTAINER" psql -U postgres -d postgres -q -v ON_ERROR_STOP=1 \
        -f "/tmp/$(basename "$f")" >"$out" 2>&1; then
    status=1
  fi
  grep -Ev '^\s*$' "$out" || true

  # A raised exception aborts psql, but a boolean assertion that simply
  # evaluates to FALSE does not -- psql prints " f " and exits 0. Without
  # this, a failing assertion looks exactly like a passing run.
  if grep -qE '(^| \| ) *f *( \||$)' "$out"; then
    echo "  !! FALSE ASSERTION in $(basename "$f"):" >&2
    grep -nE '(^| \| ) *f *( \||$)' "$out" >&2
    status=1
  fi
done

if [ "$status" -ne 0 ]; then
  echo "SQL SUITES FAILED" >&2
  exit 1
fi
echo "==> SQL suites passed"
