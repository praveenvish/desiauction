# 59 — CI/CD

> Canon: C-21, C-22 · v1.0 · 2026-07-11

> **Implementation status — 2026-08-19.** Written as a target and read as a
> description of the pipeline. The gates that exist are in
> `.github/workflows/ci.yml` and are listed first below; the rest is relabelled
> as target so nobody signs off against a gate that is not running. Note the
> harder fact behind all of it: as of the 2026-08-18 audit the repository had
> **no git remote**, so no workflow in `.github/` had ever executed. "CI covers
> it" is true only once there is a run to point at.

## Flow

Trunk-based: short-lived branches → PR → gates → merge. No long-lived branches,
no release branches; flags manage exposure (63). *Target additions not built: a
merge queue, auto-deploy to staging, promoted production deploys (60).*

## PR gates — implemented (`.github/workflows/ci.yml`)

| Job | What runs |
|---|---|
| `quality` | `pnpm lint` · `pnpm typecheck` · `pnpm test` (unit + contract) · `pnpm build` · generated-UI diff check · `pnpm format:check` · `pnpm depcruise` (boundaries + `no-circular`) · `pnpm audit --prod --audit-level high` |
| `integration` | Postgres 17 service → migrations → `pnpm test:integration` → **creates all four production roles** → `grants:verify` → `rls:verify` |
| `e2e` | Postgres 17 service → migrations → `seed:demo` → `next build` → Playwright (precompiled), report uploaded on failure |
| `secrets-scan` | gitleaks |
| `pr-title` | conventional-commit title check |

The `integration` role/grant/RLS steps and the whole `e2e` job were added
2026-08-19. Before that CI ran neither of the two proofs the release documents
rest on — e2e and `rls:verify` — and the four-role recipe was verified by
nothing (audit P1-1, P1-3). `pnpm audit --prod --audit-level high` is a real
gate and it **exits 1 today** (17 high advisories, audit P1-4).

## PR gates — target (not built)

1. **A11y:** axe on changed stories (13). *Axe does run inside the Playwright specs, but there is no separate changed-story gate and no story runner.*
2. **Visual:** diffs on changed components require explicit approval. *No visual-diff tooling of any kind is installed.*
3. **Security:** Semgrep SAST (49). *Not installed. The dependency audit and secret scan in the table above are the security gates that exist.*
4. **Migrations:** forward-apply on a fixture DB; destructive-token check (52). *Migrations are applied in the `integration` and `e2e` jobs, so forward-apply is covered; there is no destructive-token check — which is how `0019_tournaments.sql` shipped a table rename and a column drop unremarked.*
5. **Docs gate:** PRs touching domain behavior must cite the doc section they implement or change the doc in the same PR (README rule 1; 68). *Enforced by review convention only; nothing checks it. The doc drift this notice is part of is the cost.*
6. **Merge queue** re-running the suite + a Golden Journey E2E on the merged result (C-21). *No merge queue is configured (no `merge_group` trigger), and there is no "Golden Journey" spec — the e2e job above runs the full Playwright suite on PR and on `main` instead.*
7. **Bundle-size gates** (57). *Not enforced.*

## Environments

| Env | Status |
|---|---|
| Preview (per PR) | **Does not exist.** No preview deploys, no ephemeral per-PR database, no preview engine cell. |
| **Staging** | **Does not exist** — no staging deploy, no production-shaped synthetic org, no nightly simulation auction. This is load-bearing in more places than it looks: the staging perf certification, the quarterly PITR drill, the multi-browser sweep and the "rehearse the migration first" rule in docs/60 all wait on it. |
| Production | **Does not exist.** Founder-held provisioning ([PRODUCTION_CHECKLIST](operations/PRODUCTION_CHECKLIST.md) §2). |
| Local | The only environment. `pnpm setup:local` + `pnpm verify:local`; the production rehearsal is `next build` + `next start` on this machine. |

The target — staging running the full simulation nightly and the ops drills
quarterly (61/62), so deploy→smoke→rollback is rehearsed *continuously* rather
than being "one deploy away" — stands as the intent. It is the single largest
gap between this document and the repository, and the reason several release
claims elsewhere could not be re-verified.

There is a nightly workflow (`.github/workflows/nightly-verify.yml`): fresh
migrations, integration, e2e, the RLS probe under the four-role recipe, and
`db:restore-verify`. It runs against an ephemeral Postgres service, not a
staging environment, and like everything else in `.github/` it needs a remote to
run at all.

## Secrets & config

Per-app `env.ts` validates fail-closed at boot (49) — that part is real and
`pnpm env:check` runs it for all three apps. The per-env managed store is target:
there is no secrets store, and no previews to leak into. `pnpm preflight:production`
is the cross-service production-completeness gate; it is asserted in the checklist
and **enforced by no workflow** (audit P2-7).

## Provenance

Builds are reproducible from lockfile (`--frozen-lockfile` in CI) — implemented.
The rest is target: artifacts do not carry a commit SHA or build id, and
`/healthz`/`/readyz` answer liveness and DB reachability only, not version,
commit or migration head. Until they do, "what is running" *is* archaeology, and
an operator deciding whether a release shipped a migration
([DEPLOYMENT §Rollback](operations/DEPLOYMENT.md#rollback)) has to diff the
repository to find out.
