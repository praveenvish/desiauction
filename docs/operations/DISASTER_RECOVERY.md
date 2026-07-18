# Disaster Recovery Runbook (PRP-1 §5)

The platform's recovery story is event-sourced by design: Postgres is the
single source of truth; every machine is disposable. Recovery = restore the
database, restart the processes, let replay rebuild everything derived.

## Recovery objectives (docs/61)

- RTO: one hour for full service; minutes for engine-only incidents.
- RPO: PITR window (continuous WAL) — effectively seconds; the daily
  `pg_dump` is the ransomware-isolated floor (35 daily, 12 monthly).

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
3. Re-run `ops/db/create-app-role.sql` (roles are cluster-level and may not
   travel with logical dumps), then `pnpm --filter @desiauction/web rls:verify`.
4. Run the restore-verify comparison against expectations:
   `pnpm --filter @desiauction/web db:restore-verify` proves dump/restore
   fidelity (snapshot-consistent; drilled 2026-07-16: 43/43 tables exact under
   concurrent writes).
5. Point the apps at the restored instance, scale engine + runner up.
6. The finops supervisor and settlement meters flag any derived-state gap;
   replay heals projections.
7. If events were lost inside the PITR gap: the event logs are append-only
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
  snapshot-consistent restore-verify.
- Quarterly human drill: timed PITR restore to a point mid-simulated-auction
  on staging, evidence recorded (docs/62) — first execution is a
  [PRODUCTION_CHECKLIST](PRODUCTION_CHECKLIST.md) item once staging exists.
