# Local Setup

Zero to a fully working platform in under 10 minutes.

## Prerequisites

- Docker (Desktop or daemon) running
- Node ≥ 24 (see `.node-version`)
- pnpm 10 (`corepack enable`)

## Install and start

```sh
git clone <repo> && cd desiauction-next
pnpm install
pnpm setup:local   # infra → env → migrations → RLS roles → demo data → checks
pnpm dev           # web :3000 · auction engine :4000 · finops runner
```

`setup:local` is idempotent — re-run it any time. It never overwrites an
existing `.env.local`.

## What setup:local does

1. Verifies docker/node/pnpm and fails with a fix hint if anything is missing.
2. Generates `.env.local` with local, non-secret defaults (validated
   fail-closed by each app's `env.ts`; `pnpm env:check` re-validates).
3. `docker compose up -d` (Postgres 17 on :5433, MinIO on :9000/:9001) and
   waits until Postgres is healthy.
4. Applies all migrations, then the four-role recipe
   (`ops/db/create-app-role.sql`: app/system/engine/runner — the same roles
   production uses).
5. Seeds repeatable demo data (`pnpm seed:demo`, see below).
6. Runs `pnpm env:check` and an infrastructure health check.

## Services

| Service | URL | Notes |
|---------|-----|-------|
| Web | http://localhost:3000 | Next.js dev server |
| OTP inbox | http://localhost:3000/dev/inbox | Dev-only; 404s in production builds |
| Auction engine | http://localhost:4000/healthz | HTTP commands + WebSocket snapshots |
| FinOps runner | (no port) | `pnpm health` checks the process |
| Postgres | localhost:5433 | `desiauction`/`desiauction` |
| MinIO console | http://localhost:9001 | `desiauction`/`desiauction` |
| Redis | — | The platform has no Redis dependency by design |

## Demo credentials

Sign in at `/login` with a phone number; the 6-digit code appears at
`/dev/inbox` (development OTP delivery — no SMS account needed).

| Role | Phone | Capabilities |
|------|-------|--------------|
| Founder | 9999000001 | org:owner + settlement:controller + finops:controller |
| Admin | 9999000002 | org:owner |
| Organizer | 9999000003 | org:staff |
| Bidder A | 9999000004 | viewer (claims a paddle via owner invite) |
| Bidder B | 9999000005 | viewer (claims a paddle via owner invite) |
| Bidder C | 9999000006 | viewer (claims a paddle via owner invite) |
| Viewer | 9999000007 | viewer |

Demo org `/org/demo-club` · playground competition
`/competitions/demo-premier-league` (registration open, 10 approved + 2
submitted players, 4 teams) · settled exemplar
`/competitions/demo-cup-settled` (completed auction, settled case, receipts,
invoices, dispatch, export, sealed fiscal period).

## Everyday commands

| Command | Purpose |
|---------|---------|
| `pnpm dev` | Start web + engine + runner (with watch) |
| `pnpm health` | PASS/FAIL for db, storage, web, engine, runner |
| `pnpm seed:demo` | Reset demo data (repeatable, no duplicates) |
| `pnpm verify:local` | Full local gate: lint, types, unit, format, boundaries, build, integration (incl. replay/recovery certification), env, infra health |
| `pnpm test:integration` | Integration suites only |

Next: [LOCAL_TESTING](LOCAL_TESTING.md) walks the full journey;
[TROUBLESHOOTING](TROUBLESHOOTING.md) covers resets and common failures.
