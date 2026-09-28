#!/usr/bin/env bash
# One-time (and re-runnable) baseline for a fresh Ubuntu 24.04/26.04 VPS that
# will host several Docker Compose projects, each with staging + production.
#
#   scp ops/host/bootstrap.sh root@HOST:/root/
#   ssh root@HOST 'ADMIN_PUBKEY="ssh-ed25519 AAAA… you@mac" bash /root/bootstrap.sh'
#   # prove `ssh ops@HOST sudo true` works in a SECOND terminal, then:
#   ssh ops@HOST 'sudo LOCK_ROOT=1 bash /root/bootstrap.sh'
#
# Every step is idempotent: running it again converges, it never duplicates.
# The host keeps NO application state of its own — everything a project needs
# lives under /srv/apps/<project>/<env> and its Docker volumes (README.md).
set -Eeuo pipefail

ADMIN_USER="${ADMIN_USER:-ops}"
ADMIN_PUBKEY="${ADMIN_PUBKEY:-}"
DEPLOY_USER="${DEPLOY_USER:-deploy}"
DEPLOY_PUBKEY="${DEPLOY_PUBKEY:-}"
SWAP_SIZE="${SWAP_SIZE:-4G}"
LOCK_ROOT="${LOCK_ROOT:-0}"

log() { printf '\n==> %s\n' "$*"; }
[ "$(id -u)" = 0 ] || { echo "run as root (or with sudo)"; exit 1; }
. /etc/os-release
[ "$ID" = ubuntu ] || { echo "Ubuntu only (found $ID)"; exit 1; }

# --- Packages ---------------------------------------------------------------
log "Base packages + security updates"
export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get upgrade -yq -o Dpkg::Options::=--force-confold
apt-get install -yq ca-certificates curl gnupg ufw unattended-upgrades jq htop ncdu

# Security updates install themselves; the machine does NOT reboot itself. An
# unattended reboot during a live auction is an outage — reboots are scheduled
# by a person (the motd and /var/run/reboot-required say when one is due).
cat >/etc/apt/apt.conf.d/52-host-policy <<'EOF'
Unattended-Upgrade::Automatic-Reboot "false";
Unattended-Upgrade::Remove-Unused-Dependencies "true";
EOF
systemctl enable --now unattended-upgrades

# --- Users ------------------------------------------------------------------
# ops    = a human (sudo). deploy = CI only (docker group, no sudo).
# Being in the docker group is root-equivalent; the deploy key lives only in
# GitHub environment secrets and nowhere else.
add_user() { # name pubkey groups
  local name="$1" key="$2" groups="$3"
  id "$name" >/dev/null 2>&1 || adduser --disabled-password --gecos "" "$name"
  [ -n "$groups" ] && usermod -aG "$groups" "$name"
  install -d -m 700 -o "$name" -g "$name" "/home/$name/.ssh"
  if [ -n "$key" ]; then
    touch "/home/$name/.ssh/authorized_keys"
    grep -qxF "$key" "/home/$name/.ssh/authorized_keys" || echo "$key" >>"/home/$name/.ssh/authorized_keys"
  fi
  chown "$name:$name" "/home/$name/.ssh/authorized_keys" 2>/dev/null || true
  chmod 600 "/home/$name/.ssh/authorized_keys" 2>/dev/null || true
}

log "Users: $ADMIN_USER (sudo), $DEPLOY_USER (docker)"
[ -n "$ADMIN_PUBKEY" ] || [ -s "/home/$ADMIN_USER/.ssh/authorized_keys" ] ||
  { echo "ADMIN_PUBKEY is required on the first run"; exit 1; }
add_user "$ADMIN_USER" "$ADMIN_PUBKEY" sudo
# Key-only login, so sudo cannot ask for a password nobody has.
echo "$ADMIN_USER ALL=(ALL) NOPASSWD:ALL" >"/etc/sudoers.d/90-$ADMIN_USER"
chmod 440 "/etc/sudoers.d/90-$ADMIN_USER"
visudo -cq

# --- SSH --------------------------------------------------------------------
# sshd takes the FIRST value it reads for each option, and the drop-ins are read
# in name order — so this file must sort before the image's 50-cloud-init.conf,
# which turns PasswordAuthentication ON.
log "SSH: keys only"
ROOT_LOGIN=prohibit-password
[ "$LOCK_ROOT" = 1 ] && ROOT_LOGIN=no
cat >/etc/ssh/sshd_config.d/00-host-hardening.conf <<EOF
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin $ROOT_LOGIN
PermitEmptyPasswords no
X11Forwarding no
MaxAuthTries 3
LoginGraceTime 20
ClientAliveInterval 60
ClientAliveCountMax 3
# ONE host key, so the fingerprint CI pins (DEPLOY_HOST_FINGERPRINT) is the one
# every client is offered. With ECDSA and RSA also present, the deploy's Go SSH
# client negotiated ECDSA first and refused the pinned ed25519 fingerprint.
HostKey /etc/ssh/ssh_host_ed25519_key
AllowUsers root $ADMIN_USER $DEPLOY_USER
EOF
if [ "$LOCK_ROOT" = 1 ]; then
  sed -i "s/^AllowUsers root /AllowUsers /" /etc/ssh/sshd_config.d/00-host-hardening.conf
fi
sshd -t
systemctl restart ssh

# --- Firewall ---------------------------------------------------------------
# 443/udp is HTTP/3 — Caddy serves it automatically, and a TCP-only rule
# silently turns it off.
#
# DOCKER BYPASSES UFW for published ports (it writes its own iptables rules).
# The rule on this host is therefore: ONLY the edge Caddy publishes ports, and
# anything else that must be reachable from the host binds 127.0.0.1.
log "Firewall"
ufw default deny incoming
ufw default allow outgoing
# `allow`, not `limit`: SSH accepts keys only (no passwords, 3 tries), so the
# rate limit bought nothing — and it blocked the deploy, whose scp step opens
# several connections in a burst (6+ per 30s trips `limit`: "i/o timeout").
ufw delete limit 22/tcp >/dev/null 2>&1 || true
ufw allow 22/tcp comment ssh
ufw allow 80/tcp comment http
ufw allow 443/tcp comment https
ufw allow 443/udp comment http3
ufw --force enable

# --- Memory -----------------------------------------------------------------
# A safety net, not capacity: every container has a memory limit, and swap is
# what keeps a brief spike from waking the OOM killer on the database.
log "Swap $SWAP_SIZE, swappiness 10"
if ! swapon --show | grep -q /swapfile; then
  fallocate -l "$SWAP_SIZE" /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
fi
grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >>/etc/fstab
cat >/etc/sysctl.d/60-host.conf <<'EOF'
vm.swappiness = 10
# Log shippers and dev tooling watch many files; the default runs out.
fs.inotify.max_user_watches = 524288
fs.inotify.max_user_instances = 1024
EOF
sysctl --system >/dev/null

# The journal is capped for the same reason container logs are: an uncapped
# log is a full disk on a slow timer.
mkdir -p /etc/systemd/journald.conf.d
printf '[Journal]\nSystemMaxUse=1G\n' >/etc/systemd/journald.conf.d/60-cap.conf
systemctl restart systemd-journald

# --- Docker -----------------------------------------------------------------
log "Docker Engine + Compose (official repo)"
if ! command -v docker >/dev/null; then
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu ${VERSION_CODENAME} stable" \
    >/etc/apt/sources.list.d/docker.list
  apt-get update -q
  apt-get install -yq docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi
# Defaults for EVERY project on the host, so a compose file that forgets its
# own logging block still cannot fill the disk.
cat >/etc/docker/daemon.json <<'EOF'
{
  "log-driver": "json-file",
  "log-opts": { "max-size": "20m", "max-file": "3" },
  "live-restore": true,
  "default-address-pools": [{ "base": "172.20.0.0/14", "size": 24 }]
}
EOF
systemctl enable docker
systemctl restart docker

add_user "$DEPLOY_USER" "$DEPLOY_PUBKEY" docker

# --- Layout -----------------------------------------------------------------
#   /srv/platform            shared: edge Caddy, logs, alerts (one of each)
#   /srv/apps/<project>/<env> one Compose project per environment
log "Directory layout"
install -d -m 755 -o "$DEPLOY_USER" -g "$DEPLOY_USER" /srv/platform /srv/apps

log "Done"
echo "  ssh   : keys only, root login = $ROOT_LOGIN"
echo "  ufw   : $(ufw status | head -1)"
echo "  swap  : $(swapon --show --noheadings | awk '{print $3}')"
echo "  docker: $(docker --version)"
[ -f /var/run/reboot-required ] && echo "  NOTE  : a reboot is required (kernel update) — schedule it"
[ "$LOCK_ROOT" = 1 ] || echo "  NEXT  : verify 'ssh $ADMIN_USER@<host> sudo true', then re-run with LOCK_ROOT=1"
