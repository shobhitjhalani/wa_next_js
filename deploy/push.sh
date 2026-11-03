#!/usr/bin/env bash
# Run on YOUR machine: uploads the code to the droplet and runs deploy.sh there.
#   DROPLET=deploy@203.0.113.10 bash deploy/push.sh
set -euo pipefail

DROPLET="${DROPLET:?Set DROPLET=deploy@<droplet-ip>}"
APP_ROOT="${APP_ROOT:-/var/www/wa}"
cd "$(dirname "$0")/.."

rsync -az --delete \
  --exclude node_modules --exclude .next --exclude '.env' --exclude '.env.local' \
  --exclude public/media --exclude storage --exclude .git --exclude '*.log' \
  ./ "$DROPLET:$APP_ROOT/incoming/"

ssh "$DROPLET" "cd $APP_ROOT/incoming && bash deploy/deploy.sh"
