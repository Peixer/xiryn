#!/bin/bash
# One-time, idempotent move from a single /opt/xiryn install to blue (active)
# and an empty green. The only downtime is one restart at the end.
set -euo pipefail

ROOT="${XIRYN_ROOT:-/opt/xiryn}"
BLUE=/opt/xiryn-blue
GREEN=/opt/xiryn-green
BLUE_DATA=/var/lib/xiryn/colours/blue
GREEN_DATA=/var/lib/xiryn/colours/green
# Tests point these at temp files. A real run uses /etc/xiryn.
SHARED="${XIRYN_SHARED_ENV:-/etc/xiryn/shared.env}"
BLUE_ENV="${XIRYN_BLUE_ENV:-/etc/xiryn/blue.env}"
GREEN_ENV="${XIRYN_GREEN_ENV:-/etc/xiryn/green.env}"
VAULT=/etc/xiryn/vault
DEPLOY=/var/lib/xiryn/deploy
STATE_FILE="${XIRYN_STATE_FILE:-$DEPLOY/state.json}"
CONF=/etc/xiryn-deploy.conf
ACTIVE=/etc/xiryn/active
SRC="$(cd "$(dirname "$0")" && pwd)"

# Production .env names XIRYN_DATA_DIR=/opt/xiryn/data. That path is shared and
# read-only under the colour sandbox. Drop the per-colour keys so shared.env
# cannot override /etc/xiryn/blue.env and green.env. Do not print the file.
strip_colour_env() {
  [[ -f "$SHARED" ]] || return 0
  local dir tmp
  dir="$(dirname "$SHARED")"
  tmp="$(mktemp "$dir/.shared.env.XXXXXX")"
  awk '
    {
      line = $0
      sub(/^[[:space:]]*export[[:space:]]+/, "", line)
      sub(/^[[:space:]]+/, "", line)
      key = line
      sub(/=.*/, "", key)
      gsub(/[[:space:]]+$/, "", key)
      if (key == "XIRYN_DATA_DIR" || key == "XIRYN_PORT" || key == "XIRYN_DESKTOP_PROXY_PORT" || key == "XIRYN_VAULT_KEY_DIR")
        next
      print
    }
  ' "$SHARED" > "$tmp"
  if [[ "$(id -u)" -eq 0 ]]; then
    chown --reference="$SHARED" "$tmp"
  fi
  chmod --reference="$SHARED" "$tmp"
  mv -f "$tmp" "$SHARED"
}

# sha256 of the old database path, first 16 hex digits. Same input Node uses
# for vault-${account}.key when XIRYN_VAULT_ACCOUNT is unset. No newline.
vault_account_of() {
  printf '%s' "$1" | sha256sum | awk 'NR == 1 { print substr($1, 1, 16) }'
}

read_vault_account() {
  [[ -f "$1" ]] || return 0
  sed -n 's/^XIRYN_VAULT_ACCOUNT=\([0-9a-f]\{16\}\)$/\1/p' "$1" | head -1
}

# Copy the colour env templates and pin XIRYN_VAULT_ACCOUNT. A later run keeps
# an account that is already written, so a second pass cannot rename the key.
write_colour_env() {
  local account old
  account="$(read_vault_account "$BLUE_ENV")"
  if [[ ! "$account" =~ ^[0-9a-f]{16}$ ]]; then
    account="$(read_vault_account "$GREEN_ENV")"
  fi
  if [[ ! "$account" =~ ^[0-9a-f]{16}$ ]]; then
    old="${data_dir:-}"
    if [[ -z "$old" && -f "$SHARED" ]]; then
      old="$(sed -n 's/^XIRYN_DATA_DIR=//p' "$SHARED" | head -1)"
    fi
    old="${old:-${ROOT}/data}"
    old="${old%/}/xiryn.db"
    account="$(vault_account_of "$old")"
  fi
  if [[ ! "$account" =~ ^[0-9a-f]{16}$ ]]; then
    echo "Could not name the vault account." >&2
    exit 1
  fi
  install -d -m 0755 "$(dirname "$BLUE_ENV")" "$(dirname "$GREEN_ENV")"
  install -m 0644 "$SRC/xiryn-blue.env" "$BLUE_ENV"
  install -m 0644 "$SRC/xiryn-green.env" "$GREEN_ENV"
  printf 'XIRYN_VAULT_ACCOUNT=%s\n' "$account" >> "$BLUE_ENV"
  printf 'XIRYN_VAULT_ACCOUNT=%s\n' "$account" >> "$GREEN_ENV"
  chmod 644 "$BLUE_ENV" "$GREEN_ENV"
}

deployed_sha() {
  local tree="$1"
  local sha=""
  if [[ -n "$tree" && -e "$tree/.git" ]]; then
    sha="$(git -C "$tree" rev-parse --verify HEAD 2>/dev/null || true)"
  fi
  printf '%s\n' "$sha"
}

# state.json is what the Update screen reads for "This commit". Re-running
# leaves a file that already names a commit, so a later prepare is not reset.
write_install_state() {
  local sha="$1"
  local colour="$2"
  local file="${STATE_FILE}"
  if [[ -f "$file" ]] && grep -Eq '"activeSha"[[:space:]]*:[[:space:]]*"[0-9a-f]{40}"' "$file"; then
    return 0
  fi
  if [[ ! "$sha" =~ ^[0-9a-f]{40}$ ]]; then
    echo "The deployed tree has no commit, so the update screen cannot name it." >&2
    return 1
  fi
  if [[ "$colour" != "blue" && "$colour" != "green" ]]; then
    echo "The active colour is not blue or green." >&2
    return 1
  fi
  local name dir tmp
  name="${branch:-main}"
  if [[ ! "$name" =~ ^[A-Za-z0-9._/-]+$ || "$name" == *..* ]]; then
    echo "BRANCH is not a single branch name." >&2
    return 1
  fi
  dir="$(dirname "$file")"
  if [[ ! -d "$dir" ]]; then
    if [[ "$(id -u)" -eq 0 ]] && id xiryn >/dev/null 2>&1; then
      install -d -o xiryn -g xiryn -m 0700 "$dir"
    else
      install -d -m 0700 "$dir"
    fi
  fi
  tmp="$(mktemp "$dir/.state.json.XXXXXX")"
  cat > "$tmp" <<EOF
{
  "phase": "active",
  "active": "${colour}",
  "activeSha": "${sha}",
  "previous": null,
  "previousSha": null,
  "candidate": null,
  "candidateSha": null,
  "branch": "${name}",
  "error": null,
  "maintenance": false,
  "baseline": "active",
  "operation": null
}
EOF
  if [[ "$(id -u)" -eq 0 ]] && id xiryn >/dev/null 2>&1; then
    chown xiryn:xiryn "$tmp"
  fi
  chmod 644 "$tmp"
  mv -f "$tmp" "$file"
}

if [[ "${XIRYN_STRIP_ONLY:-}" == "1" ]]; then
  strip_colour_env
  exit 0
fi

if [[ "${XIRYN_COLOUR_ENV_ONLY:-}" == "1" ]]; then
  data_dir="${XIRYN_OLD_DATA:-${data_dir:-}}"
  write_colour_env
  exit 0
fi

if [[ "${XIRYN_STATE_ONLY:-}" == "1" ]]; then
  branch="${XIRYN_STATE_BRANCH:-${branch:-main}}"
  write_install_state "${XIRYN_STATE_SHA:-}" "${XIRYN_STATE_COLOUR:-blue}"
  exit $?
fi

if [[ "${XIRYN_SHA_ONLY:-}" == "1" ]]; then
  deployed_sha "${XIRYN_SHA_TREE:-}"
  exit 0
fi

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run this as root: sudo bash deploy/migrate-blue-green.sh" >&2
  exit 1
fi

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

# Caches live here because the deploy unit keeps ProtectHome=read-only.
# /var/backups/xiryn stays root mode 0700; the helper stages elsewhere.
install_runtime_dirs() {
  install -d -o xiryn -g xiryn -m 0700 \
    "$DEPLOY" "$DEPLOY/inbox" "$DEPLOY/audit" \
    "$DEPLOY/npm-cache" "$DEPLOY/cache" "$DEPLOY/config" "$DEPLOY/staging"
  install -d -o root -g root -m 0700 /var/backups/xiryn
}

install_colour_files() {
  install -d -m 0755 /etc/xiryn
  write_colour_env
  install -m 0644 "$SRC/xiryn-blue.service" /etc/systemd/system/xiryn-blue.service
  install -m 0644 "$SRC/xiryn-green.service" /etc/systemd/system/xiryn-green.service
  strip_colour_env
}

if [[ -f "$ACTIVE" && -d "$BLUE" && -f /etc/systemd/system/xiryn-blue.service ]]; then
  ensure_mirror
  install -d -o xiryn -g xiryn -m 0700 "$GREEN_DATA"
  install -d -m 0755 "$GREEN"
  install_runtime_dirs
  install_colour_files
  install -m 0644 "$SRC/xiryn-deploy.service" /etc/systemd/system/xiryn-deploy.service
  active="$(tr -d '[:space:]' < "$ACTIVE")"
  tree="$BLUE"
  if [[ "$active" == "green" ]]; then
    tree="$GREEN"
  fi
  if [[ "$active" != "blue" && "$active" != "green" ]]; then
    active=blue
    tree="$BLUE"
  fi
  if ! write_install_state "$(deployed_sha "$tree")" "$active"; then
    echo "The update screen still has no commit. The colour was left running." >&2
  fi
  systemctl daemon-reload
  echo "Blue/green is already installed (active: ${active})."
  if [[ "$active" == "blue" || "$active" == "green" ]]; then
    echo "Restart the serving colour so it loads its env file: systemctl restart xiryn-${active}.service"
  else
    echo "Restart the serving colour so it loads its env file."
  fi
  exit 0
fi

if [[ ! -d "$ROOT" ]]; then
  echo "No install at $ROOT. Set XIRYN_ROOT." >&2
  exit 1
fi

install -d -m 0755 /etc/xiryn /usr/local/lib/xiryn /usr/local/sbin
install -d -o xiryn -g xiryn -m 0700 "$BLUE_DATA" "$GREEN_DATA" "$VAULT"
install_runtime_dirs

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

# Read the old data directory before strip_colour_env removes XIRYN_DATA_DIR.
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
install_colour_files
sha="$(deployed_sha "$BLUE")"
if [[ ! "$sha" =~ ^[0-9a-f]{40}$ ]]; then
  sha="$(deployed_sha "$ROOT")"
fi
write_install_state "$sha" blue
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
