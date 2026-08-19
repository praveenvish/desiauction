# Disaster Recovery Runbook (PRP-1 §5)

The platform's recovery story is event-sourced by design: Postgres is the
single source of truth; every machine is disposable. Recovery = restore the
database, restart the processes, let replay rebuild everything derived.

## Recovery objectives (docs/61)

- RTO: one hour for full service; minutes for engine-only incidents.
- RPO: PITR window (continuous WAL) — effectively seconds; the daily
  `pg_dump` is the ransomware-isolated floor (35 daily, 12 monthly).

**These are targets, not a measured posture.** PITR, the daily off-site dump and
the retention schedule all live on a managed Postgres instance that is
founder-held and **not yet provisioned** ([PRODUCTION_CHECKLIST](PRODUCTION_CHECKLIST.md)
§2). No restore from a stored backup has ever been performed. Until that
happens, treat the RPO above as the objective the provider must be configured to
meet, and see [docs/62](../62-backup-strategy.md) for the implemented-vs-target
split.

A note the rest of this runbook depends on: **migrations are forward-only** and
there are no down migrations. A schema mistake is undone by a restore to a
recorded restore point or by a corrective forward migration — never by rolling
the image back. The decision procedure is
[DEPLOYMENT §Rollback](DEPLOYMENT.md#rollback).

## Scenarios

### Engine machine lost mid-auction
Restart/replace the machine. On boot the engine replays the auction event log
and re-arms timers — measured 29 ms at 2,500 lots, drilled by the
`demo:operational-recovery` founder scenario (browsers reconverge on the
identical snapshot). No operator action beyond the restart.

### finops-runner lost
Start a new machine. Leases expire, cursors resume, derived job keys absorb
re-fires; killing the runner at any instant loses nothing (ADR-4). Verified
by the SIGTERM boot-smoke (2026-07-16).

### Database corruption / loss
1. Freeze writes: scale engine + runner to zero, hold web deploys.
2. Restore: PITR to the latest sane point, or `pg_restore` of the last daily
   dump into a NEW instance (never splice into the corrupted one — a restore
   is a prefix, finops RUNBOOKS §4).
3. Re-create the runtime roles (they are cluster-level and do not travel with
   logical dumps) — **all four passwords, or the script aborts**:

   ```sh
   psql -v ON_ERROR_STOP=1 \
     -v app_password=… -v system_password=… \
     -v engine_password=… -v runner_password=… \
     -f ops/db/create-app-role.sql
   ```

   The two-variable form previously printed here aborted at the engine-role
   statement (`\set ON_ERROR_STOP on` in the script), so a restore that followed
   this runbook came back up with **no `desiauction_engine` and no
   `desiauction_runner`** — no writer roles, and none of the append-only ledger
   revokes (audit 2026-08-18, P1-3). Getting this wrong here is worse than
   getting it wrong at first deploy: it happens on the worst day.

4. Verify the restored posture, both probes:

   ```sh
   pnpm --filter @desiauction/web grants:verify
   APP_DATABASE_URL=… pnpm --filter @desiauction/web rls:verify
   ```

   `grants:verify` is what catches a role that came back missing a privilege —
   the failure mode that deadlocked the first sale of an auction under the
   drifted recipe (audit P0-1). Re-run both after any migration applied to the
   restored instance.
5. Run the fidelity comparison: `pnpm --filter @desiauction/web db:restore-verify`.
   **Read what this actually proves:** it dumps the database you point it at,
   restores that dump into a scratch database, and compares row counts per table
   (`apps/web/scripts/restore-verify.ts`). It is a dump/restore-lossless check,
   not a backup-restorability check — it never reads a stored backup, replays no
   audit chain and pages nobody. The 43/43 figure was measured 2026-07-16, before
   migrations 0015–0026; the table count has moved since and the drill must be
   re-run.
6. Point the apps at the restored instance, scale engine + runner up.
7. The finops supervisor and settlement meters flag any derived-state gap;
   replay heals projections.
8. If events were lost inside the PITR gap: the event logs are append-only
   with sequence numbers — a gap is unforgeable evidence; follow the
   auction/finops UNHEALABLE-log runbooks rather than hand-editing rows.

### Region loss (Fly `bom` / Vercel)
Engine + runner: `fly deploy` to an alternate region with the same secrets;
latency degrades, correctness does not. Web: platform failover. Database:
managed-provider cross-region replica or restore from the isolated dump
account.

## Standing verification

- Nightly (`.github/workflows/nightly-verify.yml`): fresh migrations, full
  integration + e2e journeys, RLS probe under the production role recipe,
  restore-verify. The RLS step previously passed two of the four role passwords
  and aborted under `ON_ERROR_STOP`, so the four-role recipe was never actually
  exercised by it (audit 2026-08-18, P1-3); it now passes all four. Note also
  that this workflow requires a git remote to run at all, and the repository had
  none at the time of the audit — treat "the nightly covers it" as true only
  once a run exists to point at.
- Quarterly human drill: timed PITR restore to a point mid-simulated-auction
  on staging, evidence recorded (docs/62) — **never executed**; first execution
  is a [PRODUCTION_CHECKLIST](PRODUCTION_CHECKLIST.md) item once staging exists.
