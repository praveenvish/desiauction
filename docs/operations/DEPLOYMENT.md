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
3. Create runtime roles: `psql -v app_password=… -v system_password=… -f ops/db/create-app-role.sql`
   — creates `desiauction_app` (non-BYPASSRLS; the web tier's default pool)
   and `desiauction_system` (BYPASSRLS, least-privilege; invite token paths).
   RE-RUN this file after any future migration (grants are static).
4. Verify the posture: `APP_DATABASE_URL=… pnpm --filter @desiauction/web rls:verify`
   must print `RLS VERIFICATION PASSED`.

## Environment variables

Per app `env.ts` is the authority (each app refuses to boot on bad env; check
with `pnpm env:check`). Web: `DATABASE_URL` (app role), `SYSTEM_DATABASE_URL`
(system role), `ENGINE_URL`, `ENGINE_PUBLIC_WS_URL`, `ENGINE_SECRET`,
`RP_ID`/`RP_ORIGINS` (WebAuthn — must match the public domain), `SENTRY_DSN`.
Engine: `DATABASE_URL` (writer credential), `ENGINE_SECRET`, `PORT`,
`SENTRY_DSN`. Runner: `DATABASE_URL` (writer credential), `RUNNER_TICK_MS`.

## Release order

1. engine (staging auto → smoke `/healthz` → production dispatch)
2. finops-runner (same shape; smoke = machines `started`)
3. web (platform promote; instant rollback to previous immutable build)

Never deploy the engine during a live auction window: the engine recovers all
state from the event log (measured 29 ms replay at 2,500 lots), but spectator
sockets drop and reconnect. The C-22 live-window check lands with IP-7.

## Rollback

- web: platform instant rollback.
- engine/runner: `flyctl releases rollback --app <app>`; state lives in
  Postgres, not the machine — a rollback is always safe.
- database: PITR restore per [DISASTER_RECOVERY](DISASTER_RECOVERY.md);
  a restore is a prefix, never a splice (finops RUNBOOKS §4).
