#!/usr/bin/env bash
# Sets up a fresh Linux cloud workspace (Ubuntu 24.04, root) to run the Playwright suite with run.sh.
#
#   bash src/wtf-e2e/cloud-setup.sh
#   export PATH=$PATH:/opt/dotnet DOTNET_ROOT=/opt/dotnet
#   export E2E_SQL='Server=localhost,1433;User Id=sa;Password=<the one printed>;TrustServerCertificate=true;Encrypt=false'
#   CI=1 E2E_WORKERS=4 bash src/wtf-e2e/run.sh tests/tenancy
#
# Needs these hosts allowed by the workspace network: dot.net, builds.dotnet.microsoft.com, packages.microsoft.com and
# pmc-geofence.trafficmanager.net. Safe to run twice.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SA_PASSWORD="${MSSQL_SA_PASSWORD:-E2e-Cloud-$(openssl rand -hex 6)-Aa1!}"

if [ ! -x /opt/dotnet/dotnet ]; then
  curl -sSL https://dot.net/v1/dotnet-install.sh -o /tmp/dotnet-install.sh
  bash /tmp/dotnet-install.sh --channel 10.0 --install-dir /opt/dotnet
fi

if [ ! -x /opt/mssql/bin/sqlservr ]; then
  curl -sSL https://packages.microsoft.com/keys/microsoft.asc | gpg --dearmor -o /usr/share/keyrings/microsoft-prod.gpg
  echo "deb [arch=amd64 signed-by=/usr/share/keyrings/microsoft-prod.gpg] https://packages.microsoft.com/ubuntu/24.04/mssql-server-2025 noble main" > /etc/apt/sources.list.d/mssql.list
  apt-get update -qq
  ACCEPT_EULA=Y DEBIAN_FRONTEND=noninteractive apt-get install -y -qq mssql-server jq
fi

# No systemd in the workspace: start SQL Server detached, or it dies with the shell. The memory cap keeps room for the browsers.
if ! (echo > /dev/tcp/127.0.0.1/1433) 2>/dev/null; then
  MSSQL_SA_PASSWORD="$SA_PASSWORD" ACCEPT_EULA=Y MSSQL_PID=Developer MSSQL_MEMORY_LIMIT_MB=3072 \
    setsid nohup /opt/mssql/bin/sqlservr > /tmp/sqlservr.log 2>&1 < /dev/null &
  sleep 20
fi

(cd "$ROOT/src/wtf-e2e" && npm ci)
(cd "$ROOT/src/wtf-pos" && npm ci)

# The preinstalled browsers can be one build older than the repo's Playwright wants, and the download host is blocked:
# link the wanted build names to the ones that are there.
PW_BROWSERS="${PLAYWRIGHT_BROWSERS_PATH:-/opt/pw-browsers}"
WANT="$(cd "$ROOT/src/wtf-e2e" && node -e "const r=JSON.parse(require('fs').readFileSync('node_modules/playwright-core/browsers.json','utf8')).browsers;console.log(r.find(b=>b.name==='chromium-headless-shell').revision)")"
for kind in chromium chromium_headless_shell; do
  if [ ! -e "$PW_BROWSERS/$kind-$WANT" ]; then
    HAVE="$(ls -d "$PW_BROWSERS/$kind"-[0-9]* | head -n 1)"
    ln -s "$HAVE" "$PW_BROWSERS/$kind-$WANT"
  fi
done

echo "Ready. SQL Server sa password: $SA_PASSWORD (only valid for a server started by this script)"
