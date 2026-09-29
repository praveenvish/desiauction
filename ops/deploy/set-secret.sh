#!/usr/bin/env bash
# Put a secret into one environment's env files WITHOUT it passing through
# anything but this terminal: the value is read with hidden input and written
# straight into the files, replacing an existing `KEY=` line or the commented
# `# KEY=` placeholder init-env.sh left for it.
#
#   sudo set-secret production SES_ACCESS_KEY_ID web.env runner.env
#   sudo set-secret production SES_SECRET_ACCESS_KEY web.env runner.env
#
# The value is never echoed, logged or put on a command line (where `ps` and
# shell history would see it). Restart the affected services afterwards —
# env files are read when a container starts.
set -Eeuo pipefail

ENV_NAME="${1:?usage: set-secret <production|staging> <KEY> <file.env>...}"
KEY="${2:?usage: set-secret <production|staging> <KEY> <file.env>...}"
shift 2
[ "$#" -ge 1 ] || { echo "name at least one env file"; exit 1; }
[[ "$KEY" =~ ^[A-Z][A-Z0-9_]*$ ]] || { echo "bad key name: $KEY"; exit 1; }
[ "$(id -u)" = 0 ] || { echo "run with sudo"; exit 1; }

DIR="/srv/apps/desiauction/$ENV_NAME"
for f in "$@"; do
  [ -f "$DIR/$f" ] || { echo "no such file: $DIR/$f"; exit 1; }
done

read -rsp "Value for $KEY (input hidden): " VALUE
echo
[ -n "$VALUE" ] || { echo "empty value — nothing changed"; exit 1; }
case "$VALUE" in *$'\n'* | *$'\r'*) echo "value contains a newline — refused"; exit 1 ;; esac

for f in "$@"; do
  path="$DIR/$f"
  tmp="$(mktemp "$path.XXXXXX")"
  # Environment variables, not argv: the value stays out of the process list.
  KEY="$KEY" VALUE="$VALUE" awk '
    BEGIN { k = ENVIRON["KEY"]; v = ENVIRON["VALUE"]; done = 0 }
    $0 ~ "^(# )?" k "=" && !done { print k "=" v; done = 1; next }
    { print }
    END { if (!done) print k "=" v }
  ' "$path" >"$tmp"
  chown --reference="$path" "$tmp"
  chmod --reference="$path" "$tmp"
  mv "$tmp" "$path"
  echo "  set $KEY in $f"
done
