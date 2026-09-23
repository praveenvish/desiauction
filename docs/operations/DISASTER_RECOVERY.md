# Disaster Recovery Runbook (PRP-1 §5)

The platform's recovery story is event-sourced by design: Postgres is the
single source of truth; every machine is disposable. Recovery = restore the
database, restart the processes, let replay rebuild everything derived.

## Recovery objectives (docs/61), for the self-hosted stack

| Failure | RPO target | RTO target | Mechanism |
|---|---|---|---|
| Bad migration / bad write | seconds (last archived WAL segment) | 1 h | pgBackRest PITR to a timestamp ([RESTORE_RUNBOOK](RESTORE_RUNBOOK.md) "Point-in-time restore") |
| Host lost, disk intact elsewhere | seconds–minutes (WAL in the off-box repo) | 4 h | new host + compose + PITR from the off-box repo |
| Host AND on-box data lost | as above for Postgres; ≤ 1 h for photos and finops artifacts (mirror interval) | 4 h | off-box repo + `minio-mirror` copy |
| Engine process only | none (event-sourced) | minutes | restart; replay |

The WAL RPO holds only while archiving keeps up: a segment is pushed when it
fills (16 MB) or on `archive_timeout`, which is unset, so on a quiet database
the newest unarchived writes can be older than "seconds". Set
`archive_timeout = 60` in `postgresql.conf.d` if a one-minute bound matters
more than a few extra segments a day.

**These are targets, not a measured posture.** What exists as of 2026-09-23:
the archive, the nightly backups, the object-storage mirror and the alerts on
all three are automated in `ops/deploy/`. What does NOT exist yet is the place
they write to: the off-box buckets are founder-held
([PRODUCTION_CHECKLIST](PRODUCTION_CHECKLIST.md) §2), and until they are
configured the pgBackRest sidecar refuses to run (unless the on-box interim is
accepted in writing) and the mirror refuses outright. The one PITR restore ever
performed was against the ON-box repo (ops/deploy/README "What was verified").
Record the first off-box drill's RTO in RESTORE_RUNBOOK before quoting any
number above as a capability.

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

Measured as a whole process on 2026-09-18 (final readiness audit, Phase 11):
`kill -9` of a production-built engine, restart, `/healthz` 200 in **1.07–1.68 s**
across five runs (median ≈ 1.1 s). That covers node start, the database
connection, re-taking the single-writer lease and rehydrating every live or
paused auction before the listener opens, and each boot rehydrated **97**
in-flight auctions (local test residue). A real night has a handful, so this
is pessimistic. Clients then reconnect on full-jitter backoff from 100 ms. A
developer laptop is not the production host, so treat these as an order of
magnitude and not an SLO.

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

### Host or region loss
Provision a new host (any provider — the stack is one compose file), copy the
env files from the founder's secret store, point the three DNS records at it,
restore Postgres from the OFF-BOX pgBackRest repo (RESTORE_RUNBOOK
"Point-in-time restore"), `mc mirror` the two buckets back from the off-box copy
into the new MinIO, then run `deploy-host.yml` for the last good commit.
Latency may degrade; correctness does not.

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
