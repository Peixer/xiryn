#!/usr/bin/env bash
# Repo-root entry so `sudo /opt/xiryn/deploy.sh` matches deploy/deploy.sh.
exec "$(cd "$(dirname "$0")" && pwd)/deploy/deploy.sh" "$@"
