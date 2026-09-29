#!/usr/bin/env bash
# RESTORE THE REAL BACKUP, WITHOUT TOUCHING THE REAL DATABASE.
#
#   sudo bash ops/deploy/restore-drill-production.sh [production|staging]
#
# backup-drill.sh proves the MACHINERY: it makes a throwaway stanza, backs it
# up and restores it. It deliberately never reads the production stanza — so
# until this script existed, the production backup had never once been
# restored, and "we have backups" meant "we have files" (PRR 2026-09-29).
#
# This one restores the PRODUCTION stanza's newest backup, replays its WAL to
# the end of the archive, starts Postgres on the result, and asks it what it
# holds. It answers the three questions a backup exists to answer:
#
#   · can the repository be read at all — is the passphrase right?
#   · how long does it take (the RTO, measured, for RESTORE_RUNBOOK)?
#   · how recent is the newest row that came back (the RPO, measured)?
#
# WHAT KEEPS IT FROM HARMING PRODUCTION:
#   · it only READS the repository. `restore` and `archive-get` write nothing
#     to it;
#   · the restored cluster runs with archiving OFF — set three ways, because a
#     restored copy that pushed WAL into the production archive would fork its
#     timeline: `--archive-mode=off` at restore, `-c archive_mode=off` and
#     `-c archive_command=/bin/false` on the command line, which outranks every
#     file;
#   · its data lives in a volume and a container created for this run, named
#     with the time, on no network the application is on. The production
#     database, its volume and its containers are never named here;
#   · it cleans up after itself, pass or fail.
#
# It needs roughly the database's size in free disk, and it reads from S3, so
# run it outside an auction window.
#
# Overrides, for testing this script itself:
#   DRILL_ENV_FILE     the pgbackrest env file (default: the environment's)
#   DRILL_IMAGE        the database image (default: the one the environment runs)
#   DRILL_DOCKER_ARGS  extra `docker run` arguments (a repo volume, a network)
set -euo pipefail

ENV_NAME="${1:-production}"
APP_DIR="/srv/apps/desiauction/${ENV_NAME}"
ENVF="${DRILL_ENV_FILE:-${APP_DIR}/pgbackrest.env}"
[ -f "$ENVF" ] || { echo "no such file: $ENVF"; exit 1; }

IMAGE="${DRILL_IMAGE:-}"
if [ -z "$IMAGE" ]; then
  envval() { sed -n "s/^$1=//p" "${APP_DIR}/.env"; }
  IMAGE="$(envval REGISTRY)/db:$(envval DB_TAG)"
fi
docker image inspect "$IMAGE" >/dev/null 2>&1 \
  || { echo "the database image $IMAGE is not on this host — deploy first, or set DRILL_IMAGE"; exit 1; }

STAMP="$(date +%s)"
NAME="restore-drill-${STAMP}"
DATA="${NAME}-data"
CONF="${NAME}-conf"
# shellcheck disable=SC2206 # deliberately word-split: a list of docker arguments
EXTRA=(${DRILL_DOCKER_ARGS:-})

cleanup() {
  docker rm -f "$NAME" >/dev/null 2>&1 || true
  docker volume rm "$DATA" "$CONF" >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "environment: ${ENV_NAME}   image: ${IMAGE}"
echo "scratch volume: ${DATA} (removed when this finishes)"

pgb() {
  docker run --rm ${EXTRA[@]+"${EXTRA[@]}"} --env-file "$ENVF" --user postgres "$IMAGE" \
    pgbackrest --stanza=desiauction "$@"
}

echo "--- 1. what the repository holds"
pgb info | sed 's/^/  /'
NEWEST_STOP="$(pgb info --output=json | grep -o '"stop":[0-9]*' | tail -1 | cut -d: -f2)"
[ -n "$NEWEST_STOP" ] || { echo "the repository has NO backup — nothing to restore"; exit 1; }
echo "  newest backup finished $(( ( $(date +%s) - NEWEST_STOP ) / 3600 ))h ago"

echo "--- 2. restore into the scratch volume (archiving off)"
docker volume create "$DATA" >/dev/null
docker volume create "$CONF" >/dev/null
T0=$(date +%s)
docker run --rm ${EXTRA[@]+"${EXTRA[@]}"} --env-file "$ENVF" --user root \
  -v "$DATA":/var/lib/postgresql/data "$IMAGE" bash -c '
    set -e
    chown postgres:postgres /var/lib/postgresql/data
    chmod 700 /var/lib/postgresql/data
    su postgres -c "pgbackrest --stanza=desiauction --archive-mode=off restore"
  ' >/dev/null
T1=$(date +%s)
echo "  files restored: $((T1 - T0))s"

echo "--- 3. start Postgres on it and replay WAL to the end of the archive"
# The restored postgresql.conf includes /etc/postgresql/conf.d. Production
# mounts its archive settings there; this mounts an EMPTY directory, so the
# include succeeds and brings nothing with it.
docker run -d --name "$NAME" ${EXTRA[@]+"${EXTRA[@]}"} --env-file "$ENVF" --shm-size=256m \
  -v "$DATA":/var/lib/postgresql/data -v "$CONF":/etc/postgresql/conf.d:ro \
  "$IMAGE" postgres -c archive_mode=off -c archive_command=/bin/false >/dev/null

psqlq() { docker exec "$NAME" psql -U postgres -d "${2:-postgres}" -Atc "$1"; }
DEADLINE=$(( $(date +%s) + 1800 ))
until [ "$(psqlq 'select pg_is_in_recovery()' 2>/dev/null || echo wait)" = "f" ]; do
  if ! docker ps --format '{{.Names}}' | grep -qx "$NAME"; then
    echo "  Postgres exited during recovery:"; docker logs --tail 40 "$NAME" | sed 's/^/    /'; exit 1
  fi
  if [ "$(date +%s)" -ge "$DEADLINE" ]; then
    echo "  still replaying after 30 minutes:"; docker logs --tail 20 "$NAME" | sed 's/^/    /'; exit 1
  fi
  sleep 2
done
T2=$(date +%s)
echo "  recovered and accepting connections: $((T2 - T1))s"

echo "--- 4. what came back"
ARCHIVE_MODE="$(psqlq 'show archive_mode')"
echo "  archive_mode on the restored copy: ${ARCHIVE_MODE}"
[ "$ARCHIVE_MODE" = "off" ] || { echo "  REFUSING TO CONTINUE: the restored copy has archiving on"; exit 1; }
DB="$(psqlq "select datname from pg_database where datname = 'desiauction'")"
[ "$DB" = "desiauction" ] || { echo "  the desiauction database is NOT in the restored cluster"; exit 1; }
for table in people organizations competitions registrations auctions auction_events bids audit_log; do
  printf '  %-16s %s rows\n' "$table" "$(psqlq "select count(*) from ${table}" desiauction)"
done
NEWEST_ROW="$(psqlq "select coalesce(to_char(max(at) at time zone 'UTC', 'YYYY-MM-DD HH24:MI:SS'), 'none') from audit_log" desiauction)"
NEWEST_AGE="$(psqlq "select coalesce(extract(epoch from now() - max(at))::int::text, '') from audit_log" desiauction)"
echo "  newest audit row: ${NEWEST_ROW} UTC"
MIGRATIONS="$(psqlq 'select count(*) from drizzle.__drizzle_migrations' desiauction)"
echo "  migrations recorded: ${MIGRATIONS}"

echo
echo "RESTORE DRILL PASSED"
echo "  RTO (restore + recovery):  $((T2 - T0))s"
if [ -n "$NEWEST_AGE" ]; then
  echo "  newest restored row is ${NEWEST_AGE}s old. That is the RPO only if something was"
  echo "  written just before this ran; on a quiet database it is simply the last activity."
fi
echo "Record both in docs/operations/RESTORE_RUNBOOK.md (Rehearsal record) with today's date."
