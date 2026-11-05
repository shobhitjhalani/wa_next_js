#!/usr/bin/env bash
# Zero-downtime deploy on the server (run as the deploy user):
#
#   ssh wa-do 'bash /var/www/wa/current/scripts/deploy.sh [branch]'
#   ssh wa-do 'bash /var/www/wa/current/scripts/deploy.sh --rollback'
#
# Each deploy is built in its own folder under releases/ while the live one keeps serving;
# only after a successful build does `current` switch over and pm2 restart (about a second).
# .env and storage/ live in shared/ and are linked into every release.
set -euo pipefail
BASE=/var/www/wa
REPO=https://github.com/shobhitjhalani/wa_next_js.git
KEEP=5
cd "$BASE"

if [ "${1:-}" = "--rollback" ]; then
  cur="releases/$(basename "$(readlink -f current)")"
  prev=$(ls -1d releases/* | awk -v c="$cur" '$0 < c' | tail -1)   # newest release older than the live one
  [ -n "$prev" ] || { echo "No previous release"; exit 1; }
  ln -sfn "$BASE/$prev" current.tmp && mv -Tf current.tmp current
  pm2 restart wa-app wa-worker --update-env >/dev/null
  echo "Rolled back to $prev"; exit 0
fi

BRANCH=${1:-nextjs-port-v2}
REL="$BASE/releases/$(date +%Y%m%d-%H%M%S)"
echo "→ $REL ($BRANCH)"
git clone -q --depth 1 -b "$BRANCH" "$REPO" "$REL"
ln -s "$BASE/shared/.env" "$REL/.env"
rm -rf "$REL/storage" && ln -s "$BASE/shared/storage" "$REL/storage"
cd "$REL"
npm ci --no-audit --no-fund --loglevel=error
npm run -s db:migrate
NODE_OPTIONS=--max-old-space-size=1536 npm run -s build > "$BASE/shared/storage/logs/build.log" 2>&1 \
  || { tail -30 "$BASE/shared/storage/logs/build.log"; echo "Build failed — live site unchanged"; rm -rf "$REL"; exit 1; }

cd "$BASE"
ln -sfn "$REL" current.tmp && mv -Tf current.tmp current
pm2 restart wa-app wa-worker --update-env >/dev/null
echo "✓ live: $(git -C "$REL" log --oneline -1)"

# keep the newest $KEEP releases (never the live one)
ls -1d releases/* | sort -r | tail -n +$((KEEP + 1)) | grep -vx "releases/$(basename "$REL")" | xargs -r rm -rf
