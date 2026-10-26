#!/bin/bash
# Idempotent setup, executed only inside an opted-in agent's workstation.
# `bash -s -- refresh` only relinks git credentials. The full run also
# installs Codex and Claude Code.
set -euo pipefail
CREDS="${XIRYN_GIT_CREDS:-/home/xiryn/.coding-creds}"

install_git_helper() {
  mkdir -p "$HOME/.local/bin"
  cat >"$HOME/.local/bin/xiryn-git-credential" <<'EOF'
#!/bin/sh
# Reads ~/.git-credentials for git. Writes back only when that file's
# directory is writable. The shared fallback volume is mounted read-only,
# so a save there is ignored instead of failing the git command.
set -eu
file="${HOME}/.git-credentials"
op="${1:-}"

if [ "$op" = get ]; then
  [ -f "$file" ] || exit 0
  exec git credential-store --file "$file" get
fi

if [ "$op" = store ] || [ "$op" = erase ]; then
  if [ -e "$file" ] || [ -L "$file" ]; then
    dir=$(dirname "$(readlink -f "$file")")
  else
    dir=$HOME
  fi
  if [ -w "$dir" ]; then
    exec git credential-store --file "$file" "$op"
  fi
  cat >/dev/null
  exit 0
fi

echo 'xiryn-git-credential: unknown operation' >&2
exit 1
EOF
  chmod 755 "$HOME/.local/bin/xiryn-git-credential"
}

link_git_credentials() {
  local src="$CREDS/.git-credentials"
  if [ ! -f "$src" ]; then
    return 0
  fi
  if [ ! -e "$HOME/.git-credentials" ]; then
    ln -sf "$src" "$HOME/.git-credentials"
    echo 'git-credentials: linked from volume (was missing)'
  elif [ -L "$HOME/.git-credentials" ]; then
    if [ "$(readlink "$HOME/.git-credentials")" = "$src" ]; then
      echo 'git-credentials: already linked, skipping'
    else
      ln -sfn "$src" "$HOME/.git-credentials"
      echo 'git-credentials: retargeted link'
    fi
  elif [ ! -s "$HOME/.git-credentials" ]; then
    rm "$HOME/.git-credentials"
    ln -sf "$src" "$HOME/.git-credentials"
    echo 'git-credentials: replaced empty file with volume link'
  else
    cp "$HOME/.git-credentials" "$HOME/.git-credentials.bak"
    chmod 600 "$HOME/.git-credentials.bak"
    rm "$HOME/.git-credentials"
    ln -sf "$src" "$HOME/.git-credentials"
    echo 'git-credentials: backed up stale file to .git-credentials.bak, linked from volume'
  fi
  install_git_helper
  git config --global credential.helper "$HOME/.local/bin/xiryn-git-credential"
}

if [ "${1:-}" = refresh ]; then
  link_git_credentials
  exit 0
fi

# Test the executable, so a failed installation can be retried.
if [ ! -x "$HOME/codex-cli/node_modules/.bin/codex" ]; then
  mkdir -p "$HOME/codex-cli"
  npm install --prefix "$HOME/codex-cli" @openai/codex
fi

mkdir -p "$HOME/.codex"
if [ -f "$CREDS/.codex/auth.json" ] && [ ! -e "$HOME/.codex/auth.json" ]; then
  ln -sf "$CREDS/.codex/auth.json" "$HOME/.codex/auth.json"
fi
if [ -f "$CREDS/.codex/models_cache.json" ] && [ ! -e "$HOME/.codex/models_cache.json" ]; then
  ln -sf "$CREDS/.codex/models_cache.json" "$HOME/.codex/models_cache.json"
fi

if [ -f "$CREDS/.gitconfig" ]; then
  cp "$CREDS/.gitconfig" "$HOME/.gitconfig"
fi
link_git_credentials

# Make the documented codex command usable in subsequent shells.
mkdir -p "$HOME/.local/bin"
ln -sf "$HOME/codex-cli/node_modules/.bin/codex" "$HOME/.local/bin/codex"
# Claude Code CLI (user-local fallback works without root).
if ! command -v claude &>/dev/null && [ ! -x "$HOME/.local/bin/claude" ]; then
  echo "Installing Claude Code CLI..."
  if npm install -g @anthropic-ai/claude-code 2>/dev/null; then
    :
  elif npm install --prefix "$HOME/.local" @anthropic-ai/claude-code 2>/dev/null; then
    ln -sf "$HOME/.local/node_modules/.bin/claude" "$HOME/.local/bin/claude"
  else
    echo "Claude Code install failed — install manually: npm install -g @anthropic-ai/claude-code"
  fi
else
  echo "Claude Code CLI already available"
fi
# Sessions use a stable user-local path even when npm installed globally.
if command -v claude &>/dev/null; then
  claude_path="$(command -v claude)"
  if [ "$claude_path" != "$HOME/.local/bin/claude" ]; then
    ln -sf "$claude_path" "$HOME/.local/bin/claude"
  fi
fi
echo "Coding tools ready"
