# Deployment Runbook (PRP-1 §2)

Three deployables, one database. Everything below is reproducible from the
repo; founder externals (accounts, credentials, domains) are listed in
[PRODUCTION_CHECKLIST](PRODUCTION_CHECKLIST.md).

## Topology

| Unit | Where | Artifact | Workflow |
|------|-------|----------|----------|
| web | Vercel (Mumbai-first functions) | platform build | Vercel git integration (staging auto, production promote) |
| engine | Fly.io `bom`, 1 machine/env | `apps/engine/Dockerfile` (distroless, non-root, 310 MB) | `.github/workflows/deploy-engine.yml` |
| finops-runner | Fly.io `bom`, 1 machine/env | `apps/finops-runner/Dockerfile` (distroless, non-root, 244 MB) | `.github/workflows/deploy-finops-runner.yml` |
| Postgres 17 | managed (PITR-capable) | `packages/db/migrations` + `apps/engine/drizzle` | migrate on release |
| Object storage | S3-compatible | — | pre-deploy item (freeze §8.4) |

Both Fly workflows: staging auto-deploys on main push (path-filtered),
production is `workflow_dispatch` only, and both no-op with a summary note
until `FLY_API_TOKEN` exists. Images verified locally 2026-07-16: both build
and the runner boots, ticks against Postgres, and exits clean on SIGTERM.

## Database bootstrap (fresh environment)

1. Create the instance (Postgres 17, `bom`/Mumbai). Enable PITR + daily dumps.
2. Run migrations as the owner role:
   `pnpm --filter @desiauction/db db:migrate && pnpm --filter @desiauction/engine db:migrate`
   (journal pitfall: any NEW migration needs its `when` bumped past the
   hand-spaced future dates or drizzle silently skips it).
3. Create runtime roles — **all four passwords, or the script aborts**:

   ```sh
   psql -v ON_ERROR_STOP=1 \
     -v app_password=… -v system_password=… \
     -v engine_password=… -v runner_password=… \
     -f ops/db/create-app-role.sql
   ```

   Creates `desiauction_app` (non-BYPASSRLS; the web tier's default pool),
   `desiauction_system` (BYPASSRLS, least-privilege; invite token paths),
   `desiauction_engine` and `desiauction_runner` (service writers).

   The two-variable form this runbook used to print was **wrong**. The script
   sets `\set ON_ERROR_STOP on`, so a missing `:'engine_password'` aborts it at
   the engine-role statement: the engine and runner roles were never created,
   and neither were the `finops_events` and append-only ledger revokes that
   follow. A DR restore that followed the old command came back up without its
   writer roles (audit 2026-08-18, P1-3).

   RE-RUN this file after any migration that adds a table or a write path. The
   app role now also carries `ALTER DEFAULT PRIVILEGES`, so tables created later
   by the migration role are reachable without a re-run — but the engine and
   runner grants are deliberately enumerated and do not self-extend.

4. Verify the posture, both probes:

   ```sh
   pnpm --filter @desiauction/web grants:verify   # DATABASE_URL, roles must exist
   APP_DATABASE_URL=… pnpm --filter @desiauction/web rls:verify
   ```

   `grants:verify` asserts a declared grant manifest against the real roles and
   exits 1 on drift; it exists because the recipe silently fell twelve
   migrations behind the code and the engine lost `UPDATE` on `registrations` —
   the table every sale writes (audit 2026-08-18, P0-1). `rls:verify` must print
   `RLS VERIFICATION PASSED`. Both now run in CI (`.github/workflows/ci.yml`).

## Environment variables

Per app `env.ts` is the authority (each app refuses to boot on bad env; check
with `pnpm env:check`). Web: `DATABASE_URL` (app role), `SYSTEM_DATABASE_URL`
(system role), `ENGINE_URL`, `ENGINE_PUBLIC_WS_URL`, `ENGINE_SECRET`,
`RP_ID`/`RP_ORIGINS` (WebAuthn — must match the public domain), `SENTRY_DSN`.
Engine: `DATABASE_URL` (writer credential), `ENGINE_SECRET`, `PORT`,
`SENTRY_DSN`. Runner: `DATABASE_URL` (writer credential), `RUNNER_TICK_MS`.

Added after RC-1. **None of these is in `.env.example` yet** (verified
2026-08-19: `grep RAZORPAY .env.example` finds nothing), so this table and
[PRODUCTION_CHECKLIST](PRODUCTION_CHECKLIST.md) §3/§9 are currently the only
place they are written down — adding them to `.env.example` is an open item.
Each app's `env.ts` remains the authority for validation.

| Variable | App | Required | Why |
|---|---|---|---|
| `RAZORPAY_KEY_ID` | web | only if taking payments | Gateway client id. |
| `RAZORPAY_KEY_SECRET` | web | only if taking payments | Gateway secret. |
| `RAZORPAY_WEBHOOK_SECRET` | web | only if taking payments | Keys the HMAC on `/api/webhooks/razorpay`. **Unset ⇒ the route 404s** — fail-closed, like the two SMS webhooks. Set it and payment capture cannot complete; leave it unset and callbacks are refused rather than trusted. Minimum 16 chars (`apps/web/src/env.ts`). |
| `ENGINE_ALLOWED_ORIGINS` | engine | **yes in production** | Comma-separated browser origins allowed to open the spectate WebSocket. A ticket authorises an *auction*, not a *page*, so unset means any origin can open a socket with a scraped ticket. Unset = "do not check", correct only for local dev and native clients. |
| `WS_MAX_SOCKETS_PER_ROOM` | engine | optional (default 2000) | Per-auction socket ceiling; a DoS bound, not a product limit. |
| `WS_MAX_SOCKETS_PER_IP` | engine | optional (default 50) | Per-client-address socket ceiling. |

`ENGINE_SECRET` gained two boot-time rules (`apps/engine/src/env.ts`): it must be
**≥ 32 characters in production**, and the repo's `dev-engine-secret` default is
**refused outside `development`/`test`** — a staging box is on the internet too,
and the default is written down in this repository. 32 is the width of the HMAC
these secrets key, so anything shorter weakens the spectate ticket, not just the
header.

## Pre-deploy checklist

Run in order; any failure stops the deploy.

1. `pnpm preflight:production` with the production env — a FAIL means do not deploy.
2. **Does this release ship a migration?** `git diff --name-only <deployed-sha>..HEAD -- packages/db/migrations apps/engine/drizzle`. The answer decides the whole rollback plan below, so establish it *before* deploying, not during the incident.
3. **Record the restore point.** Write down the PITR timestamp (or take the labelled dump) taken immediately before the migration step, and put it in the deploy note alongside the currently-deployed image id. Migrations are forward-only; this timestamp is the only thing that can undo one. A deploy with a migration and no recorded restore point has no rollback path at all.
4. `pnpm --filter @desiauction/web grants:verify` against the target database if the release adds a table or a write path.
5. Confirm no auction is LIVE (C-22).

## Release order

1. engine (staging auto → smoke `/healthz` → production dispatch)
2. finops-runner (same shape; smoke = machines `started`)
3. web (platform promote; instant rollback to previous immutable build)

Never deploy the engine during a live auction window: the engine recovers all
state from the event log (measured 29 ms replay at 2,500 lots), but spectator
sockets drop and reconnect. The C-22 live-window check lands with IP-7.

## Rollback

**Migrations are forward-only.** There are no down migrations in
`packages/db/migrations` and there never have been — `docs/auction/RUNBOOKS.md`
§10 says so, and it is the correct document. Release documentation written at
RC-1 claimed rollback was "a pure app-image swap with no schema step"; that was
true of PX-2…PX-11 and stopped being true immediately afterwards, when
migrations 0015–0026 shipped — `0019_tournaments.sql` renames `seasons` →
`tournaments` and **drops** `year` (audit 2026-08-18, P1-2). Rolling the image
back does not undo any of that.

So the operator's first question is never "how do I roll back", it is **"did
this release ship a migration?"** (pre-deploy checklist item 2).

### Decision procedure

1. **No migration in this release** → roll the image back and stop.
   - web: platform instant rollback.
   - engine/runner: `flyctl releases rollback --app <app>`. State lives in
     Postgres, not the machine.
   - This is the safe, boring case, and most releases are it.

2. **The release shipped a migration** → an image rollback is only safe if the
   previous image can still run against the new schema. That is true when the
   migration was written **expand/contract**: expand (add the new column/table,
   backfill, dual-write) ships and deploys *before* the code that needs it, and
   contract (drop the old column, rename, add the NOT NULL) ships in a *later*
   release, after the previous image is no longer a rollback target. If the
   release you are rolling back is an expand-only one, roll the image back
   normally — the extra schema is inert to the old code.

3. **The migration was destructive** (a rename, a drop, a narrowing constraint —
   `0019_tournaments.sql` is the worked example) → there is no image rollback.
   The old image will fault on the first query against the renamed or dropped
   object. The plan is **restore to the pre-deploy restore point** recorded in
   the deploy note, per
   [DISASTER_RECOVERY](DISASTER_RECOVERY.md) — a restore is a prefix, never a
   splice (finops RUNBOOKS §4), so everything written after that point is lost
   and must be re-established from the event logs where it can be.
   Rolling *forward* with a corrective migration is usually faster and is the
   preferred answer whenever the defect is not corrupting data.

### The honest state of option 3

The restore point that option 3 depends on is **founder-held and not yet
provisioned**: there is no managed Postgres, no PITR window and no off-site dump
in existence at the time of writing ([PRODUCTION_CHECKLIST](PRODUCTION_CHECKLIST.md)
§2). `pnpm --filter @desiauction/web db:restore-verify` proves that
`pg_dump` → `pg_restore` is row-count-lossless on a locally dumped database; it
has never restored a stored backup, and no drill has been run against a real
backup. Until that is provisioned and drilled, a release containing a
destructive migration has **no proven rollback path** and should not be deployed
into a live beta window.
