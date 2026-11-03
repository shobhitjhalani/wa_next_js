#!/usr/bin/env bash
# Builds and activates a new release ON THE DROPLET (run as the deploy user).
#
#   bash deploy/deploy.sh                    # source = /var/www/wa/incoming (uploaded by deploy/push.sh)
#   GIT_REPO=git@github.com:org/wa.git GIT_REF=main bash deploy/deploy.sh
#
# Layout:
#   /var/www/wa/releases/<timestamp>   one folder per release (last $KEEP kept)
#   /var/www/wa/current -> releases/<timestamp>
#   /var/www/wa/shared/{.env,media,storage,logs}   kept across releases
set -euo pipefail

APP_ROOT="${APP_ROOT:-/var/www/wa}"
SOURCE="${SOURCE:-$APP_ROOT/incoming}"
KEEP="${KEEP:-5}"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:3000/}"

SHARED="$APP_ROOT/shared"
RELEASE="$APP_ROOT/releases/$(date +%Y%m%d%H%M%S)"
PREVIOUS="$(readlink -f "$APP_ROOT/current" 2>/dev/null || true)"

[[ -f "$SHARED/.env" ]] || { echo "Missing $SHARED/.env (see deploy/.env.production.example)" >&2; exit 1; }

echo "==> New release $RELEASE"
mkdir -p "$RELEASE"
if [[ -n "${GIT_REPO:-}" ]]; then
  git clone --depth 1 --branch "${GIT_REF:-main}" "$GIT_REPO" "$RELEASE"
else
  [[ -d "$SOURCE" ]] || { echo "No source at $SOURCE (run deploy/push.sh from your machine, or set GIT_REPO)" >&2; exit 1; }
  rsync -a --delete \
    --exclude node_modules --exclude .next --exclude '.env' --exclude '.env.local' \
    --exclude public/media --exclude storage --exclude .git \
    "$SOURCE"/ "$RELEASE"/
fi

cd "$RELEASE"
# Shared, persistent files.
ln -sfn "$SHARED/.env" .env
rm -rf public/media storage
ln -sfn "$SHARED/media" public/media
ln -sfn "$SHARED/storage" storage

echo "==> Install, generate Prisma client, build"
npm ci --no-audit --no-fund
npx prisma generate
NODE_OPTIONS="--max-old-space-size=1536" npm run build

echo "==> Assemble standalone server (Next does not copy these itself)"
cp -a public .next/standalone/public
mkdir -p .next/standalone/.next
cp -a .next/static .next/standalone/.next/static
# Prisma engine must be next to the generated client inside the standalone tree.
if ! ls .next/standalone/node_modules/.prisma/client/*.node >/dev/null 2>&1; then
  mkdir -p .next/standalone/node_modules/.prisma
  cp -a node_modules/.prisma/client .next/standalone/node_modules/.prisma/
fi

echo "==> Activate"
ln -sfn "$RELEASE" "$APP_ROOT/current.tmp"
mv -Tf "$APP_ROOT/current.tmp" "$APP_ROOT/current"
pm2 startOrReload "$APP_ROOT/current/ecosystem.config.cjs" --update-env
pm2 save >/dev/null

echo "==> Health check $HEALTH_URL"
ok=0
for _ in $(seq 1 30); do
  code="$(curl -s -o /dev/null -w '%{http_code}' "$HEALTH_URL" || true)"
  if [[ "$code" =~ ^(200|30[0-9])$ ]]; then ok=1; break; fi
  sleep 2
done
if [[ $ok -ne 1 ]]; then
  echo "!! Health check failed (last HTTP $code)." >&2
  if [[ -n "$PREVIOUS" && -d "$PREVIOUS" ]]; then
    echo "!! Rolling back to $PREVIOUS" >&2
    ln -sfn "$PREVIOUS" "$APP_ROOT/current.tmp"
    mv -Tf "$APP_ROOT/current.tmp" "$APP_ROOT/current"
    pm2 startOrReload "$APP_ROOT/current/ecosystem.config.cjs" --update-env
  fi
  exit 1
fi

echo "==> Keep last $KEEP releases"
find "$APP_ROOT/releases" -mindepth 1 -maxdepth 1 -type d | sort -r | tail -n +$((KEEP + 1)) | while read -r old; do
  [[ "$old" == "$(readlink -f "$APP_ROOT/current")" ]] || rm -rf "$old"
done

echo "Deployed $(basename "$RELEASE")"
