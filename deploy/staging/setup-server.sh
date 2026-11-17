#!/usr/bin/env bash
# One-time preparation of a fresh Ubuntu 24.04 server for the password-protected staging site
# (docs/operations/staging.md, ADR 0033). Run as root, once, right after the server is created:
#
#   ssh root@<server-ip>
#   git clone https://github.com/VladimirKadanov/WingChunRoots.git /root/wcr-setup
#   bash /root/wcr-setup/deploy/staging/setup-server.sh
#
# What it does (each step is safe to repeat):
#   1. system updates, automatic security updates, the tools the scripts need (git, age, rsync);
#   2. Docker Engine with the Compose plugin from Docker's own apt repository;
#   3. 2 GB of swap (a safety net for short memory spikes, such as resizing an uploaded photo);
#   4. a firewall that lets in only SSH, HTTP and HTTPS;
#   5. the user `deploy` (uid 1000, the uid of the app containers' user, so both can write the
#      archive folder), with root's SSH keys; password logins over SSH are turned off when a key exists;
#   6. Node from .nvmrc (SHA-256 checked against nodejs.org's SHASUMS256.txt) and pnpm from
#      packageManager, for the operator commands (demo data, admin:create, archives);
#   7. the repository in /home/deploy/wingchunroots.
#
# It prints no secret. Everything after this runs as `deploy` through deploy/staging/staging.sh.
set -euo pipefail

REPO_URL="${WCR_REPO_URL:-https://github.com/VladimirKadanov/WingChunRoots.git}"
DEPLOY_USER=deploy
DEPLOY_HOME="/home/${DEPLOY_USER}"
APP_DIR="${DEPLOY_HOME}/wingchunroots"
SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

log() { printf 'setup-server: %s\n' "$*"; }
die() { printf 'setup-server: error: %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" = 0 ] || die "run as root (ssh root@<server-ip>)"
. /etc/os-release
[ "${ID:-}" = ubuntu ] || die "made for Ubuntu 24.04; this is ${PRETTY_NAME:-unknown}"
[ "$(uname -m)" = x86_64 ] || die "needs an x86_64 server: the PostGIS image is published for linux/amd64 only"
[ -f "${SRC_DIR}/.nvmrc" ] && [ -f "${SRC_DIR}/package.json" ] || die "run it from a clone of the repository"

export DEBIAN_FRONTEND=noninteractive

# 1. Updates and tools -------------------------------------------------------------------------
log "updating the system"
apt-get update -q
apt-get -y -q -o Dpkg::Options::=--force-confold upgrade
apt-get -y -q install ca-certificates curl git gnupg ufw unattended-upgrades age rsync xz-utils
# Security updates install themselves every day.
cat > /etc/apt/apt.conf.d/20auto-upgrades <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
EOF

# 2. Docker ------------------------------------------------------------------------------------
if ! command -v docker >/dev/null 2>&1; then
  log "installing Docker Engine and the Compose plugin"
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  echo "deb [arch=amd64 signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu ${VERSION_CODENAME} stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update -q
  apt-get -y -q install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi
# Container logs rotate instead of filling the disk.
if [ ! -f /etc/docker/daemon.json ]; then
  cat > /etc/docker/daemon.json <<'EOF'
{ "log-driver": "json-file", "log-opts": { "max-size": "20m", "max-file": "5" } }
EOF
  systemctl restart docker
fi
systemctl enable --now docker >/dev/null

# 3. Swap --------------------------------------------------------------------------------------
if ! swapon --show | grep -q .; then
  log "adding 2 GB of swap"
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile >/dev/null
  swapon /swapfile
  grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
  echo 'vm.swappiness=10' > /etc/sysctl.d/90-wcr-swap.conf
  sysctl -q -p /etc/sysctl.d/90-wcr-swap.conf
fi

# 4. Firewall ----------------------------------------------------------------------------------
# Docker publishes only Caddy's 80 and 443 on all addresses; every other port is on 127.0.0.1.
log "firewall: SSH, HTTP and HTTPS only"
ufw allow OpenSSH >/dev/null
ufw allow 80/tcp >/dev/null
ufw allow 443/tcp >/dev/null
ufw allow 443/udp >/dev/null
ufw --force enable >/dev/null

# 5. The deploy user ---------------------------------------------------------------------------
if ! id "$DEPLOY_USER" >/dev/null 2>&1; then
  if getent passwd 1000 >/dev/null; then
    die "uid 1000 belongs to $(getent passwd 1000 | cut -d: -f1); the app containers write the archive folder as uid 1000, so ${DEPLOY_USER} needs it"
  fi
  log "creating the user ${DEPLOY_USER}"
  useradd --create-home --uid 1000 --shell /bin/bash "$DEPLOY_USER"
fi
[ "$(id -u "$DEPLOY_USER")" = 1000 ] || die "${DEPLOY_USER} must have uid 1000 (the app containers' user)"
usermod -aG docker "$DEPLOY_USER"
if [ -s /root/.ssh/authorized_keys ]; then
  install -d -m 0700 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "${DEPLOY_HOME}/.ssh"
  install -m 0600 -o "$DEPLOY_USER" -g "$DEPLOY_USER" /root/.ssh/authorized_keys "${DEPLOY_HOME}/.ssh/authorized_keys"
  # Keys only: no password guessing over SSH.
  cat > /etc/ssh/sshd_config.d/90-wcr.conf <<'EOF'
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin prohibit-password
EOF
  systemctl reload ssh
  log "SSH: keys only (ssh ${DEPLOY_USER}@<server-ip> works with the same key as root)"
else
  log "warning: root has no SSH key, so password logins stay on. Add a key in the Hetzner Console and run this again."
fi

# 6. Node and pnpm -----------------------------------------------------------------------------
NODE_VERSION="$(tr -d ' \nv' < "${SRC_DIR}/.nvmrc")"
PNPM_VERSION="$(sed -nE 's/.*"packageManager": *"pnpm@([^"]+)".*/\1/p' "${SRC_DIR}/package.json")"
[ -n "$PNPM_VERSION" ] || die "packageManager not found in package.json"
if [ "$(node -v 2>/dev/null || true)" != "v${NODE_VERSION}" ]; then
  log "installing Node ${NODE_VERSION} from nodejs.org"
  tarball="node-v${NODE_VERSION}-linux-x64.tar.xz"
  tmp="$(mktemp -d)"
  curl -fsSL --retry 3 -o "${tmp}/${tarball}" "https://nodejs.org/dist/v${NODE_VERSION}/${tarball}"
  curl -fsSL --retry 3 -o "${tmp}/SHASUMS256.txt" "https://nodejs.org/dist/v${NODE_VERSION}/SHASUMS256.txt"
  (cd "$tmp" && grep " ${tarball}\$" SHASUMS256.txt | sha256sum -c --status) || die "the Node download does not match SHASUMS256.txt"
  tar -xJf "${tmp}/${tarball}" -C /usr/local --strip-components=1 --no-same-owner
  rm -rf "$tmp"
fi
if [ "$(pnpm -v 2>/dev/null || true)" != "$PNPM_VERSION" ]; then
  log "installing pnpm ${PNPM_VERSION}"
  npm install --global "pnpm@${PNPM_VERSION}" >/dev/null
fi

# 7. The repository ----------------------------------------------------------------------------
if [ ! -d "${APP_DIR}/.git" ]; then
  log "cloning the repository into ${APP_DIR}"
  sudo -u "$DEPLOY_USER" git clone -q "$REPO_URL" "$APP_DIR"
fi

log "done. Next, as ${DEPLOY_USER}:"
log "  ssh ${DEPLOY_USER}@<server-ip>"
log "  cd wingchunroots && deploy/staging/staging.sh init"
