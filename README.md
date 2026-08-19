# DesiAuction NEXT

**The trusted operating system for community sports auctions.**

This repository is a greenfield enterprise rebuild. The previous repository serves exactly one purpose: behavioural documentation — business rules, workflows, edge cases, acceptance criteria. Nothing else crosses over.

## Status

**Post-audit remediation, pre-launch.** The engineering programme is complete: IP-0…IP-6 are frozen, the product programme PX-1…PX-12 has shipped, and `v1.0.0-rc.1` is tagged. This line said "Active phase: IP-0" for the whole of that (audit P3-9) — it is corrected here rather than deleted so the drift is on the record.

Where things actually stand:

- **Built:** identity, orgs/grants, competitions and registration, the live auction engine, settlement, financial operations, platform administration, and the public help/legal/marketing surfaces. 27 migrations.
- **Not deployed:** nothing is provisioned. No Fly, Vercel, managed Postgres, S3, SMS or payment accounts exist — these are founder-held ([docs/operations/PRODUCTION_CHECKLIST.md](docs/operations/PRODUCTION_CHECKLIST.md) §2–§3).
- **Current gate:** a production-readiness audit on 2026-08-18 returned **NO-GO** with three reproduced blockers ([docs/audits/FINAL-PRR/REPORT.md](docs/audits/FINAL-PRR/REPORT.md)). Work now is closing its §9 list. Release documents written at RC-1 carry correction notices where the audit found them stale — read those notices, not just the ✔ marks.

Governed by [docs/00-index.md](docs/00-index.md) (the Canon) and [docs/phase-2/IMPLEMENTATION_BLUEPRINT.md](docs/phase-2/IMPLEMENTATION_BLUEPRINT.md) (the roadmap, now delivered). Design docs numbered 51–70 describe intent, not always the built system; where they diverge they now say so on the page.

## Quickstart (target: under 30 minutes, IP-0_DESIGN §33)

Prerequisites: git, Docker, Node ≥ 24 (`.node-version`), pnpm 10 (`npm i -g pnpm@10`).

```sh
pnpm install
docker compose up -d                 # Postgres 17 (:5433) + MinIO (:9000)
cp .env.example .env.local           # local values; never real secrets
pnpm env:check                       # fail-closed env validation
pnpm --filter @desiauction/engine db:migrate
pnpm dev                             # web :3000 + engine :4000
pnpm verify                          # lint + typecheck + test + format + boundaries
```

Or `pnpm setup:local` for the one-command path (compose + migrate + roles + seed).

Verification commands, in the order they matter before a deploy:

```sh
pnpm verify                                      # lint + typecheck + test + format + boundaries
pnpm verify:local                                # the above + build + integration + env + health
pnpm --filter @desiauction/web grants:verify     # the four runtime roles hold the grants the code needs
pnpm --filter @desiauction/web rls:verify        # tenant isolation is load-bearing under the app role
pnpm --filter @desiauction/web db:restore-verify # dump/restore is row-count-lossless
pnpm preflight:production                        # cross-service production config gate
```

`grants:verify` is the newest and the one worth knowing about: every local
process connects as the database owner, which bypasses the grant model
completely, so the production role recipe drifted twelve migrations behind the
code without anything going red — the engine had lost `UPDATE` on
`registrations`, the table every sale writes. It asserts a declared grant
manifest against a real database and exits 1 on drift. It is a CI gate.

## Layout

| Path                 | What                                                   | Boundary               |
| -------------------- | ------------------------------------------------------ | ---------------------- |
| `apps/web`           | Next.js — Console, Stage, Owner Room, registration     | imports packages only  |
| `apps/engine`        | Fastify+ws — auction runtime (IP-4)                    | imports packages only  |
| `packages/core`      | pure domain: money, clock, (IP-4) reducer + invariants | imports nothing        |
| `packages/contracts` | Zod schemas for everything on a wire                   | zod only               |
| `packages/ui`        | FLOODLIGHT components (empty until IP-1)               | React only, never core |
| `packages/config`    | shared tsconfig / eslint / prettier                    | leaf                   |
| `spikes/`            | throwaway experiments; nothing may import them         | quarantined            |

Boundaries are machine-enforced: `pnpm depcruise`. Trunk-based, squash-only PRs with conventional-commit titles, no local git hooks — CI enforces (IP-0_DESIGN §16–§20).

## Rules of the repository

1. **Docs are the source of truth.** A PR that makes code disagree with a doc must change the doc first, in the same PR, with the reasoning.
2. **The Canon wins conflicts.** If two documents disagree, the one consistent with `00-index.md` Canon is correct; fix the other.
3. **The 35 invariants** ([docs/40-business-rules.md](docs/40-business-rules.md)) are constitutional. Violating states should be unrepresentable, not merely forbidden.
4. **The old repository is read-only reference.** Cite it as behaviour, never as justification for architecture or design.
5. **One implementation phase at a time.** Work belonging to a future phase is recorded, never executed (Blueprint §1).

## The five-second test

When a user opens this product, their first reaction within five seconds must be: _"This feels like an exceptional premium product."_ Every decision in `docs/` is downstream of that sentence and of one organizer saying: _"For the first time, I actually enjoyed running my own auction."_
