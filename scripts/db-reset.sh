#!/usr/bin/env bash
# Reset the local database and restart the services that cache its state.
#
# `supabase db reset` drops and recreates the database underneath the running
# containers. GoTrue and Storage both hold connections and metadata across
# that, and afterwards fail in ways that look like application bugs:
#
#   auth     500 "Database error finding users"
#   storage  "An invalid response was received from the upstream server"
#
# Restarting them is the fix, so it belongs here rather than in whoever hits
# it next.
set -uo pipefail
cd "$(dirname "$0")/.."

PROJECT_ID="$(grep -m1 '^project_id' supabase/config.toml | cut -d'"' -f2)"

if ! docker info >/dev/null 2>&1; then
  echo "Docker is not running. Start Docker Desktop, then re-run." >&2
  exit 1
fi

env -u SUPABASE_ACCESS_TOKEN supabase db reset "$@" || true

applied="$(docker exec "supabase_db_${PROJECT_ID}" psql -U postgres -d postgres -tAc \
  "select count(*) from supabase_migrations.schema_migrations" 2>/dev/null || echo 0)"
expected="$(ls supabase/migrations/*.sql | wc -l | tr -d ' ')"

if [ "$applied" != "$expected" ]; then
  echo "Reset failed: $applied/$expected migrations applied." >&2
  exit 1
fi

for service in auth storage; do
  docker restart "supabase_${service}_${PROJECT_ID}" >/dev/null 2>&1 || true
done

# Wait until they are actually SERVING, not merely running: a container that
# is still shutting down accepts `docker exec` long before it answers HTTP,
# and a seeder that starts too early fails with an upstream error.
API_URL="$(grep -m1 '^\[api\]' -A4 supabase/config.toml >/dev/null 2>&1 && echo "http://127.0.0.1:$(grep -m1 -A3 '^\[api\]' supabase/config.toml | grep '^port' | tr -dc '0-9')")"
SERVICE_KEY="$(grep -m1 '^SUPABASE_SERVICE_ROLE_KEY=' .env.local 2>/dev/null | cut -d= -f2-)"

for _ in $(seq 1 60); do
  auth_ok=$(curl -s -o /dev/null -w '%{http_code}' "${API_URL}/auth/v1/health" 2>/dev/null || echo 000)
  storage_ok=$(curl -s -o /dev/null -w '%{http_code}' "${API_URL}/storage/v1/bucket" \
    -H "Authorization: Bearer ${SERVICE_KEY}" -H "apikey: ${SERVICE_KEY}" 2>/dev/null || echo 000)
  [ "$auth_ok" = "200" ] && [ "$storage_ok" = "200" ] && break
  sleep 1
done

echo "Database reset: $applied/$expected migrations, auth and storage restarted."
