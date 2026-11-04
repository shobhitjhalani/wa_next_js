#!/bin/sh
# Cron entry point (the Laravel `php artisan schedule:run` line). Install with:
#   * * * * * /path/to/wa_next_js/scripts/cron.sh
# Runs every job that is due — dispatch scheduled campaigns, send the queue,
# apply delivery statuses, expire plans, cleanup, email reports — and logs to
# storage/logs/cron.log.
cd "$(dirname "$0")/.." || exit 1
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"
exec node --env-file-if-exists=.env --conditions=react-server --import tsx worker/cli.ts schedule >> storage/logs/cron.log 2>&1
