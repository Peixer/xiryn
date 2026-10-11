#!/usr/bin/env bash
# Oryn — one-step setup for macOS and Linux.
#
#   curl -fsSL https://raw.githubusercontent.com/SouravBeraAkaSpeed/oryn/main/setup.sh | bash
#
# or, inside a clone:  ./setup.sh
#
# Installs whatever is missing (Git, Node.js, Docker), then Oryn's packages
# and the agents' workstation image, and starts Oryn. It asks once before
# installing anything. ORYN_YES=1 skips the question.
# --no-start sets everything up without starting Oryn.

set -euo pipefail

REPO="https://github.com/SouravBeraAkaSpeed/oryn.git"
NODE_MAJOR=22

bold=$'\033[1m'; dim=$'\033[2m'; green=$'\033[32m'; yellow=$'\033[33m'; red=$'\033[31m'; reset=$'\033[0m'
ok() { printf '%s✓%s %s\n' "$green" "$reset" "$1"; }
note() { printf '%s!%s %s\n' "$yellow" "$reset" "$1"; }
fail() { printf '%s✗%s %s\n' "$red" "$reset" "$1"; exit 1; }
has() { command -v "$1" >/dev/null 2>&1; }

ask() {
  [ "${ORYN_YES:-}" = 1 ] && return 0
  [ -r /dev/tty ] || return 1
  local answer
  read -r -p "  $1 ${dim}[Y/n]${reset} " answer </dev/tty || return 1
  [[ -z "$answer" || "$answer" =~ ^[Yy] ]]
}

printf '\n  %soryn%s · setup\n\n' "$bold" "$reset"

os="$(uname -s)"
case "$os" in
  Darwin) platform=mac ;;
  Linux) platform=linux ;;
  *) fail "This script is for macOS and Linux. On Windows, run setup.cmd." ;;
esac

sudo_cmd=""
if [ "$platform" = linux ] && [ "$(id -u)" -ne 0 ]; then sudo_cmd="sudo"; fi

# The package manager that installs Git and Node.js
if [ "$platform" = mac ]; then
  manager=brew
elif has apt-get; then manager=apt
elif has dnf; then manager=dnf
elif has pacman; then manager=pacman
elif has zypper; then manager=zypper
else manager=none
fi

node_ok() {
  has node || return 1
  node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>20||(a===20&&b>=9)?0:1)'
}

missing=()
has git || missing+=("Git")
node_ok || missing+=("Node.js $NODE_MAJOR")
has docker || missing+=("Docker")

if [ ${#missing[@]} -gt 0 ]; then
  printf '  To run Oryn this computer needs: %s%s%s\n' "$bold" "$(IFS=,; echo "${missing[*]}" | sed 's/,/, /g')" "$reset"
  ask "Install them now?" || fail "Nothing installed. Install them yourself, then run this again."
fi

ensure_brew() {
  has brew && return
  note "Installing Homebrew, the macOS package manager (it may ask for your password)…"
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)" </dev/tty
  if [ -x /opt/homebrew/bin/brew ]; then eval "$(/opt/homebrew/bin/brew shellenv)"; fi
  if [ -x /usr/local/bin/brew ]; then eval "$(/usr/local/bin/brew shellenv)"; fi
}

install_git() {
  case "$manager" in
    brew) ensure_brew; brew install git ;;
    apt) $sudo_cmd apt-get update -y && $sudo_cmd apt-get install -y git ;;
    dnf) $sudo_cmd dnf install -y git ;;
    pacman) $sudo_cmd pacman -Sy --noconfirm git ;;
    zypper) $sudo_cmd zypper --non-interactive install git ;;
    *) fail "Install Git (https://git-scm.com/downloads), then run this again." ;;
  esac
}

install_node() {
  case "$manager" in
    brew)
      ensure_brew
      brew install "node@$NODE_MAJOR"
      brew link --overwrite --force "node@$NODE_MAJOR" >/dev/null 2>&1 || true
      export PATH="$(brew --prefix "node@$NODE_MAJOR")/bin:$PATH"
      ;;
    apt)
      $sudo_cmd apt-get update -y && $sudo_cmd apt-get install -y ca-certificates curl
      curl -fsSL "https://deb.nodesource.com/setup_$NODE_MAJOR.x" | $sudo_cmd -E bash -
      $sudo_cmd apt-get install -y nodejs
      ;;
    dnf)
      curl -fsSL "https://rpm.nodesource.com/setup_$NODE_MAJOR.x" | $sudo_cmd bash -
      $sudo_cmd dnf install -y nodejs
      ;;
    pacman) $sudo_cmd pacman -Sy --noconfirm nodejs npm ;;
    zypper) $sudo_cmd zypper --non-interactive install "nodejs$NODE_MAJOR" ;;
    *) fail "Install Node.js $NODE_MAJOR (https://nodejs.org), then run this again." ;;
  esac
}

install_docker() {
  if [ "$platform" = mac ]; then
    ensure_brew
    brew install --cask docker
    note "Docker Desktop opens next. Accept its terms the first time; Oryn waits for it."
    open -a Docker || true
  else
    curl -fsSL https://get.docker.com | $sudo_cmd sh
    $sudo_cmd systemctl enable --now docker 2>/dev/null || true
    if [ -n "$sudo_cmd" ]; then
      $sudo_cmd usermod -aG docker "$USER"
      note "Added you to the docker group. New terminals pick it up after you log out and back in."
    fi
  fi
}

has git || { install_git; ok "git installed"; }
node_ok || { install_node; hash -r; node_ok || fail "Node.js didn't install correctly."; ok "node $(node -v) installed"; }
has docker || { install_docker; hash -r; ok "docker installed"; }

ok "git $(git --version | awk '{print $3}')"
ok "node $(node -v)"

# Run from inside a clone, or clone one here
here="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" 2>/dev/null && pwd || pwd)"
if [ -f "$here/package.json" ] && grep -q '"name": "oryn"' "$here/package.json"; then
  cd "$here"
elif [ -f package.json ] && grep -q '"name": "oryn"' package.json; then
  :
else
  if [ -d oryn/.git ]; then
    note "Using the existing ./oryn folder"
  else
    git clone --depth 1 "$REPO" oryn
  fi
  cd oryn
fi
ok "oryn in $(pwd)"

# On Linux the docker group only applies to new logins; run Docker steps
# through it now so nothing needs sudo
run_with_docker() {
  if [ "$platform" = linux ] && ! docker info >/dev/null 2>&1 && id -nG "$USER" | grep -qw docker; then
    sg docker -c "$*"
  else
    bash -c "$*"
  fi
}

printf '\n'
npm install --no-fund --no-audit --loglevel=error
run_with_docker "node scripts/setup.mjs --yes"

printf '\n'
no_start=0
for arg in "$@"; do [ "$arg" = --no-start ] && no_start=1; done
if [ "$no_start" = 0 ] && ask "Start Oryn now?"; then
  url="http://127.0.0.1:6796"
  ( for _ in $(seq 120); do
      if curl -fs -o /dev/null "$url"; then
        if [ "$platform" = mac ]; then open "$url"; elif has xdg-open; then xdg-open "$url" >/dev/null 2>&1; fi
        exit 0
      fi
      sleep 1
    done ) &
  printf '  Oryn is starting at %s%s%s — press Ctrl+C to stop it.\n' "$bold" "$url" "$reset"
  printf '  Next time, start it with: %scd %s && npm run dev%s\n\n' "$bold" "$(pwd)" "$reset"
  run_with_docker "npm run dev"
else
  printf '  Start Oryn any time with: %scd %s && npm run dev%s\n\n' "$bold" "$(pwd)" "$reset"
fi
