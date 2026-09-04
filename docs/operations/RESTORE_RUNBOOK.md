# Restore Runbook

> Operational procedure for recovering the DesiAuction database from a logical
> backup. Pairs with `scripts/backup-database.mjs` (the dump) and
> `docs/62-backup-strategy.md` (the strategy and what is still operator-provisioned).

A backup you have never restored is a hope, not a backup. Rehearse this against
a scratch instance **before** launch and record the wall-clock RTO at the bottom.

`node scripts/restore-drill.mjs --rehearse` walks steps 2–6 below against a
scratch database, times each one, and then conducts a **whole auction night** on
the restored copy under the four production roles. Steps 1 and 7 are absent by
design: stopping writers and cutting production over are decisions about live
traffic, not commands.

## What a backup is here

`pnpm backup` runs `pg_dump -Fc --no-owner --no-acl` and writes a compressed,
`pg_restore`-selectable dump to `BACKUP_DIR`. In production `BACKUP_DIR` MUST be a
durable, **off-host** destination (a mounted object-store bucket, or a separate
account's disk) and `BACKUP_DATABASE_URL` SHOULD be a distinct read/backup role,
so a compromise of the app host cannot also destroy the backups.

This is the daily logical-dump layer. Point-in-time recovery (continuous WAL) is
a managed-Postgres feature and remains an operator provisioning item — see
`docs/62-backup-strategy.md`.

## Restore procedure

1. **Stop writers.** Take the web app and the finops runner out of rotation so
   nothing writes during the restore. The engine holds no durable truth beyond
   the DB, so stopping it too is safe.

2. **Provision a clean target.** A fresh, empty Postgres 17 database. Never
   restore over a live database — restore into a new one and cut over.

   ```bash
   createdb -h "$TARGET_HOST" -U "$TARGET_ADMIN" desiauction_restore
   ```

3. **Restore the dump.** `--no-owner --no-acl` means it restores under whatever
   role you connect as; grants are re-applied separately in step 5.

   ```bash
   pg_restore -h "$TARGET_HOST" -U "$TARGET_ADMIN" \
     -d desiauction_restore --no-owner --no-acl --exit-on-error \
     desiauction-<timestamp>.dump
   ```

4. **Re-apply any migrations newer than the dump.** A dump captures the schema
   at backup time. If code has since advanced, run the migrations against the
   restored database before serving:

   ```bash
   DATABASE_URL=postgres://.../desiauction_restore \
     pnpm --filter @desiauction/db db:migrate
   ```

5. **Re-create the four production roles + grants.** The dump carries data and
   schema, not the role model — `pg_dump --no-owner --no-acl` drops every grant
   deliberately, so a freshly restored database has all the data and **zero**
   privileges. Note the asymmetry that decides how much of this you need: roles
   are cluster-scoped, grants are database-scoped. Restoring into the same
   cluster needs only the grants re-applied; restoring into a NEW cluster needs
   the roles created first. The recipe is idempotent and does both.

   ```bash
   psql "$TARGET_ADMIN_URL" -v ON_ERROR_STOP=1 \
     -v app_password=... -v system_password=... \
     -v engine_password=... -v runner_password=... \
     -f ops/db/create-app-role.sql
   DATABASE_URL=postgres://.../desiauction_restore \
     pnpm --filter @desiauction/web grants:verify
   ```

6. **Verify isolation is live, then verify the database can run an auction.**
   Confirm the app role is NOBYPASSRLS (the web tier asserts this at boot, PRR
   P1-1) and RLS holds:

   ```bash
   APP_DATABASE_URL=postgres://desiauction_app:...@.../desiauction_restore \
     pnpm --filter @desiauction/web rls:verify
   ```

   Then run a night on it. Row counts prove the bytes arrived; they cannot tell
   you the restored database is *usable*, and the difference between those two
   is precisely a missing grant:

   ```bash
   REHEARSAL_DB_NAME=desiauction_restore \
     pnpm --filter @desiauction/web rehearsal
   ```

7. **Point production at the restored database and return writers to rotation.**
   Watch `/readyz`, Sentry, and engine command latency on the first live action.

## Rollback of the restore

If the restore is bad, the source dump and the original (damaged) database are
both untouched — this procedure never mutates them. Provision another clean
target and start again from step 2.

## Rehearsal record

| Date | Source size | Target | Restore time (steps 2–6) | Result | By |
|------|-------------|--------|--------------------------|--------|----|
| 2026-09-05 | 25 MB / 4,968 rows / 60 tables | local scratch DB, same cluster | 1.8 s | PASS — counts identical, and a full auction night ran on the restored copy through all four roles to two issued receipts | PA-1R Phase 8.4 |
| _pending — repeat against managed Postgres before launch_ | | | | | |

**Read that 1.8 s correctly.** It is not a production RTO and must not be quoted
as one: the database is 25 MB and the cluster is on the same machine. What the
drill certifies is that the **procedure is complete** — that nothing has to be
discovered during an incident. The production number will be dominated by dump
transfer and `pg_restore`, both of which scale with data, and by steps 1 and 7,
which are human decisions this drill deliberately excludes.

The first two runs of the drill failed, and both failures were in the drill
rather than the platform — but they are worth recording, because they are the
exact shape of the thing a drill exists to find. `docker exec` does not attach
stdin unless asked, and `execFileSync` discards `input` when stdin is `"ignore"`.
Between them, the step that re-applies the role recipe reported success in 0.1 s
having executed **nothing**, and the failure surfaced two steps later as "the app
role cannot read `otp_codes`". A restore that silently skips step 5 leaves a
database holding every row and no privileges — which is why step 6 now ends with
an auction night rather than a row count.
