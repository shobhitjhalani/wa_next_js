#!/usr/bin/env bash
# Full MySQL -> PostgreSQL migration into DigitalOcean Managed PostgreSQL.
# See deploy/migrate-production.md for the whole runbook (when and how to run this).
#
#   MYSQL_URL='mysql://user:pass@127.0.0.1:3307' \
#   PG_URL='postgresql://wa_app:PASS@db-host:25060/wa_jscoretech?sslmode=require' \
#   bash deploy/migrate.sh
#
#   RESET=1 ...   first empties schemas public and log (asks you to type the DB name)
#
# Run from the project folder (needs node_modules for the tsx scripts).
set -euo pipefail

: "${MYSQL_URL:?Set MYSQL_URL, e.g. mysql://user:pass@127.0.0.1:3307 (no database name)}"
: "${PG_URL:?Set PG_URL, e.g. postgresql://wa_app:pass@host:25060/wa_jscoretech?sslmode=require}"
cd "$(dirname "$0")/.."

# psql/pgloader understand libpq's sslmode=require. node-postgres (indexes.ts,
# verify.ts) treats "require" as full certificate verification, which fails on
# DO's own CA unless you pass the CA file, so give it "no-verify" instead.
NODE_PG_URL="${PG_URL/sslmode=require/sslmode=no-verify}"
DB_NAME="$(sed -E 's#.*/([^/?]+)(\?.*)?$#\1#' <<<"$PG_URL")"
LOG_DIR="${LOG_DIR:-./migrate-logs/$(date +%Y%m%d-%H%M%S)}"
mkdir -p "$LOG_DIR"

echo "==> Checking connections"
psql "$PG_URL" -qtAc "select 'postgres ok: ' || current_user || '@' || current_database()"
command -v pgloader >/dev/null || { echo "pgloader not installed" >&2; exit 1; }

existing="$(psql "$PG_URL" -qtAc "select count(*) from information_schema.tables where table_schema in ('public','log')")"
if [[ "$existing" != "0" ]]; then
  if [[ "${RESET:-0}" == "1" ]]; then
    read -r -p "This DELETES all tables in schemas public and log of '$DB_NAME'. Type the database name to continue: " answer
    [[ "$answer" == "$DB_NAME" ]] || { echo "Aborted."; exit 1; }
    psql "$PG_URL" -v ON_ERROR_STOP=1 -q <<'SQL'
DROP SCHEMA IF EXISTS log CASCADE;
DROP SCHEMA IF EXISTS public CASCADE;
CREATE SCHEMA public;
SQL
  else
    echo "Target already has $existing tables. Re-run with RESET=1 to start over." >&2
    exit 1
  fi
fi

export MYSQL_URL PG_URL MODE=''
started=$(date +%s)

for db in wa_official wa_log; do
  echo "==> pgloader $db (log: $LOG_DIR/$db.log)"
  pgloader "scripts/migrate/$db.load" > "$LOG_DIR/$db.log" 2>&1 || { tail -30 "$LOG_DIR/$db.log"; exit 1; }
  if grep -qE 'FATAL|ERROR' "$LOG_DIR/$db.log"; then
    # FK errors are expected here: pgloader cannot create keys on this MariaDB; indexes.ts does it next.
    grep -E 'FATAL|ERROR' "$LOG_DIR/$db.log" | grep -v 'no unique constraint matching' | head -20 || true
  fi
  grep -E 'Total import time' "$LOG_DIR/$db.log" || true
done

echo "==> Columns missing from older MySQL copies"
psql "$PG_URL" -v ON_ERROR_STOP=1 -q -f scripts/migrate/schema-drift.sql

echo "==> Primary keys, unique keys, indexes, foreign keys (takes a few minutes on js_message)"
idx_status=0
PG_URL="$NODE_PG_URL" npx tsx scripts/migrate/indexes.ts > "$LOG_DIR/indexes.log" 2>&1 || idx_status=$?
grep -vE '^OK ' "$LOG_DIR/indexes.log" || true
[[ $idx_status -eq 0 ]] || { echo "indexes.ts reported failures (see $LOG_DIR/indexes.log)" >&2; exit 1; }

echo "==> Verifying row counts and UTF-8 text against MySQL"
if ! PG_URL="$NODE_PG_URL" npx tsx scripts/migrate/verify.ts > "$LOG_DIR/verify.log" 2>&1; then
  grep -v '^OK ' "$LOG_DIR/verify.log" >&2
  echo "Verification FAILED (full output: $LOG_DIR/verify.log)" >&2
  exit 1
fi
tail -1 "$LOG_DIR/verify.log"

echo "==> Search path for the app user"
psql "$PG_URL" -qc "ALTER DATABASE \"$DB_NAME\" SET search_path = public, log" || true

echo "Migration finished in $(( ($(date +%s) - started) / 60 )) min. Logs: $LOG_DIR"
