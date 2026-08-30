# Restore Runbook

> Operational procedure for recovering the DesiAuction database from a logical
> backup. Pairs with `scripts/backup-database.mjs` (the dump) and
> `docs/62-backup-strategy.md` (the strategy and what is still operator-provisioned).

A backup you have never restored is a hope, not a backup. Rehearse this against
a scratch instance **before** launch and record the wall-clock RTO at the bottom.

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
   schema, not the role model. Re-run the role recipe and the grant manifest:

   ```bash
   psql "$TARGET_ADMIN_URL" -v ON_ERROR_STOP=1 \
     -v app_password=... -v system_password=... \
     -v engine_password=... -v runner_password=... \
     -f ops/db/create-app-role.sql
   DATABASE_URL=postgres://.../desiauction_restore \
     pnpm --filter @desiauction/web grants:verify
   ```

6. **Verify isolation is live.** Confirm the app role is NOBYPASSRLS (the web
   tier asserts this at boot, PRR P1-1) and RLS holds:

   ```bash
   APP_DATABASE_URL=postgres://desiauction_app:...@.../desiauction_restore \
     pnpm --filter @desiauction/web rls:verify
   ```

7. **Point production at the restored database and return writers to rotation.**
   Watch `/readyz`, Sentry, and engine command latency on the first live action.

## Rollback of the restore

If the restore is bad, the source dump and the original (damaged) database are
both untouched — this procedure never mutates them. Provision another clean
target and start again from step 2.

## Rehearsal record

| Date | Dump age | Target | RTO (stop → serving) | Result | By |
|------|----------|--------|----------------------|--------|----|
| _pending — rehearse before launch_ | | | | | |
