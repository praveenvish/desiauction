# Troubleshooting — Local Environment

Every reset below is safe: the platform's truth lives in the event logs, demo
data is fully regenerable, and nothing here touches production.

## Quick diagnosis

```sh
pnpm health        # PASS/FAIL per dependency
pnpm env:check     # each app validates its environment fail-closed
docker compose ps  # infra containers
```

## Common failures

| Symptom | Cause | Fix |
|---------|-------|-----|
| `web refused to start — invalid environment` | Missing/typo'd var in `.env.local` | The message names the exact variable; compare with the template in `scripts/setup-local.mjs` |
| Ports 3000/4000 already in use | Stale dev processes | `lsof -tnP -iTCP:3000 -iTCP:4000 -sTCP:LISTEN \| xargs kill`, then `pnpm dev` |
| `pg_isready` FAIL / port 5433 refused | Docker not running or container stopped | `docker compose up -d`; if it loops, `docker compose logs db` |
| Login code never appears in `/dev/inbox` | Per-phone OTP cap (5/hour) or resend cooldown | Wait, or use another demo phone; the cap is a real production guard, not a bug |
| `new row violates row-level security` | Running production-posture mode and hitting an unwired path | Expected fail-closed behavior; check which action it was and compare with the wiring pattern in `apps/web/src/server/orgs/actions.ts` |
| Integration test fails on `people_phone_unique` | Residue collision with time-derived seed phones | Rerun once; the durable fix pattern is documented in the PVP-1 report (defect S1) |
| Engine 401s on every command | `ENGINE_SECRET` mismatch between web and engine | Both read the same `.env.local`; restart both after changing it |
| Auction pages empty after reseeding | Demo org was rebuilt with new ids while a page kept old state | Hard-refresh; sessions survive reseeds but old object ids do not |
| `drizzle` says nothing to migrate after adding a migration | Journal `when` timestamps are hand-spaced future dates | Bump the new entry's `when` beyond the last one (see packages/db/migrations/meta/_journal.json) |

## Resets

### Demo data (most common — seconds)

```sh
pnpm seed:demo
```

Deletes the demo org's rows and rebuilds everything (no duplicates); demo
people are upserted by phone so live sessions survive.

### Database (full — ~1 minute)

```sh
docker compose down db && docker volume rm desiauction-next_pgdata
pnpm setup:local
```

Everything is rebuilt: schema, roles, demo data. Your own manually created
orgs are gone — that is the point of this reset.

### MinIO / object storage

```sh
docker compose down storage && docker volume rm desiauction-next_miniodata
docker compose up -d
```

Local finops export artifacts live on the filesystem instead:
`rm -rf .local/finops-artifacts` (regenerate by requesting a new export).

### Redis

Nothing to reset — the platform has no Redis dependency by design.

### OTP throttling (heavy e2e use)

The per-phone cap (5/hour) and resend cooldown are real production guards.
For a clean slate on the DEV database only:

```sh
pnpm seed:demo   # demo phones keep their identities; codes are per-phone rows
```

or wait out the hour window.

### Everything, from orbit

```sh
docker compose down -v && rm -rf .local && pnpm setup:local && pnpm dev
```

## Where evidence lives when something is truly wrong

- Engine replay/divergence: cockpit → verify replay, or the certification
  suite (`pnpm --filter @desiauction/engine test:integration`).
- Settlement truth: the journal event stream (`settlement_events`,
  `journal_*` projections rebuild from it — never edit projections).
- FinOps: `superviseOperations` (surfaced on the finops pages) names the
  unhealthy component; the runner log prints every tick failure.
- The audit log is append-only and RLS-guarded; a gap in an event stream's
  sequence numbers is unforgeable evidence of loss — see the domain
  RUNBOOKS before touching anything.
