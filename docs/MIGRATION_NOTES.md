# Migration notes — core (database, auth, send engine, queue worker)

Area notes from the parallel ports live in `docs/migration-notes/*.md`.

## Database
- MySQL `wa_official` → Postgres schema `public`; `wa_log` → schema `log` (same database).
  Prisma models keep the original table/column names; log tables are prefixed `log_`
  (`log_js_message_log`). After any `prisma db pull`, run `npx tsx scripts/prisma-names.ts`.
- MySQL columns are latin1 but contain UTF-8 bytes. pgloader decodes them as UTF-8;
  `verify.ts` checks 200 emoji/Hindi messages byte-for-byte.
- pgloader 3.6.10 does not create indexes/keys against this MariaDB, so
  `scripts/migrate/indexes.ts` recreates PK/unique/indexes/FKs from information_schema.
  Two FKs in MySQL point at tables that no longer exist (`master_heading`, `permissions`): skipped.
- **The local MySQL copy is ~14 months old (newest message 8 Sep 2025) and its schema is behind
  the code** (e.g. `js_message.m_button_url`, `js_master_value` rows 56191–56203 incl. the WhatsApp
  token row 56203). `scripts/migrate/schema-drift.sql` adds the missing column locally; production
  must be migrated from a fresh production dump.

## Auth
- Legacy hash `base64(sha1(salt . sha1(salt . pw)))` still verifies (including PHP's quirk of
  hashing the `mysqli_real_escape_string`-escaped password), then is upgraded to bcrypt on login.
- Sessions are encrypted cookies (`wa_user`, `wa_admin`), 12h.
- All queries are parameterized (the PHP built SQL by string concatenation — SQL injection).

## Send engine (`src/lib/wa/*`) — behaviour changes vs PHP, all deliberate
1. **Fresh payload per message.** PHP never reset `$post_data` / `$json_data` inside the send loop,
   so a message could inherit the previous message's header, buttons or **attachments** (a customer
   could receive another customer's document).
2. **Only successful API responses count as "Sent".** PHP appended media responses unconditionally,
   so a failed media send could still mark the message Sent (3). Now: any success → 3, none → 4.
3. Components / list rows are always sequential arrays (PHP could produce JSON objects with gaps,
   which Meta rejects).
4. Catalogue section title uses `c_model` (PHP read a non-existent `model` key → always empty).
5. Temp media files are kept (WhatsApp downloads links after the API call); PHP's immediate unlink
   used a wrong path and never worked anyway; the cleanup job removes old folders.
6. Message ids recorded in `m_message_id` are still taken from the last API response of a text
   message (PHP behaviour) so delivery-status webhooks keep matching the same way.
7. Client-specific hacks (template renames, languages, `|` separators, user 11 catalogue, flow index,
   pdf2image template) are collected in `src/lib/wa/client-rules.ts`.

## Queue worker (`src/worker/*`, PM2 app `wa-worker`)
- One process, one loop per lane (`lanes.ts` = the former cron scripts with their exact user filters,
  batch sizes, queue windows and the 07:00–23:00 IST send window).
- Claims use `UPDATE … WHERE m_id IN (SELECT … FOR UPDATE SKIP LOCKED)`, so a message can never be
  claimed twice. (`wa_cron.php` / `wa_novelty.php` claimed without re-checking status.)
- A Postgres advisory lock per lane prevents two workers running the same lane. A crashed run no
  longer leaves a group stuck in `running` (PHP required `mv_value3 = 'completed'` to start).
- `WORKER_IGNORE_HOURS=1` for testing only.

## Safety
- Local `.env` points `WA_API_URL` at a dead address so local runs can never message real customers.
- `scripts/test-send.ts` runs the engine against an in-process mock Meta API.

## Admin report date filter
- The admin message reports (wa_send, wa_failed, wa_error, wa_system_error, wa_que, wa_in_process)
  and the template report open on the **current month** (IST) instead of all history; their exports
  follow the same filter. Clearing the date field and pressing Search shows all time (kept across
  pages and exports).
- With a date range, lists sort by that date column, then id (same visual order), so Postgres can
  read the range from `js_message_created_id` instead of walking every newer message.
- Run `scripts/migrate/indexes-extra.sql` after migration (adds the indexes and a VACUUM).
