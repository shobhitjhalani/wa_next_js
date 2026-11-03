# Deploying to DigitalOcean

Setup: one **Droplet** (Ubuntu server running the Next.js app and the queue worker)
plus a **Managed PostgreSQL** database. DigitalOcean runs the database for you,
including backups, updates and failover.

```
 Internet ──► Nginx (HTTPS, /media from disk) ──► wa-web (Next.js, PM2, 2 instances)
                                                  wa-worker (queue sender, PM2)
                     │ private network (VPC)
                     ▼
            Managed PostgreSQL 17 (schemas: public, log)
```

## 1. Sizes and cost

| Item | Recommendation | Why |
|------|---------------|-----|
| Droplet | **Basic, 2 vCPU / 4 GB RAM / 80 GB SSD** (Regular or Premium Intel) | 2 web processes (~300 MB each) + worker + `next build` during deploys (needs ~2 GB). Disk holds 2.6 GB media plus growth, releases and backups. 2 GB RAM works with swap, but builds get slow. |
| Database | **Managed PostgreSQL 17, 1 vCPU / 2 GB RAM / 30 GB, 1 node** | The message table is about 3 GB in MySQL (around 1.2 GB of data plus indexes in Postgres) with room to grow. Upgrade to 2 GB/4 GB, or add a standby node, when traffic grows. Sizes can be changed later from the panel. |
| Region | **BLR1 (Bangalore)** for both | Closest to your users. Both must be in the **same region and VPC** so they talk over the private network. |
| Backups | Droplet backups: on (weekly) | Managed PG has daily backups included. |

**Rough monthly cost (estimate when written; check current prices at digitalocean.com/pricing):**
Droplet 4 GB ≈ $24 + Droplet backups ≈ $5 + Managed PG 2 GB ≈ $30. **Total ≈ $60 / month (≈ ₹5,000).**
A smaller start (2 GB droplet $12 + 1 GB DB $15) is about $30 but leaves little headroom.

## 2. Create the resources (DigitalOcean control panel)

1. **SSH key**: on your computer, run `ssh-keygen -t ed25519` (if you don't have a key), then add `~/.ssh/id_ed25519.pub` under *Settings → Security → SSH Keys*.
2. **Database**: *Create → Databases → PostgreSQL 17*, region BLR1, plan as above, name `wa-db`. Wait until it's "Online".
   - *Users & Databases*: add user `wa_app` and database `wa_jscoretech` (see `deploy/migrate-production.md` step 0 for ownership).
   - *Connection details*: choose **VPC network** and copy host, port (25060) and password. Download the CA certificate too.
3. **Droplet**: *Create → Droplets*, region BLR1, **same VPC**, image **Ubuntu 24.04 LTS**, size as above, authentication **SSH key**, enable backups. Name it `wa-app`.
4. **Trusted sources** (Database → Settings): add the droplet `wa-app`. Only then can it connect. While migrating from your Mac (option B), add your office IP temporarily.
5. **Cloud firewall** (optional, on top of ufw): *Networking → Firewalls*. Inbound 22 (your office IP only, if it's fixed), 80, 443; outbound all. Apply it to `wa-app`.
6. **DNS**: at your domain provider, create `A  new.wa.jscoretech.com → <droplet public IP>`. Leave `wa.jscoretech.com` alone until cut-over.

## 3. Prepare the server (once)

```bash
scp deploy/setup-droplet.sh root@<droplet-ip>:/root/
ssh root@<droplet-ip> 'bash /root/setup-droplet.sh'
```
This installs the firewall, fail2ban, automatic security updates, a 2 GB swap file,
Node.js 22, PM2, Nginx, certbot, `psql`/`pg_dump` 17 and pgloader. It creates the
user `deploy` and the folders under `/var/www/wa`, and sets the timezone to Asia/Kolkata.
It is safe to run again.

From now on, log in as **deploy**: `ssh deploy@<droplet-ip>`. If root login is no longer needed, set `PermitRootLogin no` in `/etc/ssh/sshd_config`.

## 4. Configuration

```bash
# on the droplet as deploy
nano /var/www/wa/shared/.env        # start from deploy/.env.production.example
chmod 600 /var/www/wa/shared/.env
```
- `SESSION_SECRET`: `openssl rand -base64 48`.
- `DATABASE_URL`: the VPC host, user `wa_app`, `?sslmode=require&connection_limit=8`.
- Until cut-over, keep `WA_API_URL=http://127.0.0.1:9/` so the worker **cannot** send real messages from copied data.
- Rotate the secrets that were stored in the old `config/general.php` (SES SMTP password, CCAvenue keys, WhatsApp token). Put the new values here only.

## 5. Nginx + HTTPS

```bash
sudo cp /var/www/wa/incoming/deploy/nginx/wa.conf /etc/nginx/sites-available/wa.conf   # after the first push
sudo ln -sf /etc/nginx/sites-available/wa.conf /etc/nginx/sites-enabled/wa.conf
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d new.wa.jscoretech.com --redirect -m support@jscoretech.com --agree-tos
```
Certbot renews automatically (`systemctl list-timers | grep certbot`).

## 6. Deploy the app

From your computer, in the project folder:
```bash
DROPLET=deploy@<droplet-ip> bash deploy/push.sh
```
This uploads the code and runs `deploy/deploy.sh` on the server. That script:
1. builds a new release folder;
2. links the shared `.env`, `media` and `storage`;
3. runs `npm ci`, `prisma generate` and `next build`;
4. switches `current` to the new release;
5. reloads PM2 without downtime, then health-checks the app.

If the health check fails, it **automatically rolls back**. It keeps the last 5 releases.

- Manual rollback: `bash /var/www/wa/current/deploy/rollback.sh`
- Status and logs: `pm2 status`, `pm2 logs wa-web`, `pm2 logs wa-worker`

The first time, after `deploy.sh` has run: `pm2 save` (it already does this). PM2 then restarts both apps after a reboot.

## 7. Data

Follow **`deploy/migrate-production.md`**: rehearse the migration, test on
`new.wa.jscoretech.com`, then do the cut-over (stop PHP crons → final migration →
DNS switch → start the worker).

## 8. Backups

- **Managed PostgreSQL**: daily automatic backups with point-in-time restore (*Database → Backups*). Restoring creates a new cluster.
- **Your own nightly copy**: `deploy/backup.sh` writes `pg_dump` files to `/var/backups/wa` and keeps 7 days. Install it as the deploy user's cron:
  ```
  30 2 * * * /var/www/wa/current/deploy/backup.sh >> /var/www/wa/shared/logs/backup.log 2>&1
  ```
  Download one now and then (`scp deploy@<ip>:/var/backups/wa/*.dump .`), because a backup that lives on the same droplet doesn't survive losing the droplet.
- **Media** (`/var/www/wa/shared/media`): covered by Droplet backups. For an off-site copy, sync it to DigitalOcean Spaces (about $5 per month for 250 GB) with `rclone sync` or `s3cmd sync` on a nightly cron.

## 9. Day-to-day

| Task | Command |
|------|---------|
| App status | `pm2 status` |
| Live logs | `pm2 logs wa-worker --lines 100` |
| Restart worker only | `pm2 restart wa-worker` |
| Stop sending (emergency) | `pm2 stop wa-worker` |
| Disk space | `df -h; du -sh /var/www/wa/shared/media` |
| DB console | `psql "$(grep ^DATABASE_URL /var/www/wa/shared/.env \| cut -d= -f2- \| tr -d '"' \| sed 's/&connection_limit=[0-9]*//')"` |
