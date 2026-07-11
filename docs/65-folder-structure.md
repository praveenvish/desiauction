# 65 — Folder Structure

> Canon: C-12 · v1.0 · 2026-07-11

## The monorepo (pnpm + Turborepo)

```
desiauction-next/
├── docs/                      # This Product Operating System (source of truth)
├── apps/
│   ├── web/                   # Next.js: Console, Stage, Owner Room, registration, results
│   │   └── src/
│   │       ├── app/           # Routes (App Router) — thin: layout + data wiring only
│   │       ├── surfaces/      # console/ stage/ owner-room/ registration/
│   │       │   └── {surface}/{feature}/   # screen compositions per surface (17)
│   │       └── lib/           # web-only adapters (RPC client, session)
│   └── engine/                # Stateful auction service + workers
│       └── src/
│           ├── runtime/       # cell host, auction actors (single-writer), timers
│           ├── transport/     # WebSocket/SSE servers, stream construction (51)
│           ├── projections/   # ledger → read model writers (52)
│           └── workers/       # pg-boss handlers (53)
├── packages/
│   ├── core/                  # THE DOMAIN. Pure TS: rules (41–46), machines (39),
│   │   │                      #   policy (36), reducers/events, money, formatters
│   │   ├── src/{auction,tournament,registration,team,billing,policy,...}
│   │   └── testing/           # factories, simulation harness (58)
│   ├── contracts/             # zod schemas: API, events, analytics; generated OpenAPI (50)
│   ├── ui/                    # @da/ui: FLOODLIGHT components, tokens, icons, strings (19)
│   └── config/                # env schema (fail-closed), shared tsconfig/biome presets
├── infra/                     # IaC, deploy configs, freeze-calendar definitions (60)
└── tooling/                   # codemods, lint rules, CI scripts
```

## Boundary rules (lint-enforced, 64)

1. `apps/*` never import each other; they share only `packages/*`.
2. `packages/core` imports **nothing** from apps, ui, or transport — pure domain (its only deps: zod, date/money utils).
3. `packages/ui` never imports data fetching or `core` business logic (presentation-pure, 19); it may import `contracts` *types* for auction-kit props.
4. Surface folders in `web` never import from sibling surfaces (the workspace-isolation ruling carried: shared UI graduates to `@da/ui`, shared logic to `core`).
5. The engine's `runtime` is the only writer of ledger events (C-9 has a folder address).
6. Dependency direction is one-way: `apps → packages`; `contracts` and `config` sit at the bottom of everything.

## Placement heuristics

- "Where does this go?" → Is it a business rule? `core`. Is it visual and reusable? `ui`. Is it a wire shape? `contracts`. Is it one screen's composition? that surface's folder. Is it I/O? an adapter at the app edge.
- A file needed by two surfaces or two apps has outgrown its home — promote it down the stack (never sideways).
- Feature folders over type folders everywhere (`auction/`, not `components/ + hooks/ + utils/` soup).

## Why not microservices / separate repos (recorded decision)

Two deployables (web, engine) reflect the two genuinely different runtime shapes (request/response vs stateful stream). Everything else is libraries — services would add network boundaries where function calls suffice (03 §11), and the monorepo makes the docs-gate (59) and shared contracts enforceable in one place. Revisit only with evidence (67).
