#!/bin/bash
# Idempotent setup, executed only inside an opted-in agent's workstation.
set -euo pipefail
CREDS=/home/xiryn/.coding-creds

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
if [ -f "$CREDS/.git-credentials" ]; then
  if [ ! -e "$HOME/.git-credentials" ]; then
    ln -sf "$CREDS/.git-credentials" "$HOME/.git-credentials"
    echo 'git-credentials: linked from volume (was missing)'
  elif [ -L "$HOME/.git-credentials" ]; then
    echo 'git-credentials: already linked, skipping'
  elif [ ! -s "$HOME/.git-credentials" ]; then
    rm "$HOME/.git-credentials"
    ln -sf "$CREDS/.git-credentials" "$HOME/.git-credentials"
    echo 'git-credentials: replaced empty file with volume link'
  else
    cp "$HOME/.git-credentials" "$HOME/.git-credentials.bak"
    chmod 600 "$HOME/.git-credentials.bak"
    rm "$HOME/.git-credentials"
    ln -sf "$CREDS/.git-credentials" "$HOME/.git-credentials"
    echo 'git-credentials: backed up stale file to .git-credentials.bak, linked from volume'
  fi
  git config --global credential.helper store
fi

# Make the documented codex command usable in subsequent shells.
mkdir -p "$HOME/.local/bin"
ln -sf "$HOME/codex-cli/node_modules/.bin/codex" "$HOME/.local/bin/codex"
echo "Coding tools ready"
