#!/usr/bin/env bash
# Runs the Playwright suite against a throwaway SQL Server database, on Linux (CI) or macOS. On Windows use run.ps1.
#
#   E2E_SQL='Server=localhost,1433;User Id=sa;Password=...;TrustServerCertificate=true;Encrypt=false' bash run.sh [playwright args]
#
# Creates WTF_E2E_<time>_<id> (tools/E2eDb), starts the API on 5290 against it and the app on 4300 (the "e2e"
# configuration, which calls the API on 5290), runs the tests, then stops both and drops the database. Never uses the
# real WTF database. Needs: dotnet 10, node, jq, curl, setsid (Linux).
set -euo pipefail

cd "$(dirname "$0")"
ROOT="$(cd ../.. && pwd)"
API_PORT=5290
APP_PORT=4300
LOGS="${RUNNER_TEMP:-/tmp}/wtf-e2e"
mkdir -p "$LOGS"

: "${E2E_SQL:?Set E2E_SQL to the connection string of a SQL Server (the database name in it is ignored)}"
export E2E_SQL
# The password the throwaway test accounts get; random unless given.
export E2E_PASSWORD="${E2E_PASSWORD:-$(openssl rand -base64 18 | tr '+/' 'xy')Aa1!}"

API_PID=""
APP_PID=""
DB=""

stop_group() {
  if [ -n "${1:-}" ]; then
    kill -- "-$1" 2>/dev/null || kill "$1" 2>/dev/null || true
  fi
}

cleanup() {
  stop_group "$APP_PID"
  stop_group "$API_PID"
  if [ -n "$DB" ]; then
    sleep 2
    dotnet "$ROOT/tools/E2eDb/bin/Release/net10.0/E2eDb.dll" drop "$DB" >/dev/null 2>&1 || true
    echo "Dropped $DB."
  fi
}
trap cleanup EXIT

wait_for() {
  local url="$1" seconds="$2" what="$3"
  for ((waited = 0; waited < seconds; waited += 2)); do
    if curl -sf -o /dev/null -m 3 "$url"; then
      return 0
    fi
    sleep 2
  done
  echo "$what did not answer at $url within $seconds seconds. Last log lines:"
  tail -n 40 "$LOGS/api.log" "$LOGS/app.log" 2>/dev/null || true
  return 1
}

echo "Building the API and the database tool..."
dotnet build "$ROOT/tools/E2eDb/E2eDb.csproj" -c Release -v q --nologo >/dev/null

# A run that was cut short leaves its database behind: remove those first. This also waits for a SQL Server that is
# still starting (a container takes a while before it accepts logins).
for ((attempt = 1; attempt <= 36; attempt++)); do
  if dotnet "$ROOT/tools/E2eDb/bin/Release/net10.0/E2eDb.dll" drop-all 2>"$LOGS/sql-wait.log"; then
    break
  fi
  if [ "$attempt" -eq 36 ]; then
    echo "SQL Server did not accept a login in time:"
    cat "$LOGS/sql-wait.log"
    exit 1
  fi
  echo "Waiting for SQL Server ($attempt)..."
  sleep 5
done

echo "Creating the throwaway database..."
CREATED="$(dotnet "$ROOT/tools/E2eDb/bin/Release/net10.0/E2eDb.dll" create | tail -n 1)"
DB="$(echo "$CREATED" | jq -r .database)"
CONNECTION="$(echo "$CREATED" | jq -r .connectionString)"
echo "  $DB"

if curl -sf -o /dev/null -m 3 "http://localhost:$API_PORT/api/health"; then
  echo "Something already answers on port $API_PORT; stop it first (it may point at another database)."
  exit 1
fi

echo "Starting the API on $API_PORT..."
export ConnectionStrings__WtfDb="$CONNECTION" ASPNETCORE_ENVIRONMENT=Development RateLimiting__Multiplier=100
# Run from the output folder: appsettings.json is read from the content root.
setsid bash -c "cd '$ROOT/src/WTF.Api/bin/Release/net10.0' && exec dotnet WTF.Api.dll --urls http://localhost:$API_PORT" >"$LOGS/api.log" 2>&1 &
API_PID=$!
unset ConnectionStrings__WtfDb
wait_for "http://localhost:$API_PORT/api/health" 120 "The API"

echo "Starting the app on $APP_PORT..."
setsid bash -c "cd '$ROOT/src/wtf-pos' && exec npx ng serve --configuration e2e --port $APP_PORT" >"$LOGS/app.log" 2>&1 &
APP_PID=$!
wait_for "http://localhost:$APP_PORT" 300 "The app"

echo "Running the tests..."
set +e
npx playwright test "$@"
STATUS=$?
set -e
exit "$STATUS"
