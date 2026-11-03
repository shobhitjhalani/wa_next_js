#!/usr/bin/env bash
# Switches back to an earlier release ON THE DROPLET.
#   bash deploy/rollback.sh              # previous release
#   bash deploy/rollback.sh 20261103101500
set -euo pipefail

APP_ROOT="${APP_ROOT:-/var/www/wa}"
CURRENT="$(readlink -f "$APP_ROOT/current")"

if [[ $# -ge 1 ]]; then
  TARGET="$APP_ROOT/releases/$1"
else
  TARGET="$(find "$APP_ROOT/releases" -mindepth 1 -maxdepth 1 -type d | sort -r | grep -vxF "$CURRENT" | head -n 1 || true)"
fi
[[ -n "$TARGET" && -d "$TARGET" ]] || { echo "No release to roll back to." >&2; ls "$APP_ROOT/releases" >&2; exit 1; }

echo "Rolling back: $(basename "$CURRENT") -> $(basename "$TARGET")"
ln -sfn "$TARGET" "$APP_ROOT/current.tmp"
mv -Tf "$APP_ROOT/current.tmp" "$APP_ROOT/current"
pm2 startOrReload "$APP_ROOT/current/ecosystem.config.cjs" --update-env
pm2 save >/dev/null
echo "Done. Note: database changes are NOT rolled back by this script."
