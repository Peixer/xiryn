#!/usr/bin/env bash
# Pull, install, build and restart Xiryn on the server.
# Layout default is /opt/xiryn. Override with XIRYN_ROOT.
set -euo pipefail

ROOT="${XIRYN_ROOT:-/opt/xiryn}"
cd "$ROOT"

if [[ -d .git ]]; then
  git pull --ff-only
fi

npm install
npm run build

restart() {
  if [[ "$(id -u)" -eq 0 ]]; then
    systemctl restart xiryn
  else
    sudo systemctl restart xiryn
  fi
}

if systemctl cat xiryn.service >/dev/null 2>&1; then
  restart
  echo "Restarted xiryn."
else
  echo "Built $ROOT. No xiryn.service is installed; start it with: npm run start"
fi
