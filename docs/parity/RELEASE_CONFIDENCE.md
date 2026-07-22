# Release Confidence Index — `feat/parity-superiority`

> Living certification ledger for the parity programme. Updated per iteration.
> **Static analysis passing is NOT production-ready.** Verification levels are
> explicit and never inflated.

## Verification taxonomy

| Level | Meaning |
|---|---|
| **SOURCE VERIFIED** | Compiles + lints + type-checks; logic read and reviewed. No execution. |
| **EXECUTION VERIFIED** | The code path actually ran green in a unit test in this environment. |
| **RUNTIME VERIFIED** | Exercised against real dependencies (Postgres/RLS roles, migrations, build). |
| **PRODUCTION VERIFIED** | Validated in a production-like deploy. **Only the Release Authority may declare this.** |

## Environment — RUNTIME unblocked (2026-07-22)

Docker's image store was corrupted (`input/output error`; needs a GUI reset).
**Bypassed** by running the migrations + suite + build against a native
Homebrew **PostgreSQL 17** on `localhost:5432`, with the production four-role
recipe (`ops/db/create-app-role.sql`) applied. Dev/test `DATABASE_URL` uses a
BYPASSRLS role (the documented dev posture — "RLS inert at runtime, isolation is
app-layer"); production flips to `desiauction_app` (NOBYPASSRLS).

## Subsystem ledger

| Subsystem | Level | Evidence |
|---|---|---|
| core: media validators / key bind (S1/S2) · player-profile · CSV | **EXECUTION** | core suite 168 |
| showcase: filter/sort/squads/params/csv · upload orchestration | **EXECUTION** | web unit 15 |
| ui: ImageUploader | **EXECUTION** | `packages/ui` (jsdom) 67 |
| **migrations `0000`–`0018` apply** | **RUNTIME** ✅ | `drizzle-kit migrate` green on PG17; new columns present |
| **media write path (actions/authz/route, S1/S2/S3 audit, PR1 withdrawal)** | **RUNTIME** ✅ | `media.regression.test.ts` 5/5 on real Postgres |
| **competition / registration / fixtures / settlement / finops / admin RLS** | **RUNTIME** ✅ | full web suite 453/453 |
| **public showcase read model · self-photo actions** | **RUNTIME** ✅ | covered by the passing suite + build |
| **production build** | **RUNTIME** ✅ | `next build` exit 0 — "Compiled successfully"; all routes emitted |
| preflight guard (D1) | **EXECUTION** | ran in 3 env configs |
| ShowcaseGrid UI wiring (filters/dialog/CSV/URL sync) · Blob download | **SOURCE** | no jsdom env in `apps/web`; pure cores are EXECUTION; interaction verifies via e2e/browser |

## Release Confidence Index (summary)

- **Static** (typecheck 11/11 · lint · no schema drift): ✅
- **Unit/EXECUTION** (pure cores): ✅ core 168 · ui 67 · web unit 15
- **Integration/RUNTIME**: ✅ **453/453** web tests on real Postgres 17
- **Migration apply**: ✅ RUNTIME (all 19 migrations)
- **Build**: ✅ RUNTIME (`next build` clean)
- **a11y / perf / security-review**: partial (per-feature review; no automated a11y/perf gate)

**Overall: SOURCE + EXECUTION + RUNTIME all green. PRODUCTION VERIFIED pending
an independent Release Authority on a production-like deploy.**

## Evidence backlog (ranked)

1. ~~RUNTIME: migrations + suite + build~~ — **DONE** (native PG17).
2. **e2e:** upload flows + showcase browse/export in a real browser (Playwright).
3. **UI integration tests:** add a jsdom env + `@testing-library/react` to
   `apps/web`, cover ShowcaseGrid interactions (dep decision).
4. **a11y gate:** axe over `/c/[slug]`.
5. **perf baseline:** showcase render at 1k / 10k players.

## To reproduce the RUNTIME run

```
brew services start postgresql@17
PG=/opt/homebrew/opt/postgresql@17/bin
"$PG/psql" -d postgres -c "create role desiauction login superuser password 'desiauction'"
"$PG/psql" -d postgres -c "create database desiauction owner desiauction"
DATABASE_URL=postgres://desiauction:desiauction@localhost:5432/desiauction \
  pnpm --filter @desiauction/db db:migrate
"$PG/psql" -d desiauction -v app_password=local-app -v system_password=local-system \
  -v engine_password=local-engine -v runner_password=local-runner -f ops/db/create-app-role.sql
DATABASE_URL=postgres://desiauction:desiauction@localhost:5432/desiauction \
  SYSTEM_DATABASE_URL=postgres://desiauction_system:local-system@localhost:5432/desiauction \
  pnpm --filter @desiauction/web test:integration
# build: same env + pnpm --filter @desiauction/web build
```
