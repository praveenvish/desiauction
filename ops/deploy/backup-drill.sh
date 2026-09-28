#!/usr/bin/env bash
# A REAL restore drill against the off-box pgBackRest repo, run on the host.
#
#   sudo bash backup-drill.sh [production|staging]      (from a checkout's root)
#
# Starts a throwaway Postgres from the same db image with that environment's
# pgbackrest.env, but under its OWN repo path (/pgbackrest/selftest-<ts>), so the
# live stanza is never touched. It archives WAL, takes a full backup, writes a
# row AFTER the backup, destroys the data directory, restores, and prints both
# rows: the second one exists only in WAL, so seeing it is point-in-time
# recovery, not a file copy. Timings are printed for RESTORE_RUNBOOK.
#
# First run 2026-09-29 against S3 Mumbai: full backup 30s, restore+start 30s,
# 5 WAL archived / 0 failed, both rows back — and it found the db image had no
# ca-certificates (every https repo failed TLS verification).
set -euo pipefail
cd "$(dirname "$0")/../.."
ENVF="/srv/apps/desiauction/${1:-production}/pgbackrest.env"
REPO="/pgbackrest/selftest-$(date +%s)"
echo "repo path for this drill: $REPO (production path /pgbackrest/da-prod untouched)"
docker build -q -t da-db-selftest ops/deploy/db >/dev/null && echo "image built"
docker network create pgt-net >/dev/null
run_db() { docker run -d --name pgt-db --network pgt-net --shm-size=256m \
  --env-file "$ENVF" -e PGBACKREST_REPO1_PATH="$REPO" -e POSTGRES_PASSWORD=drill \
  -v pgt-data:/var/lib/postgresql/data -v pgt-sock:/var/run/postgresql \
  -v "$PWD/ops/deploy/postgresql.conf.d":/etc/postgresql/conf.d:ro da-db-selftest >/dev/null; }
wait_db() { for i in $(seq 1 60); do docker exec pgt-db pg_isready -U postgres >/dev/null 2>&1 && return 0; sleep 2; done; docker logs --tail 30 pgt-db; return 1; }
pgb() { docker run --rm --network pgt-net --env-file "$ENVF" -e PGBACKREST_REPO1_PATH="$REPO" \
  -v pgt-data:/var/lib/postgresql/data -v pgt-sock:/var/run/postgresql --user postgres da-db-selftest pgbackrest --stanza=desiauction "$@"; }
psqlq() { docker exec pgt-db psql -U postgres -Atc "$1"; }
cleanup() { docker rm -f pgt-db >/dev/null 2>&1 || true; docker volume rm pgt-data pgt-sock >/dev/null 2>&1 || true; docker network rm pgt-net >/dev/null 2>&1 || true; }
trap cleanup EXIT

run_db; wait_db; sleep 3; wait_db; echo "postgres up (archive_mode=$(psqlq 'show archive_mode'))"
pgb stanza-create >/dev/null && echo "stanza created in the repo"
pgb check >/dev/null && echo "check: WAL archiving to S3 works"
psqlq "create table drill(id int, note text); insert into drill values (1,'in the full backup')" >/dev/null
T0=$(date +%s); pgb backup --type=full >/dev/null; T1=$(date +%s); echo "full backup: $((T1-T0))s"
psqlq "insert into drill values (2,'only in WAL, after the backup'); select pg_switch_wal();" >/dev/null
sleep 8; echo "archived WAL segments: $(psqlq 'select archived_count from pg_stat_archiver'), failed: $(psqlq 'select failed_count from pg_stat_archiver')"
pgb info | grep -E "status|full backup|backup set size|cipher" | sed 's/^ */  /'

echo "--- DISASTER: stop the database and destroy its data"
docker stop -t 30 pgt-db >/dev/null; docker rm pgt-db >/dev/null; docker volume rm pgt-data >/dev/null
docker volume create pgt-data >/dev/null
T2=$(date +%s)
docker run --rm --env-file "$ENVF" -e PGBACKREST_REPO1_PATH="$REPO" -v pgt-data:/var/lib/postgresql/data --user root da-db-selftest \
  bash -c 'chown postgres:postgres /var/lib/postgresql/data && su postgres -c "pgbackrest --stanza=desiauction restore"' >/dev/null
run_db; wait_db; sleep 3; wait_db; T3=$(date +%s)
echo "restore from S3 + start: $((T3-T2))s"
echo "rows after restore:"; psqlq "select id, note from drill order by id" | sed 's/^/  /'
