#!/usr/bin/env bash
# Nightly logical backup of the database to /var/backups/wa, keeping $KEEP_DAYS days.
# DigitalOcean Managed PostgreSQL already keeps its own daily backups (7 days,
# point-in-time restore); this is an extra copy you control and can download.
#
# Install as the deploy user's cron (runs 02:30 India time):
#   crontab -e
#   30 2 * * * /var/www/wa/current/deploy/backup.sh >> /var/www/wa/shared/logs/backup.log 2>&1
set -euo pipefail

APP_ROOT="${APP_ROOT:-/var/www/wa}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/wa}"
KEEP_DAYS="${KEEP_DAYS:-7}"

# Read DATABASE_URL from the app's .env and drop Prisma-only parameters pg_dump rejects.
DATABASE_URL="$(grep -E '^DATABASE_URL=' "$APP_ROOT/shared/.env" | head -1 | cut -d= -f2- | tr -d '"')"
[[ -n "$DATABASE_URL" ]] || { echo "DATABASE_URL not found in $APP_ROOT/shared/.env" >&2; exit 1; }
PG_URL="$(sed -E 's/[?&](connection_limit|pool_timeout|schema)=[^&]*//g; s/\?&/?/; s/[?&]$//' <<<"$DATABASE_URL")"
[[ "$PG_URL" == *sslmode=* ]] || PG_URL="${PG_URL}$([[ "$PG_URL" == *\?* ]] && echo '&' || echo '?')sslmode=require"

mkdir -p "$BACKUP_DIR"
file="$BACKUP_DIR/wa_jscoretech-$(date +%Y%m%d-%H%M).dump"

echo "$(date '+%F %T') backup -> $file"
# Custom format: compressed, restorable table-by-table with pg_restore.
pg_dump "$PG_URL" --format=custom --compress=6 --no-owner --no-privileges --schema=public --schema=log --file="$file.part"
mv "$file.part" "$file"
chmod 600 "$file"
echo "$(date '+%F %T') done, $(du -h "$file" | cut -f1)"

find "$BACKUP_DIR" -name 'wa_jscoretech-*.dump' -mtime +"$KEEP_DAYS" -delete
find "$BACKUP_DIR" -name '*.part' -mmin +240 -delete

# Restore example (into an EMPTY database):
#   pg_restore --no-owner --dbname "postgresql://...?sslmode=require" /var/backups/wa/wa_jscoretech-YYYYMMDD-HHMM.dump
