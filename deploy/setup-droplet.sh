#!/usr/bin/env bash
# One-time (and safe to re-run) bootstrap of a fresh Ubuntu 24.04 droplet.
# Run as root:   curl/scp this file to the droplet, then:  sudo bash setup-droplet.sh
#
# Installs: deploy user, firewall, fail2ban, automatic security updates, swap,
# Node.js 22 LTS + PM2, Nginx, certbot, PostgreSQL 17 client tools, pgloader.
set -euo pipefail

DEPLOY_USER="${DEPLOY_USER:-deploy}"
APP_ROOT="${APP_ROOT:-/var/www/wa}"
SWAP_SIZE="${SWAP_SIZE:-2G}"
NODE_MAJOR=22

if [[ $EUID -ne 0 ]]; then echo "Run as root (sudo bash $0)" >&2; exit 1; fi
export DEBIAN_FRONTEND=noninteractive

echo "==> Base packages and updates"
apt-get update -y
apt-get upgrade -y
apt-get install -y ca-certificates curl gnupg git rsync unzip jq build-essential \
  ufw fail2ban unattended-upgrades nginx certbot python3-certbot-nginx

echo "==> Timezone Asia/Kolkata (the app's send window 07:00-23:00 is India time)"
timedatectl set-timezone Asia/Kolkata

echo "==> Automatic security updates"
dpkg-reconfigure -f noninteractive unattended-upgrades
cat > /etc/apt/apt.conf.d/20auto-upgrades <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
EOF

echo "==> Swap file ($SWAP_SIZE) so builds don't run out of memory"
if ! swapon --show | grep -q '/swapfile'; then
  if [[ ! -f /swapfile ]]; then
    fallocate -l "$SWAP_SIZE" /swapfile
    chmod 600 /swapfile
    mkswap /swapfile
  fi
  swapon /swapfile
fi
grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
sysctl -q -w vm.swappiness=10
echo 'vm.swappiness=10' > /etc/sysctl.d/99-swappiness.conf

echo "==> Firewall: SSH, HTTP, HTTPS only"
ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw --force enable

echo "==> fail2ban for SSH"
cat > /etc/fail2ban/jail.d/sshd.local <<'EOF'
[sshd]
enabled = true
maxretry = 5
bantime = 1h
EOF
systemctl enable --now fail2ban
systemctl restart fail2ban

echo "==> Node.js $NODE_MAJOR LTS (NodeSource)"
if ! command -v node >/dev/null || [[ "$(node -v | cut -d. -f1)" != "v$NODE_MAJOR" ]]; then
  install -d -m 0755 /etc/apt/keyrings
  curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
    | gpg --dearmor --yes -o /etc/apt/keyrings/nodesource.gpg
  echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_$NODE_MAJOR.x nodistro main" \
    > /etc/apt/sources.list.d/nodesource.list
  apt-get update -y
  apt-get install -y nodejs
fi
node -v

echo "==> PostgreSQL 17 client tools (psql, pg_dump) and pgloader"
if [[ ! -f /etc/apt/sources.list.d/pgdg.list ]]; then
  install -d -m 0755 /usr/share/postgresql-common/pgdg
  curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc \
    -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc
  echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt $(. /etc/os-release && echo "$VERSION_CODENAME")-pgdg main" \
    > /etc/apt/sources.list.d/pgdg.list
  apt-get update -y
fi
apt-get install -y postgresql-client-17 pgloader

echo "==> Deploy user '$DEPLOY_USER'"
if ! id "$DEPLOY_USER" >/dev/null 2>&1; then
  adduser --disabled-password --gecos "" "$DEPLOY_USER"
fi
usermod -aG www-data "$DEPLOY_USER"
# Reuse root's authorized SSH keys so you can log in as the deploy user.
if [[ -f /root/.ssh/authorized_keys ]]; then
  install -d -m 0700 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "/home/$DEPLOY_USER/.ssh"
  install -m 0600 -o "$DEPLOY_USER" -g "$DEPLOY_USER" /root/.ssh/authorized_keys "/home/$DEPLOY_USER/.ssh/authorized_keys"
fi
# Let the deploy user reload nginx without a password (nothing else).
echo "$DEPLOY_USER ALL=(root) NOPASSWD: /usr/sbin/nginx -t, /usr/bin/systemctl reload nginx" > /etc/sudoers.d/wa-deploy
chmod 0440 /etc/sudoers.d/wa-deploy

echo "==> App folders under $APP_ROOT"
install -d -m 0755 -o "$DEPLOY_USER" -g www-data "$APP_ROOT" "$APP_ROOT/releases" "$APP_ROOT/shared" \
  "$APP_ROOT/shared/logs" "$APP_ROOT/shared/storage" "$APP_ROOT/shared/storage/waapi-media"
# media/ must be readable by nginx (www-data group) and writable by the app.
install -d -m 2775 -o "$DEPLOY_USER" -g www-data "$APP_ROOT/shared/media"
install -d -m 0750 -o "$DEPLOY_USER" -g "$DEPLOY_USER" /var/backups/wa

echo "==> PM2 (process manager) with boot start-up for $DEPLOY_USER"
npm install -g pm2@latest
env PATH="$PATH:/usr/bin" pm2 startup systemd -u "$DEPLOY_USER" --hp "/home/$DEPLOY_USER" >/dev/null
sudo -u "$DEPLOY_USER" pm2 install pm2-logrotate >/dev/null 2>&1 || true
sudo -u "$DEPLOY_USER" pm2 set pm2-logrotate:max_size 50M >/dev/null 2>&1 || true
sudo -u "$DEPLOY_USER" pm2 set pm2-logrotate:retain 14 >/dev/null 2>&1 || true

echo "==> Nginx"
rm -f /etc/nginx/sites-enabled/default
systemctl enable --now nginx

cat <<EOF

Done. Next steps (docs/DEPLOY.md, step 6 onwards):
  1. Log in as $DEPLOY_USER:   ssh $DEPLOY_USER@<droplet-ip>
  2. Put the environment file at $APP_ROOT/shared/.env  (deploy/.env.production.example), chmod 600
  3. Install deploy/nginx/wa.conf as /etc/nginx/sites-available/wa.conf, enable it, then run certbot
  4. Run deploy/deploy.sh for the first release
EOF
