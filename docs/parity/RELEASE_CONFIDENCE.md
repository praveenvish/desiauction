# Release Confidence Index — `feat/parity-superiority`

> Living certification ledger for the parity programme. Updated per iteration.
> **Static analysis passing is NOT production-ready.** Verification levels are
> explicit and never inflated.

## Verification taxonomy

| Level | Meaning |
|---|---|
| **SOURCE VERIFIED** | Compiles + lints + type-checks; logic read and reviewed. No execution. |
| **EXECUTION VERIFIED** | The code path actually ran green in a test (unit/integration) in this environment. |
| **RUNTIME VERIFIED** | Exercised against real dependencies (Postgres/RLS, storage, engine) — migrations applied, integration/e2e green. |
| **PRODUCTION VERIFIED** | Validated in a production-like deploy. **Only the Release Authority may declare this.** |

## Environment constraint (why RUNTIME is blocked)

The local Docker image store is corrupted (`docker pull postgres:17-alpine` →
`containerd … input/output error`). No Postgres ⇒ migrations, DB-backed
regression suites, and `next build` (build-time sitemap queries the DB) **cannot
run here**. This gates every RUNTIME/PRODUCTION claim below. It is an
infrastructure fault, not a code defect.

## Subsystem ledger

| Subsystem | Highest level reached | Evidence |
|---|---|---|
| core: media validators / key derivation / bind (S1/S2) | **EXECUTION** | `media.test.ts` incl. traversal + cross-tenant negatives |
| core: player-profile (deriveAge, styles) | **EXECUTION** | `player-profile.test.ts` |
| core: CSV serializer (`toCsv`) | **EXECUTION** | `csv.test.ts` |
| showcase: filter / sort / squads / URL params / CSV | **EXECUTION** | `showcase-filter/params/csv.test.ts` (11) |
| media: upload orchestration | **EXECUTION** | `run-media-upload.test.ts` (mocked fetch, all edges) |
| ui: ImageUploader | **EXECUTION** | `image-uploader.test.tsx` (jsdom, in `packages/ui`) |
| migrations `0017`/`0018` (structure) | **EXECUTION** | journal strictly-monotonic; `drizzle generate` → no drift |
| migrations `0017`/`0018` (apply to DB) | **SOURCE** → *blocked* | needs Postgres (RUNTIME) |
| media write path (actions/authz/route, S3 audit, PR1 withdrawal) | **SOURCE** | authz logic reviewed; `media.regression.test.ts` written, **not run** |
| public showcase read model (`publicShowcase`) | **SOURCE** | query reviewed; runtime needs DB |
| self-photo actions | **SOURCE** | self-scoped, key-bound; runtime needs DB |
| preflight guard (D1) | **EXECUTION** | ran in 3 env configs (local→FAIL, bucket→PASS) |
| ShowcaseGrid UI wiring (filters/dialog/CSV button/URL sync) | **SOURCE** | typecheck+lint; no jsdom env in `apps/web` — pure cores are EXECUTION |
| Blob CSV download | **SOURCE** | browser API; verify on running app |

## Release Confidence Index (summary)

- **Static (typecheck 11/11 · lint · no drift):** ✅
- **Unit/EXECUTION coverage:** ✅ strong for pure cores (core 168 · ui 67 · web unit 15)
- **Integration/RUNTIME:** ❌ **0** — blocked by infra
- **Migration apply:** ❌ NOT VERIFIED (blocked)
- **Build:** ❌ NOT VERIFIED (blocked)
- **a11y / perf / security-review:** partial (per-feature review notes; no automated a11y/perf gate run here)

**Overall: SOURCE+EXECUTION strong; RUNTIME/PRODUCTION unproven. NOT production-ready.**

## Evidence backlog (ranked)

1. **RUNTIME:** repair Docker → `db:migrate` → `pnpm --filter @desiauction/web test` → `build`. Promotes the media write path, showcase read, self-photo, and migrations to RUNTIME VERIFIED and clears the release blocker. *(Tier C — infra)*
2. **e2e:** upload flow (team logo / player photo / self-photo), showcase browse+export. *(needs running app)*
3. **UI integration tests:** add a jsdom env to `apps/web` vitest + `@testing-library/react`, then cover ShowcaseGrid interactions. *(Tier A but needs a dep decision)*
4. **a11y gate:** axe over `/c/[slug]` (showcase, dialog, toggles). *(needs running app)*
5. **perf baseline:** showcase render at 1k / 10k players; consider virtualization. *(Tier A profiling)*

## Path to Release Authority GO

`docker system prune -af && docker compose up -d db && \`
`pnpm --filter @desiauction/db db:migrate && \`
`pnpm --filter @desiauction/web test && \`
`pnpm --filter @desiauction/web build`

When that run is green: backlog #1 clears, most SOURCE rows become RUNTIME
VERIFIED, and an independent Release Authority can assess PRODUCTION VERIFIED.
Until then, no party may declare production readiness.
