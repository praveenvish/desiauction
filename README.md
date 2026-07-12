# DesiAuction NEXT

**The trusted operating system for community sports auctions.**

This repository is a greenfield enterprise rebuild. The previous repository serves exactly one purpose: behavioural documentation — business rules, workflows, edge cases, acceptance criteria. Nothing else crosses over.

## Status

**Phase 2 — Implementation. Active phase: IP-0 (Engineering Foundation).**
Governed by [docs/00-index.md](docs/00-index.md) (the Canon), [docs/phase-2/IMPLEMENTATION_BLUEPRINT.md](docs/phase-2/IMPLEMENTATION_BLUEPRINT.md) (frozen roadmap, M0-approved) and [docs/phase-2/IP-0_DESIGN.md](docs/phase-2/IP-0_DESIGN.md) (active-phase design).

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
