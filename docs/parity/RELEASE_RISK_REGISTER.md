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
| R-E1 | **E2E — critical journeys** | E2E is blocked at the infrastructure layer: `docker compose up` for the repo DB (`:5433`) fails because **Docker Desktop's VM storage is corrupted** (`read-only file system` / containerd `input/output error`; the `desiauction-next-db-1` container cannot mount/restart). Root cause is NOT test residue (earlier hypothesis corrected). No CLI heals it (`pull`/`start`/`rm` all fail). The repo's `pnpm setup:local` is a correct one-command bootstrap; the machine's Docker is the defect. | High (core flows unrun) | Medium | **High** | **Restart Docker Desktop** (or Troubleshoot → Clean/Purge, or reboot) → `pnpm setup:local` → migrate/seed → `playwright test`. Hardened: `setup:local` now detects the corruption and prints recovery guidance; `TROUBLESHOOTING.md` documents it. CI is unaffected (ephemeral Postgres). | `RUNTIME` (setup hint verified) / journeys still `WRITTEN` | **YES** (until Docker restarted) |
| R-E2 | E2E — share surfaces | New assertions (og:image + twitter `summary_large_image`, `/opengraph-image` → image/png, `?ref` → register CTA) are appended to `public-registration.spec.ts` but blocked behind R-E1. | Medium | Medium | Same as R-E1; the underlying logic is RUNTIME via the raster harness + regression. | `WRITTEN` | No (logic RUNTIME elsewhere) |
| R-A1 | Accessibility | `@axe-core/playwright` is wired into specs, but no automated a11y gate ran this session; no axe pass over `/c/[slug]`, `/c/[slug]/p/[n]`, `/admin`. | Medium | Medium | Medium | Add an axe gate to the share/register/admin specs; run in CI. | `NONE` (this session) | No (not a hard gate yet) |
| R-P1 | Performance | No perf baseline for the showcase/board at scale (300–1k+ players); public pages are SSR + revalidate but unmeasured. | Medium | Low | Medium | Bench the showcase render + paginate/virtualize if needed. | `NONE` | No |
| R-S1 | Security | Recent reviews done (media authz/traversal, JSON-LD XSS, open-redirect `safeNext`, `?ref` allowlist-bounding). No full external pen-test. | High if breached | Low | High | Continue per-feature review; external review pre-GA. | `EXECUTION` (per-feature) | No |
| R-M1 | Metadata / SEO | OG/Twitter cards + noindex on player pages are correct (raster RUNTIME-verified; meta injection via Next file convention). E2E head-assertion pending (R-E2). | Low | Low | Low | R-E2. | `RUNTIME` (raster) / `WRITTEN` (head) | No |
| R-D1 | Migration / rollback | This branch (PX-12 → INV-5) added **no migrations** — schema-free rollback preserved. Migrations `0000–0018` apply green on PG17. | High if wrong | Low | High | Keep the no-migration posture; validated rollback drill pre-GA. | `RUNTIME` (apply) / `NONE` (rollback drill) | No (this branch) |
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
| **Critical E2E complete** | ❌ **not green this session (R-E1)** |
| Accessibility reviewed | ⚠️ partial (no axe gate run — R-A1) |
| Performance acceptable | ⚠️ unmeasured (R-P1) |
| Security reviewed | ✅ per-feature (R-S1); external review pending |
| Monitoring operational | ⚠️ probes + audit yes; dashboards no (R-O1) |
| Rollback validated | ⚠️ schema-free by construction; no drill (R-D1) |
| Release notes prepared | ✅ per-investment ledger + confidence index |

### Verdict: **NO-GO**

**Blocking evidence:** (1) **R-E1** — no green run of the critical-journey E2E suite this session (local DB residue on :5433); GO requires a green CI run on an ephemeral DB. (2) **R-C1** — founder-owned launch externals (SMS/storage/staging) are unresolved (Tier C). All engineering gates except Critical-E2E are green; the honest blocker is E2E execution + external launch readiness, not feature completeness.

## Top release-hardening priorities (ranked)
1. **CI e2e on an ephemeral Postgres** → clears R-E1/R-E2, the only engineering NO-GO gate. Also fixes the local :5433 residue fragility.
2. **axe a11y gate** over the public + admin surfaces (R-A1).
3. **Rollback + recovery drill** and a **perf baseline** (R-D1, R-P1).
4. **External launch credentials** (R-C1) — escalated to the founder.
