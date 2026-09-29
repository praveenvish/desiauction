#!/usr/bin/env bash
# Ship the shared layer to a host and converge it. Run from the repo root on an
# operator machine; the operator account (`ops`, from ops/host/bootstrap.sh)
# needs sudo on the host.
#
#   ops/platform/apply.sh da-vps
#
# Safe to re-run: it only recreates containers whose definition changed, then
# reconnects the edge Caddy to every project's `<stack>-public` network (a
# recreated container loses the connections deploys made) and reloads it.
set -Eeuo pipefail

HOST="${1:?usage: ops/platform/apply.sh <ssh-host>}"
cd "$(dirname "$0")"

rsync -rlptz --delete --rsync-path="sudo rsync" \
  --include='docker-compose.yml' --include='Caddyfile' \
  --include='observability/***' --exclude='*' \
  ./ "$HOST:/srv/platform/"

ssh "$HOST" 'bash -s' <<'EOF'
set -Eeuo pipefail
cd /srv/platform
sudo install -d -m 755 -o deploy -g deploy sites
sudo chown -R deploy:deploy /srv/platform
if ! sudo test -f .env; then
  echo "/srv/platform/.env is missing. Create it (chmod 600, owner deploy) with:"
  echo "  ALERT_WEBHOOK_URL=https://ntfy.sh/<topic>   (or any webhook — README.md)"
  exit 1
fi

sudo docker compose pull -q
sudo docker compose up -d --remove-orphans

for net in $(sudo docker network ls --format '{{.Name}}' | grep -- '-public$' || true); do
  sudo docker network connect "$net" edge-caddy 2>/dev/null && echo "connected edge-caddy to $net" || true
done

# Validate before reloading: a bad site file is reported here with its line,
# and a refused reload leaves the running config in place anyway.
sudo docker exec edge-caddy caddy validate --config /etc/caddy/Caddyfile >/dev/null
sudo docker exec edge-caddy caddy reload --config /etc/caddy/Caddyfile
sudo docker compose restart grafana alloy >/dev/null
sudo docker compose ps --format 'table {{.Service}}\t{{.Status}}'
EOF
