# 59 — CI/CD

> Canon: C-21, C-22 · v1.0 · 2026-07-11

## Flow

Trunk-based: short-lived branches → PR → gates → merge queue → auto-deploy staging → promoted production deploys (60). No long-lived branches, no release branches; flags manage exposure (63).

## PR gates (all required, parallelized, < 10 min)

1. **Types:** `tsc --noEmit` strict, zero errors (64)
2. **Lint/format:** Biome + custom rules (raw-value ban 18, icon ban 12, boundary imports 65)
3. **Unit + contract + integration** suites (58)
4. **Build:** all apps compile; bundle-size gates (57)
5. **A11y:** axe on changed stories (13)
6. **Visual:** diffs on changed components require explicit approval
7. **Security:** Semgrep SAST, dependency audit (high+ fails), secret scan (49)
8. **Migrations:** forward-apply on fixture DB; destructive-token check (52)
9. **Docs gate:** PRs touching domain behavior must cite the doc section they implement or change the doc in the same PR (README rule 1; 68)

Merge queue re-runs the suite + Golden Journey E2E on the merged result — main is always releasable (C-21).

## Environments

| Env | Deploy | Data | Purpose |
|-----|--------|------|---------|
| Preview (per PR) | Auto | Ephemeral seeded DB per preview | Review every change running, including engine (preview engine cell) |
| **Staging** | Auto on merge | Production-shaped synthetic org + nightly simulation auction (58 harness) | The permanent rehearsal hall — the reference program's greatest operational absence, institutionalized here from day one |
| Production | Promoted (one click, two people for engine, 60) | Real | — |

Staging runs the full simulation nightly and the ops drills quarterly (61/62) — deploy→smoke→rollback is rehearsed *continuously*, not "one deploy away."

## Secrets & config

Per-env in the platform's managed store; `packages/config` validates fail-closed at boot (49); no secret ever in CI logs (masked) or previews of forks.

## Provenance

Builds are reproducible from lockfile; artifacts carry commit SHA + build id; production always answers `/health` with version, commit, and migration head — "what is running" is never archaeology (56).
