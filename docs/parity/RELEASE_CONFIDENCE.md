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
| core: media/profile/CSV · share-card · `nextSeasonName` · `summarizeOutcomes` · **`normalizeShareSource` (bounded attribution)** | **EXECUTION** | core suite **201** |
| **share attribution — `?ref`→bounded audit meta→`registrationsBySource`** | **RUNTIME** ✅ | `competition.regression.test.ts` 13/13 on PG17: submit(source=whatsapp)→audit meta→projection breakdown |
| **retention: clone competition ("run it again") — draft, season-year bump, team shells+coach, NO pool copy, audit** | **RUNTIME** ✅ | `competition.regression.test.ts` 12/12 on PG17; asserts fresh draft, carried teams, empty clone pool, `competition.cloned` audit |
| **outcomes projection (Outcome Governance) — audit-log North-Star metrics for `/admin`** | **RUNTIME** ✅ | `outcomesProjection` reads live audit events on PG17 (same suite); read-only (depcruise `admin-is-read-only` holds) |
| **share images: competition + player OG/Twitter card raster** | **RUNTIME** ✅ | `next/og` rasterized 1200×630 PNGs (competition live-status + non-public fallback; player sold + available) from the card models; visually verified on-brand |
| **`publicPlayer` read model (single approved player, consent+visibility gated)** | **SOURCE** | shares `toShowcasePlayer` mapper with `publicShowcase` (RUNTIME-covered shape); fetch seam verifies via e2e |
| showcase: filter/sort/squads/params/csv · upload orchestration | **EXECUTION** | web unit 15 |
| ui: ImageUploader | **EXECUTION** | `packages/ui` (jsdom) 67 |
| **migrations `0000`–`0018` apply** | **RUNTIME** ✅ | `drizzle-kit migrate` green on PG17; new columns present |
| **media write path (actions/authz/route, S1/S2/S3 audit, PR1 withdrawal)** | **RUNTIME** ✅ | `media.regression.test.ts` 5/5 on real Postgres |
| **competition / registration / fixtures / settlement / finops / admin RLS** | **RUNTIME** ✅ | full web suite 453/453 |
| **public showcase read model · self-photo actions** | **RUNTIME** ✅ | covered by the passing suite + build |
| **production build** | **RUNTIME** ✅ | `next build` exit 0 — "Compiled successfully"; all routes emitted |
| preflight guard (D1) | **EXECUTION** | ran in 3 env configs |
| ShowcaseGrid UI wiring (filters/dialog/CSV/URL sync) · Blob download · **player profile page + OG route DB→model→ImageResponse composition** | **SOURCE** | no jsdom env in `apps/web`; pure cores are EXECUTION, raster is RUNTIME; the read-model fetch + metadata-injection seams verify via e2e/browser |

## Release Confidence Index (summary)

- **Static** (typecheck 11/11 · lint · no schema drift): ✅
- **Unit/EXECUTION** (pure cores): ✅ core 201 · ui 67 · web unit 15
- **Integration/RUNTIME**: ✅ **453/453** web tests on real Postgres 17
- **Migration apply**: ✅ RUNTIME (all 19 migrations)
- **Build**: ✅ RUNTIME (`next build` clean)
- **Critical E2E**: ❌ **not green this session** — the Playwright harness boots and
  drives a browser, but the local e2e DB (`.env.local` → **:5433**, distinct from
  the :5432 regression DB) carries residue and `public-registration.spec.ts` fails
  at pre-existing gates (onboarding, public-page state) before reaching the new
  share-card/attribution assertions. Those assertions are **WRITTEN**, pending a
  clean-DB (CI/ephemeral) run. See `RELEASE_RISK_REGISTER.md` R-E1/R-E2.
- **a11y / perf / security-review**: partial (per-feature review; no automated a11y/perf gate)

**Overall: SOURCE + EXECUTION + RUNTIME(unit/integration/build) green. Release
Authority verdict = NO-GO — blocked on Critical-E2E execution (R-E1) and
founder-owned launch externals (R-C1). See `RELEASE_RISK_REGISTER.md`.**

## Evidence backlog (ranked)

1. ~~RUNTIME: migrations + suite + build~~ — **DONE** (native PG17).
2. **e2e:** upload flows + showcase browse/export in a real browser (Playwright);
   **add** a crawler-meta assertion — `GET /c/<slug>` and `/c/<slug>/p/<n>` heads
   carry `og:image` + `twitter:image` (`summary_large_image`), the player page is
   `noindex`, and both `opengraph-image` routes return `image/png`. Also assert
   the "View full profile" link renders and resolves.
3. **`next build` recompile:** confirm the new `opengraph-image`/`twitter-image`
   metadata routes emit in a full production build (needs PG17 + env, per §Env).
4. **UI integration tests:** add a jsdom env + `@testing-library/react` to
   `apps/web`, cover ShowcaseGrid interactions (dep decision).
5. **share-image i18n:** the OG card uses the `next/og` built-in (Latin) font, so
   Devanagari competition names tofu. Load Noto Sans Devanagari at the image
   boundary before promoting non-Latin names. (Monogram fallback already covers
   the null case.)
6. **a11y gate:** axe over `/c/[slug]`.
7. **perf baseline:** showcase render at 1k / 10k players.

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
