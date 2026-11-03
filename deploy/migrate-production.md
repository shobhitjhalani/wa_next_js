# Production data migration and cut-over

How to move the live data from the current PHP/MySQL server to DigitalOcean
Managed PostgreSQL, and how to switch users over with a way back.

> **The local copy is not enough.** The XAMPP database on the dev Mac is about
> 14 months old (newest message: 8 Sep 2025) and its schema has drifted: for example
> `js_message.m_button_url` and the `js_master_value` rows 56191–56203 (queue lanes
> and the WhatsApp token) are missing. Always migrate from the **live** MySQL.

## 0. One-time preparation

1. **Database and app user** (DigitalOcean panel → Databases → your cluster):
   - *Users & Databases* → add user `wa_app`, add database `wa_jscoretech`.
   - Make `wa_app` the owner, so the tables it creates belong to it. Connect once as `doadmin`:
     ```bash
     psql "postgresql://doadmin:PASS@HOST:25060/defaultdb?sslmode=require" \
       -c 'ALTER DATABASE wa_jscoretech OWNER TO wa_app;'
     psql "postgresql://doadmin:PASS@HOST:25060/wa_jscoretech?sslmode=require" \
       -c 'ALTER SCHEMA public OWNER TO wa_app;'
     ```
   All migration commands below run as `wa_app` (not `doadmin`).

2. **Get access to the live MySQL.** Pick one:
   - **A. SSH tunnel (recommended).** Run pgloader on the droplet, reading MySQL through SSH:
     ```bash
     # on the droplet; keeps a tunnel open on local port 3307
     ssh -N -L 3307:127.0.0.1:3306 OLD_SSH_USER@OLD_SERVER_IP &
     export MYSQL_URL='mysql://MYSQL_USER:MYSQL_PASS@127.0.0.1:3307'
     ```
   - **B. Dump and reload.** If SSH to MySQL isn't possible (shared cPanel):
     `mysqldump --single-transaction --routines=0 --triggers=0 wa_offical > wa.sql` and
     the same for `wa_log`. Import both into the Mac's XAMPP MariaDB under the same
     names (`wa_official`, `wa_log`), then run `migrate.sh` from the Mac. Add the Mac's
     public IP to the cluster's *Trusted sources* first.

   > The live database name is `wa_offical` (sic, per `config/general.php`), while the
   > `.load` scripts read `wa_official`. With option A, change the line
   > `FROM {{MYSQL_URL}}/wa_official` in `scripts/migrate/wa_official.load` to `wa_offical`
   > (and the database name in `scripts/migrate/verify.ts` / `indexes.ts`). With option B,
   > simply import the dump under the name `wa_official`. Check the real name on the server first.

3. **Media files** (2.6 GB): copy them ahead of time. You only re-sync the changes at cut-over:
   ```bash
   # on the droplet, as deploy
   rsync -az --info=progress2 OLD_SSH_USER@OLD_SERVER_IP:/home/mwaapijs/public_html/media/ /var/www/wa/shared/media/
   rsync -az OLD_SSH_USER@OLD_SERVER_IP:/home/mwaapijs/public_html/waapi/media/ /var/www/wa/shared/storage/waapi-media/
   ```

## 1. Rehearsal (do this at least once, days before cut-over)

```bash
cd /var/www/wa/current
export MYSQL_URL='mysql://USER:PASS@127.0.0.1:3307'
export PG_URL='postgresql://wa_app:PASS@PRIVATE-HOST:25060/wa_jscoretech?sslmode=require'
bash deploy/migrate.sh            # later runs: RESET=1 bash deploy/migrate.sh
```

What it does:
1. `pgloader` copies every table (and decodes the latin1 columns as UTF-8, so emoji and Hindi text survive).
2. `schema-drift.sql` adds columns that older copies lack. It's harmless on the live data.
3. `indexes.ts` recreates the primary keys, indexes and foreign keys. pgloader can't create them on this MariaDB version.
4. `verify.ts` compares the exact row counts of every table and checks 200 messages byte for byte. **The script stops if anything differs.**

Locally, 3.2 M messages took about 80 s to copy and 4 min to index. Budget 15–30 minutes on production.

Then test the app at `https://new.wa.jscoretech.com`:
- Log in as a few real users and as an admin, and compare the dashboard counts with the PHP app.
- Keep `WA_API_URL` pointing to a dead address (e.g. `http://127.0.0.1:9/`) during rehearsal, **or don't start `wa-worker` at all**. Otherwise the copied queue (status 1 messages) would be sent a second time.

## 2. Cut-over (plan ~1 hour, in the evening after 23:00 IST when nothing sends)

| # | Step | Where |
|---|------|-------|
| 1 | Announce a short maintenance window to clients. | — |
| 2 | **Stop the PHP crons**: comment out all lines in `crontab -e` (send_wa.sh, cron_wa.sh, tpem.sh, clients.sh, wa_status.sh…). Wait for running ones to finish (`ps aux \| grep cron/`). | old server |
| 3 | Put the PHP app in maintenance (e.g. rename `index.php`, or an `.htaccess` redirect to `maintanence.png`). Keep `waapi/` webhooks **up**, so Meta status updates are still recorded until the switch. | old server |
| 4 | `pm2 stop wa-worker` (if it was running for tests). | droplet |
| 5 | `RESET=1 bash deploy/migrate.sh`. This is a fresh full copy; it must end with "Verification" OK. | droplet |
| 6 | Final media sync (same rsync commands, only changes are copied). | droplet |
| 7 | In `shared/.env`: set `SITE_URL`/`MEDIA_URL` to `https://wa.jscoretech.com/` and `WA_API_URL=https://graph.facebook.com/v25.0/`. | droplet |
| 8 | Nginx: add `wa.jscoretech.com` to `server_name`, then `sudo certbot --nginx -d wa.jscoretech.com`. Certbot needs DNS to already point here, so do step 9 first. Or use the DNS-01 challenge to issue the certificate before switching. | droplet |
| 9 | **DNS**: change the `A` record of `wa.jscoretech.com` to the droplet IP (lower its TTL to 300 s a day earlier). | DNS provider |
| 10 | `pm2 restart ecosystem.config.cjs --update-env` (web + worker). | droplet |
| 11 | Check: login, dashboard, a test message to your own number, `pm2 logs wa-worker`, and that Meta delivery statuses arrive (`/waapi/webhook.php` in Nginx access log). | — |

**Meta webhook URL**: the new app serves the same paths (`/waapi/webhook.php` etc.) on
the same domain, so no change is needed in the Meta developer console. Only if you
decide on a new domain/path, update *WhatsApp → Configuration → Webhook* there.
The same applies to Shopify and any client that calls `/api/secure/v1/...`.

## 3. Rollback

The old server is untouched, so you can go back for as long as you keep it running:

1. `pm2 stop all` on the droplet.
2. Point the DNS `A` record back to the old server.
3. Re-enable the PHP crontab and remove the maintenance page.

Messages sent or received **after** the switch exist only in PostgreSQL. If you roll back after real traffic, export those rows (`m_id > <last id migrated>`) before switching back. Keep the old server for at least 2–4 weeks after cut-over.
