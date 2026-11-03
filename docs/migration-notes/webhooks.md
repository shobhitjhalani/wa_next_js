# Webhooks, webhook queue and maintenance jobs

Ports of `waapi/webhook.php`, `wawebhook.php`, `newwebhook.php`, `igwebhook.php`,
`cron/webhook_que.php`, `delete_folders.php`, `delete_msg.php`, `user_status.php`,
`email.php`, `user_email.php` (+ `email_template/wa_report.php`, `wa_templates.php`).

## URLs (unchanged)
| URL | Code |
|---|---|
| `/waapi/webhook.php` | `src/app/waapi/webhook.php/route.ts` → `src/lib/wa/inbound.ts` (variant `webhook`) |
| `/waapi/wawebhook.php` | variant `wa` |
| `/waapi/newwebhook.php` | verification only |
| `/waapi/igwebhook.php` | Instagram payloads logged to `log.js_api_data_log` |

## Worker jobs (`src/worker/jobs/`)
The PHP crontab was not in the repo, so schedules follow each script's intent. All are env-configurable.

| Job | PHP | Schedule |
|---|---|---|
| `webhook-que` | webhook_que.php | every 30 s (`WEBHOOK_QUE_INTERVAL_SECONDS`) |
| `plan-expiry` | user_status.php | hourly |
| `daily-cleanup` | delete_folders.sh (folders + delete_msg + user_status) | 00:30 IST (`CLEANUP_TIME`) |
| `wa-report-email` | email.php | 21:00 IST (`REPORT_EMAIL_TIME`) — **confirm with the live crontab** |
| `template-report-email` | user_email.php (user 46) | 21:00 IST (`REPORT_EMAIL_TIME`) |

Not ported (commented out in the .sh files, i.e. inactive): `wa_send_status.php` (one-off backfill
for one template), `contact_list.php` (contact backfill), `user_msg.php` / `direct_msg.php` /
`quick_msg.php` (manual senders; the queue lanes cover them).

## Deliberate changes vs. PHP
- **Access token no longer leaked**: `fun_curl()` sent `Authorization: Bearer <WhatsApp token>` to *every*
  URL, including client webhooks, Digitomation and a Google Apps Script. Forwards now send no token.
- **Call permission replies**: PHP read `interactive.type.call_permission_reply` (a string), so
  "Call Permission Granted" was never stored. Now reads `interactive.call_permission_reply.response`.
- **Webhook failures return 500** (PHP always 200), so Meta retries instead of the event being lost.
  Duplicate incoming messages are still ignored by message id.
- **Forward timeouts 15 s** (PHP 60 s), so a slow client endpoint can't stall Meta's webhook delivery.
- **webhook_que**: PHP read `$row['systemTime']` but the column is `systemtime`, so `m_updated_on` was
  always set to 0. Now the queue row's time is used. Postgres counts unchanged rows as updated, so a
  repeated identical status is deleted from the queue instead of being parked as `moved = 3`.
- **Media cleanup** removes every dated folder older than today (PHP removed only yesterday's, so a
  missed run left folders forever, and a missing folder made the script abort). Runs only when
  `MEDIA_ROOT` is set (locally `public/media` links to the PHP app's media folder).
- **Template report e-mail**: PHP *halved the error count* for template `tata_farmers` when it exceeded
  5000 (`wa_templates.php`). That under-reported errors to the client and was **not** ported — real
  numbers are shown. Decide whether that was intentional.
- **WA report "Grand Total"** in PHP left out the last user's rows; it now includes everyone.
- Verification GET: like PHP, `hub.challenge` is echoed without checking `hub.verify_token`.
  Consider checking it against `WA_WEBHOOK_VERIFY_TOKEN` once Meta settings are confirmed.

## Schema drift (added to `scripts/migrate/schema-drift.sql`)
`js_message.m_reply_message_id`, `js_incoming_log.post_url`, `js_user.u_send_app` — written by the PHP
webhook but missing from the old local MySQL copy (on the current local schema the PHP insert itself fails).

## E-mail
`src/lib/mailer.ts` (nodemailer, SES SMTP). Dry run (rendered, not sent) when `SMTP_HOST`/`SMTP_USERNAME`
are empty or `MAIL_DRY_RUN=1`.

## Tests
`npx tsx scripts/test-webhooks.ts` — mock server for Meta and all client URLs, e-mail dry run.
