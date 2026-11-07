# wa_next_js — WhatsApp Cloud API platform (Next.js + PostgreSQL)

Next.js 16 / PostgreSQL rebuild of the Laravel `wa_js` app. Same two panels, same `js_*` tables and columns,
same URLs (including the integration endpoints clients and Meta call), same features.

| Panel / endpoint | URL | Who |
|---|---|---|
| User panel | `/` | WhatsApp client accounts (`js_user`, type 2) |
| Admin panel | `/wamaster` | Staff (`js_employee`) |
| Public API | `/api/secure/v1/{action}/`, `/wa/secure/v1/{action}-{key}`, `/waapi/api.php?at=` | API clients |
| Client API | `/waapi/client_api.php?at=send_wa` | API clients (optional `Api-Key` header) |
| Meta webhook | `/waapi/webhook` (also `webhook.php`, `wawebhook.php`) | Meta |
| Shopify webhooks | `/api/shopify/v1/new_order/`, `/api/shopify/v1/abandoned_cart/`, `/waapi/shopify.php?at=` | Shopify |
| Instagram webhook | `/waapi/igwebhook.php`, `/waapi/newwebhook.php` (log + acknowledge) | Meta |
| Uploaded media | `/media/...` | Meta fetches template / campaign media here |

Old page URLs (`*.php`, `/scheduler`, `/knowledge_base`, `/wamaster/view/...`) redirect permanently (`next.config.ts`).

## Requirements

Node.js 22+ (developed on 26), PostgreSQL 14+ (developed on 17) with the `citext` extension (bundled with PostgreSQL).

## Setup

```bash
npm install
cp .env.example .env            # then edit it (see below)
createdb wa_next
npm run db:migrate              # creates / updates the schema (db/schema.sql, idempotent)
```

Load data — copy everything from the Laravel MySQL database (passwords keep working; legacy hashes are upgraded to
bcrypt at the next login):

```bash
npm run import:mysql -- --mysql=mysql://root@127.0.0.1:3306/wa_js
# options: --only=js_user,js_user_templates   --skip=js_message   --log-db=wa_log (legacy log tables)
```

3.5 M messages take about 3 minutes (streamed with `COPY`, indexes rebuilt afterwards).

### `.env`

`SESSION_SECRET` (`openssl rand -hex 32`), `DATABASE_URL`, `APP_URL` (public URL — media links sent to Meta are
built from it), `TZ=Asia/Kolkata`, and the WhatsApp / payment / Shopify / mail / report settings — the same values as
the Laravel `.env` (`WA_KEY`, `META_APP_SECRET`, `FB_APP_ID`, `RAZORPAY_*`, `CCA_*`, `SHOPIFY_*`, `REPORT_*`…). The
live Meta token is still read from master value `WA_KEY_MASTER_ID` when that row exists.

## Run

```bash
npm run build && npm start      # web app (port 3000; PORT=… to change)
```

For local production testing, stop the running `npm start` process before rebuilding, then
start it again and reload open browser tabs. Replacing `.next` while the old server is running
can cause missing JavaScript chunks and "This page couldn't load" errors. Use `npm run dev`
for iterative development; do not run it alongside a production server in the same folder.

Background jobs (campaign dispatch, queue sending, statuses, plans, cleanup, reports) — one cron line, exactly like
Laravel's `schedule:run` (logs to `storage/logs/cron.log`):

```cron
* * * * * /path/to/wa_next_js/scripts/cron.sh
```

or, instead of cron, a long-running process: `npm run worker`.

Run both under a process manager (pm2 / systemd). Behind Nginx/Apache, proxy everything to the Next.js port and allow
uploads up to 110 MB (`client_max_body_size 110m`). Point the Meta app webhook at `https://<host>/waapi/webhook`.

### Background jobs (`scripts/cron.sh` or `npm run worker`)

| Job | Schedule | Run once | Legacy |
|---|---|---|---|
| dispatch-campaigns | every minute | `npm run wa -- dispatch-campaigns` | — |
| expire-messages | every 5 min | `npm run wa -- expire-messages` | — (queued/processing messages older than `WA_MSG_EXPIRY`, default 24h, → status 5; they are never sent) |
| send-queue | every minute, 07:00–23:00 (up to `WA_SEND_BATCH` = 1000 per account) | `npm run wa -- send-queue [--user=74] [--force]` | `cron/wa_cron.php` |
| process-webhooks | every minute | `npm run wa -- process-webhooks` | `cron/webhook_que.php` |
| expire-plans | hourly | `npm run wa -- expire-plans` | `cron/user_status.php` |
| cleanup | daily 02:30 | `npm run wa -- cleanup` | `cron/msg_delete.php`, `delete_folders.php` |
| email-reports | daily at `REPORT_EMAIL_TIME` | `npm run wa -- email-reports [--user=46] [--admin-only]` | `cron/email.php`, `cron/user_email.php` |
| — | — | `npm run wa -- inbox-rebuild [--user=74]` | `wa:inbox-rebuild` |

Jobs take a PostgreSQL advisory lock, so a second worker instance (or a manual run) never runs the same job twice
at the same time; last runs are recorded in `wa_job_runs`.

## Production server (DigitalOcean)

Layout on the droplet (`ssh wa-do`, user `deploy`):

```
/var/www/wa/current   → releases/<timestamp>   (live; pm2 + Nginx point here)
/var/www/wa/releases/                          (last 5 builds)
/var/www/wa/shared/.env, shared/storage/       (linked into every release)
```

Deploy (builds in a new folder while the live site keeps serving, then switches over; a failed build leaves the site untouched):

```bash
ssh wa-do 'bash /var/www/wa/current/scripts/deploy.sh'              # branch nextjs-port-v2
ssh wa-do 'bash /var/www/wa/current/scripts/deploy.sh --rollback'   # back to the previous release
```

pm2 (2 app instances, reloaded one at a time) and Nginx configs are in `deploy/`. Build files of every release are kept in `shared/web/_next/static` so pages opened before a deploy keep working.

## Development

```bash
npm run dev          # http://localhost:3000
npm run typecheck
npm test             # unit tests (vitest)
```

Forms bind to their Server Actions so native submissions use POST even before JavaScript loads.
User and admin sign-in credentials are sent in the request body, not in the URL.
With the app running, `WA_TEST_URL=http://localhost:3000 npm test` also checks the rendered
user and admin login forms for native POST and Server Action bindings.

`PORTING.md` documents the architecture, the shared library (`src/lib`) and the conventions.
`npx tsx scripts/dev-session.ts --user=74` prints a session cookie for curl checks.

## What changed from the Laravel app (and why it is faster)

Behaviour, URLs, forms and screens are the same. Under the hood:

- **PostgreSQL schema** — same tables/columns; partial indexes for the hot paths (queued / processing messages, sent
  messages by send time, unread incoming, inbox threads). `js_message` takes 2.0 GB instead of 3.6 GB.
  Usernames, emails and group names are `citext`, so lookups stay case-insensitive as they were under MySQL collation.
- **Queue sender** — messages are claimed in one `UPDATE … FOR UPDATE SKIP LOCKED` statement (no double sends from
  overlapping runs), accounts are processed in parallel and recipients concurrently (`WA_SEND_CONCURRENCY`, default 16)
  while each recipient's messages stay in order; user / template / block-list lookups are cached per run.
- **Webhook statuses** — applied set-based (one statement per 2 000 statuses instead of three queries per status).
- **Webhook / API / Shopify responses** return immediately; forwarding to client URLs, catalogue auto-replies and
  immediate sends run after the response (`after()`), so Meta and API clients never wait on outbound HTTP calls.
- **Campaigns** — the audience (groups + pasted numbers − opted-out − blocked) is one query; messages are inserted
  with `INSERT … SELECT unnest(…)` (thousands of rows per round trip); statistics use `COUNT(*) FILTER`.
- **Contact import** — set-based upserts per 1 000 rows; XLSX is streamed.
- **Exports** — CSV is streamed from a database cursor (constant memory, download starts immediately).
- **Sessions** — signed httpOnly cookies (no session table reads); the account row is loaded once per request.
- **Pages** render on the server (React Server Components) with independent queries run in parallel; the panel frame
  stays mounted between pages (client-side navigation).
- The theme's `app.js` (which rewrote the menu DOM) is replaced by a small React component; Bootstrap's JS bundle
  still drives dropdowns, collapses and modals.

Data note: some legacy rows contain double-encoded text (e.g. `SiÃ±gh`); they are copied as stored, exactly as the
Laravel app showed them. Re-syncing templates from Meta refreshes template text.
