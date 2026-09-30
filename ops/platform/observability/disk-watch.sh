#!/bin/sh
# HOW FULL IS THE DISK — SAID AS A LOG LINE (PRR 2026-09-29, OPS-7).
#
# Everything this host alerts on is a line in Loki, and nothing wrote a line
# about the one resource that stops all of it at once. A full disk does not
# fail politely: Postgres cannot write WAL and panics, Loki stops ingesting (so
# the alerts go quiet exactly then), Docker cannot pull the image that would
# fix it. It also arrives slowly, which makes it the easiest outage to be told
# about in time.
#
# One JSON line per filesystem, every five minutes, in the shape the pino
# stage already reads (`level` as a number). The THRESHOLD lives in the alert
# rule, not here — this only measures. `worstPct` is the larger of space and
# inodes: a disk with free space and no free inodes is just as full.
#
# The host's root is mounted read-only at /host. Nothing is written, anywhere.
set -u

EVERY="${DISK_WATCH_EVERY_SECONDS:-300}"
PATHS="${DISK_WATCH_PATHS:-/host /host/var/lib/docker}"
NOTICE_AT="${DISK_WATCH_NOTICE_PCT:-80}"

# PID 1 ignores SIGTERM unless it says otherwise; without this every
# `compose up` waits ten seconds to kill a script that was only sleeping.
trap 'exit 0' TERM INT

number_or_zero() {
  case "$1" in
    '' | *[!0-9]*) echo 0 ;;
    *) echo "$1" ;;
  esac
}

measure() {
  seen=""
  for path in $PATHS; do
    [ -d "$path" ] || continue
    line="$(df -P "$path" 2>/dev/null | tail -n 1)"
    [ -n "$line" ] || continue
    device="$(echo "$line" | awk '{print $1}')"
    # /var/lib/docker is usually the root filesystem again: say it once.
    case " $seen " in *" $device "*) continue ;; esac
    seen="$seen $device"

    used="$(number_or_zero "$(echo "$line" | awk '{gsub("%","",$5); print $5}')")"
    free_mb="$(number_or_zero "$(echo "$line" | awk '{printf "%d", $4 / 1024}')")"
    # Some filesystems do not count inodes and print "-".
    inodes="$(number_or_zero "$(df -Pi "$path" 2>/dev/null | tail -n 1 | awk '{gsub("%","",$5); print $5}')")"
    worst="$used"
    [ "$inodes" -gt "$worst" ] && worst="$inodes"

    mount="${path#/host}"
    [ -n "$mount" ] || mount="/"
    if [ "$worst" -ge "$NOTICE_AT" ]; then
      level=40
      msg="disk filling"
    else
      level=30
      msg="disk usage"
    fi
    printf '{"level":%s,"time":%s000,"msg":"%s","mount":"%s","usedPct":%s,"inodePct":%s,"worstPct":%s,"freeMb":%s}\n' \
      "$level" "$(date +%s)" "$msg" "$mount" "$used" "$inodes" "$worst" "$free_mb"
  done
}

while :; do
  measure
  sleep "$EVERY" &
  wait $!
done
