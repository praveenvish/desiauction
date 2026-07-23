# Release Risk Register — `feat/parity-superiority`

> Release Authority artifact (charter v6.0). Every risk records area, likelihood,
> severity, mitigation, verification status, and whether it blocks GO. Evidence is
> never inflated: "verified" means executed, not merely written.
> Owner defaults to the Release Authority (this role) unless external.

## Status legend
`RUNTIME` executed green on real deps · `EXECUTION` unit-green · `WRITTEN` code exists, not executed green here · `NONE` not started.

## Register

| # | Area | Risk | Cust. impact | Likelihood | Severity | Mitigation | Verification | Blocks GO |
|---|---|---|---|---|---|---|---|---|
| R-E1 | **E2E — critical journeys** | Was blocked by a corrupted Docker Desktop VM (`read-only file system`); **RESOLVED** by a full Docker restart (quit incl. `com.docker.backend`, relaunch) → `pnpm setup:local` green (compose + migrate + RLS roles + seed; `HEALTH: PASS`). The publish→discover→register critical journey now runs green (`public-registration.spec.ts`: **4 passed, 1 flaky**). Root cause was Docker, NOT test residue (earlier hypothesis corrected). | High (core flows) | Low (env restored) | High | Environment restored + reproducible via one command. `setup:local` now self-diagnoses the corruption (hardened). **Remaining:** run the full 70-test suite for complete LOCAL GO. | `RUNTIME` (public-registration journey green) / full suite pending | Partial — run full suite |
| R-E2 | E2E — share surfaces | og:image + twitter `summary_large_image` + `/opengraph-image`→image/png + `?ref`→register-CTA assertions in `public-registration.spec.ts`. | Medium | Low | Medium | — | **RUNTIME** ✅ (passed in "organizer publishes" against clean :5433) | **No** |
| R-E3 | E2E — determinism | `public-registration` "player journey" is **flaky** — fails intermittently at `context.close()` teardown in the `inSecondBrowser` helper (passes on the configured 1 retry). Pre-existing; not an assertion failure. | Low | Medium | Low | Await the second-browser context's navigations before `context.close()`, or `page.close()` first. | `RUNTIME` (flake observed) | No |
| R-A1 | Accessibility | `@axe-core/playwright` is wired into specs, but no automated a11y gate ran this session; no axe pass over `/c/[slug]`, `/c/[slug]/p/[n]`, `/admin`. | Medium | Medium | Medium | Add an axe gate to the share/register/admin specs; run in CI. | `NONE` (this session) | No (not a hard gate yet) |
| R-P1 | Performance | No perf baseline for the showcase/board at scale (300–1k+ players); public pages are SSR + revalidate but unmeasured. | Medium | Low | Medium | Bench the showcase render + paginate/virtualize if needed. | `NONE` | No |
| R-S1 | Security | Recent reviews done (media authz/traversal, JSON-LD XSS, open-redirect `safeNext`, `?ref` allowlist-bounding). No full external pen-test. | High if breached | Low | High | Continue per-feature review; external review pre-GA. | `EXECUTION` (per-feature) | No |
| R-M1 | Metadata / SEO | OG/Twitter cards + noindex on player pages are correct (raster RUNTIME-verified; meta injection via Next file convention). E2E head-assertion pending (R-E2). | Low | Low | Low | R-E2. | `RUNTIME` (raster) / `WRITTEN` (head) | No |
| R-D1 | Migration / rollback | This branch added **migration `0019_tournaments`** (2026-07-23) — the schema-free rollback posture no longer holds and a rollback now needs a down-path or a restore. `0019` renames `seasons`→`tournaments`, drops `year`, adds a unique `slug`, and renames `competitions.season_id`→`tournament_id`; it renames rather than drops, so the RLS policy and tenant index carry over (verified post-apply: `tournaments_tenant` retains both USING and WITH CHECK). Migrations `0000–0019` apply green on PG17 from empty. | High if wrong | Low | High | Write the `0019` down-path (or accept restore-from-backup) and run the rollback drill before release. | `RUNTIME` (apply from empty) / `NONE` (rollback drill) | **Yes — rollback is no longer free** |
| R-O1 | Monitoring / ops | `/healthz` + `/readyz` probes, append-only audit log, and the `pnpm preflight:production` validator exist. No external metrics dashboard; North-Star metrics are audit-projected (`/admin`) but not trended. | Medium | Medium | Medium | Wire an external sink + daily outcome rollups (ledger Future #4). | `EXECUTION` | No |
| R-C1 | Launch externals | SMS (MSG91), object storage (S3/R2), and a staging perf pass are founder-owned externals gating a real launch. | Blocks traffic | High | High | **Escalated** — commercial/credential decision, Tier C. | `NONE` | **YES (external)** |

## GO / NO-GO assessment

| Gate | Status |
|---|---|
| Architecture reviewed | ✅ (depcruise 0 violations; no new debt) |
| Static analysis clean | ✅ (typecheck + ESLint `--max-warnings 0`) |
| Dependency rules satisfied | ✅ (961 modules, 0 cycles/boundary breaks) |
| Unit tests passing | ✅ (core 201 · ui 67 · web unit 15) |
| Integration tests passing | ✅ (web regression on PG17, incl. clone + attribution) |
| Runtime validation | ✅ (migrations, regression, build, raster) |
| **Critical E2E complete** | ⚠️ **partial** — env restored; publish→register journey + share-card/attribution assertions green (`4 passed, 1 flaky`); full 70-test suite run pending (R-E1) |
| Accessibility reviewed | ⚠️ partial (no axe gate run — R-A1) |
| Performance acceptable | ⚠️ unmeasured (R-P1) |
| Security reviewed | ✅ per-feature (R-S1); external review pending |
| Monitoring operational | ⚠️ probes + audit yes; dashboards no (R-O1) |
| Rollback validated | ⚠️ schema-free by construction; no drill (R-D1) |
| Release notes prepared | ✅ per-investment ledger + confidence index |

### Verdict: **NO-GO** (materially advanced)

**Since last assessment:** the local environment was **restored** (Docker healed → `pnpm setup:local` green → `:5433` migrated + seeded), and the critical publish→register journey plus the share-card/attribution assertions now run **RUNTIME-green**. Remaining to reach LOCAL GO: (1) **R-E1** — run the full 70-test Playwright suite green (the environment blocker is cleared; this is now execution, not infrastructure); (2) **R-E3** — a flaky teardown to stabilize. GA still additionally needs (3) **R-C1** — founder launch externals (Tier C). The honest blocker is no longer "can't run E2E" — it's "run the whole suite + provision externals."

## Top release-hardening priorities (ranked)
1. **CI e2e on an ephemeral Postgres** → clears R-E1/R-E2, the only engineering NO-GO gate. Also fixes the local :5433 residue fragility.
2. **axe a11y gate** over the public + admin surfaces (R-A1).
3. **Rollback + recovery drill** and a **perf baseline** (R-D1, R-P1).
4. **External launch credentials** (R-C1) — escalated to the founder.
