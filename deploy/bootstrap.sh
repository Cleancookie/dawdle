#!/usr/bin/env bash
# Bootstrap a fresh Ubuntu 24.04 droplet for asdf.land
# Run as root: bash bootstrap.sh
set -euo pipefail

APP_USER="deploy"
APP_DIR="/srv/asdfland"

echo "==> Updating system packages..."
apt-get update -qq
apt-get upgrade -y -qq

# ── Swap (essential on 512MB RAM) ─────────────────────────────────────────────
echo "==> Setting up 1GB swap..."
if [ ! -f /swapfile ]; then
    fallocate -l 1G /swapfile
    chmod 600 /swapfile
    mkswap /swapfile
    swapon /swapfile
    echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi
# Prefer RAM over swap until memory is nearly full
sysctl -w vm.swappiness=10
grep -q 'vm.swappiness' /etc/sysctl.conf || echo 'vm.swappiness=10' >> /etc/sysctl.conf

# ── Docker ────────────────────────────────────────────────────────────────────
echo "==> Installing Docker..."
apt-get install -y ca-certificates curl gnupg
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
    | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
chmod a+r /etc/apt/keyrings/docker.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
    https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
    | tee /etc/apt/sources.list.d/docker.list > /dev/null
apt-get update -qq
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
systemctl enable --now docker

# ── Deploy user ───────────────────────────────────────────────────────────────
echo "==> Creating deploy user..."
if ! id "$APP_USER" &>/dev/null; then
    useradd -m -s /bin/bash "$APP_USER"
fi
usermod -aG docker "$APP_USER"

# Copy root's SSH keys so you can still log in as deploy
mkdir -p "/home/$APP_USER/.ssh"
if [ -f /root/.ssh/authorized_keys ]; then
    cp /root/.ssh/authorized_keys "/home/$APP_USER/.ssh/authorized_keys"
fi
chown -R "$APP_USER:$APP_USER" "/home/$APP_USER/.ssh"
chmod 700 "/home/$APP_USER/.ssh"
chmod 600 "/home/$APP_USER/.ssh/authorized_keys" 2>/dev/null || true

# ── App directory ─────────────────────────────────────────────────────────────
echo "==> Creating app directory $APP_DIR..."
mkdir -p "$APP_DIR"
chown "$APP_USER:$APP_USER" "$APP_DIR"

# ── Firewall ──────────────────────────────────────────────────────────────────
echo "==> Configuring firewall..."
apt-get install -y ufw
ufw --force reset
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp   comment 'SSH'
ufw allow 80/tcp   comment 'HTTP'
ufw allow 443/tcp  comment 'HTTPS'
ufw --force enable

# ── Fail2ban ─────────────────────────────────────────────────────────────────
echo "==> Installing fail2ban..."
apt-get install -y fail2ban
systemctl enable --now fail2ban

echo ""
echo "✓ Bootstrap complete!"
echo ""
echo "Next steps (run as $APP_USER):"
echo "  ssh $APP_USER@<your-ip>"
echo "  cd $APP_DIR"
echo "  git clone <your-repo-url> ."
echo "  cp .env.prod.example .env && nano .env   # fill in secrets"
echo "  bash deploy/deploy.sh"
