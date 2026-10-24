#!/bin/bash
# One-time, idempotent move from a single /opt/xiryn install to blue (active)
# and an empty green. The only downtime is one restart at the end.
set -euo pipefail

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run this as root: sudo bash deploy/migrate-blue-green.sh" >&2
  exit 1
fi

ROOT="${XIRYN_ROOT:-/opt/xiryn}"
BLUE=/opt/xiryn-blue
GREEN=/opt/xiryn-green
BLUE_DATA=/var/lib/xiryn/colours/blue
GREEN_DATA=/var/lib/xiryn/colours/green
SHARED=/etc/xiryn/shared.env
VAULT=/etc/xiryn/vault
DEPLOY=/var/lib/xiryn/deploy
CONF=/etc/xiryn-deploy.conf
ACTIVE=/etc/xiryn/active
SRC="$(cd "$(dirname "$0")" && pwd)"

if ! id xiryn >/dev/null 2>&1; then
  echo "The xiryn user does not exist." >&2
  exit 1
fi
XIRYN_HOME="$(getent passwd xiryn | cut -d: -f6)"
if [[ -z "$XIRYN_HOME" || "$XIRYN_HOME" != /* ]]; then
  echo "The xiryn user has no home directory." >&2
  exit 1
fi

branch=main
remote="https://github.com/Peixer/xiryn.git"
mirror=/var/lib/xiryn-pin.git

read_pin() {
  branch=main
  remote="https://github.com/Peixer/xiryn.git"
  mirror=/var/lib/xiryn-pin.git
  if [[ -f "$CONF" ]]; then
    local value
    value="$(sed -n 's/^BRANCH=//p' "$CONF" | head -1)"
    [[ -n "$value" ]] && branch="$value"
    value="$(sed -n 's/^REMOTE=//p' "$CONF" | head -1)"
    [[ -n "$value" ]] && remote="$value"
    value="$(sed -n 's/^MIRROR=//p' "$CONF" | head -1)"
    [[ -n "$value" ]] && mirror="$value"
  fi
  if [[ ! "$branch" =~ ^[A-Za-z0-9._/-]+$ || "$branch" == *..* ]]; then
    echo "BRANCH in the deploy config is not a single branch name." >&2
    exit 1
  fi
  if [[ ! "$remote" =~ ^https://[A-Za-z0-9._/-]+$ ]]; then
    echo "REMOTE in the deploy config must be an https git URL." >&2
    exit 1
  fi
  if [[ ! "$mirror" =~ ^/[A-Za-z0-9._/-]+$ || "$mirror" == *..* ]]; then
    echo "MIRROR in the deploy config is not a safe path." >&2
    exit 1
  fi
}

# Root-owned bare mirror. The service user can read it. Fetch stays root.
ensure_mirror() {
  read_pin
  if [[ -d "$mirror" ]]; then
    return 0
  fi
  echo "Creating the pin mirror."
  install -d -m 0755 "$(dirname "$mirror")"
  git clone --bare "$remote" "$mirror"
  chown -R root:root "$mirror"
  chmod -R u+rwX,go+rX "$mirror"
  git --git-dir "$mirror" fetch --prune origin "+refs/heads/${branch}:refs/heads/${branch}"
}

if [[ -f "$ACTIVE" && -d "$BLUE" && -f /etc/systemd/system/xiryn-blue.service ]]; then
  ensure_mirror
  install -d -o xiryn -g xiryn -m 0700 "$GREEN_DATA" "$DEPLOY/inbox" "$DEPLOY/audit"
  install -d -m 0755 "$GREEN"
  echo "Blue/green is already installed (active: $(cat "$ACTIVE"))."
  exit 0
fi

if [[ ! -d "$ROOT" ]]; then
  echo "No install at $ROOT. Set XIRYN_ROOT." >&2
  exit 1
fi

install -d -m 0755 /etc/xiryn /usr/local/lib/xiryn /usr/local/sbin
install -d -o xiryn -g xiryn -m 0700 "$BLUE_DATA" "$GREEN_DATA" "$DEPLOY" "$DEPLOY/inbox" "$DEPLOY/audit" "$VAULT"
install -d -m 0700 /var/backups/xiryn

if [[ ! -f "$SHARED" ]]; then
  if [[ -f "$ROOT/.env" ]]; then
    install -o root -g xiryn -m 0640 "$ROOT/.env" "$SHARED"
  else
    echo "No $ROOT/.env and no $SHARED." >&2
    exit 1
  fi
fi

# Vault key stays readable by the service and not writable by it.
# Production keeps it in the service user's home (~xiryn/.xiryn). The key
# bytes are never printed.
shopt -s nullglob
for dir in /var/lib/xiryn/.xiryn "$ROOT/.xiryn" "$XIRYN_HOME/.xiryn"; do
  [[ -d "$dir" ]] || continue
  for key in "$dir"/vault-*.key; do
    [[ -f "$key" ]] || continue
    base="$(basename "$key")"
    if [[ ! -f "$VAULT/$base" ]]; then
      install -o root -g xiryn -m 0640 "$key" "$VAULT/$base"
    fi
  done
done
shopt -u nullglob

if [[ ! -f "$CONF" ]]; then
  branch=main
  if [[ -f /etc/xiryn-deploy.conf ]]; then
    branch="$(sed -n 's/^BRANCH=//p' /etc/xiryn-deploy.conf | head -1)"
    branch="${branch:-main}"
  fi
  install -m 0644 "$SRC/xiryn-deploy.conf.example" "$CONF"
  if [[ "$branch" != "main" ]]; then
    sed -i "s/^BRANCH=.*/BRANCH=${branch}/" "$CONF"
  fi
fi

ensure_mirror

echo "Copying the running tree to $BLUE (the process keeps serving)."
install -d -o xiryn -g xiryn -m 0755 "$BLUE"
rsync -a --delete --exclude '.env' --exclude 'data' "$ROOT/" "$BLUE/"
rm -f "$BLUE/.env"
chown -R xiryn:xiryn "$BLUE"
install -d -o xiryn -g xiryn -m 0755 "$GREEN"

# Consistent database copy while the old process is still up.
data_dir="$(sed -n 's/^XIRYN_DATA_DIR=//p' "$SHARED" | head -1)"
data_dir="${data_dir:-$ROOT/data}"
if [[ -f "$data_dir/xiryn.db" ]]; then
  vault_rows="$(
    sudo -u xiryn env NODE_PATH="$ROOT/node_modules" XIRYN_PKG="$ROOT/package.json" XIRYN_DB="$data_dir/xiryn.db" \
      node --input-type=module - <<'EOF'
import { createRequire } from "node:module"
const require = createRequire(process.env.XIRYN_PKG)
const Database = require("better-sqlite3")
const db = new Database(process.env.XIRYN_DB, { readonly: true, fileMustExist: true })
const table = db.prepare("select count(*) as n from sqlite_master where type = 'table' and name = 'vault_items'").get()
let n = 0
if (table && table.n > 0) n = db.prepare("select count(*) as n from vault_items").get().n
db.close()
process.stdout.write(String(n))
EOF
  )"
  shopt -s nullglob
  keys=( "$VAULT"/vault-*.key )
  shopt -u nullglob
  if [[ "$vault_rows" != "0" && ${#keys[@]} -eq 0 ]]; then
    echo "The database has vault entries, and no vault key was found." >&2
    echo "Looked in ${XIRYN_HOME}/.xiryn, /var/lib/xiryn/.xiryn, and ${ROOT}/.xiryn." >&2
    exit 1
  fi
  sudo -u xiryn env NODE_PATH="$ROOT/node_modules" node "$SRC/../scripts/self-update-snapshot.mjs" --from "$data_dir" --to "$BLUE_DATA"
  chown -R xiryn:xiryn "$BLUE_DATA"
  find "$BLUE_DATA" -type f -exec chmod 600 {} +
fi

install -m 0755 "$SRC/xiryn-helper" /usr/local/sbin/xiryn-helper
install -m 0644 "$SRC/xiryn-helper.ts" /usr/local/lib/xiryn/xiryn-helper.ts
install -m 0644 "$SRC/../scripts/self-update-snapshot.mjs" /usr/local/lib/xiryn/self-update-snapshot.mjs
install -m 0644 "$SRC/../scripts/self-update-migrate.mjs" /usr/local/lib/xiryn/self-update-migrate.mjs
install -m 0644 "$SRC/../scripts/self-update-approval.mjs" /usr/local/lib/xiryn/self-update-approval.mjs
install -m 0644 "$SRC/xiryn-blue.service" /etc/systemd/system/xiryn-blue.service
install -m 0644 "$SRC/xiryn-green.service" /etc/systemd/system/xiryn-green.service
install -m 0644 "$SRC/xiryn-deploy.service" /etc/systemd/system/xiryn-deploy.service
install -m 0644 "$SRC/xiryn-deploy.path" /etc/systemd/system/xiryn-deploy.path

cat > /etc/caddy/xiryn-upstreams.caddy <<'EOF'
# Generated by migrate-blue-green.sh. No secrets.
(xiryn_active) {
	reverse_proxy 127.0.0.1:6796 {
		flush_interval -1
		header_up Host {host}
		header_up X-Forwarded-Host {host}
		header_up X-Forwarded-Proto {scheme}
	}
}
(xiryn_desktop) {
	reverse_proxy 127.0.0.1:6797
}
(xiryn_standby) {
	reverse_proxy 127.0.0.1:6896 {
		flush_interval -1
		header_up Host {host}
		header_up X-Forwarded-Host {host}
		header_up X-Forwarded-Proto {scheme}
	}
}
(xiryn_standby_desktop) {
	reverse_proxy 127.0.0.1:6897
}
EOF
chmod 644 /etc/caddy/xiryn-upstreams.caddy

if [[ -f /etc/caddy/Caddyfile && ! -f /etc/caddy/Caddyfile.pre-bluegreen ]]; then
  install -m 0600 /etc/caddy/Caddyfile /var/backups/xiryn/Caddyfile.pre-bluegreen
  cp -a /etc/caddy/Caddyfile /etc/caddy/Caddyfile.pre-bluegreen
fi

systemctl daemon-reload
systemctl enable xiryn-blue.service xiryn-deploy.path
systemctl start xiryn-deploy.path

echo "Restarting onto blue. The old unit stops only after blue is enabled."
systemctl disable --now xiryn.service 2>/dev/null || true
systemctl restart xiryn-blue.service

# Up to 90s. Next can take a while to listen after a cold start.
for _ in $(seq 1 45); do
  if curl -fsS --max-time 3 -H 'Host: 127.0.0.1' http://127.0.0.1:6796/api/health >/dev/null; then
    echo blue > "$ACTIVE"
    chmod 644 "$ACTIVE"
    echo "Blue answered /api/health."
    echo "Point Caddy at the snippet in deploy/Caddyfile.bluegreen, then: systemctl reload caddy"
    echo "The old tree is still at $ROOT. Remove it after you have switched once."
    exit 0
  fi
  sleep 2
done

echo "Blue did not become healthy. Re-enabling the previous unit." >&2
systemctl enable xiryn.service || true
systemctl start xiryn.service || true
exit 1
