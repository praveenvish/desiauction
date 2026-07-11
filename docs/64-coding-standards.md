# 64 — Coding Standards

> Canon: C-12 · v1.0 · 2026-07-11

## Language & strictness

- **TypeScript everywhere, `strict` + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes`.** `any` is lint-banned (explicit `unknown` + narrowing); `as` casts require a comment stating the invariant that justifies them; `@ts-ignore` is banned (`@ts-expect-error` with reason, rare).
- Runtime boundaries validate with zod from `packages/contracts` (29/50); internal code trusts types (validate at the edge, not everywhere — 03 §11).
- Node LTS pinned; ESM only; no CommonJS interop debt from day one.

## Tooling

**Biome** (lint + format, one tool, fast) + custom lint rules that enforce the constitution mechanically:

- No raw color/spacing values outside token files (18)
- No non-Lucide/`@da/ui` icons (12)
- Import-boundary rules (65): apps never import apps; `packages/core` imports nothing app-flavored; `@da/ui` imports no data layer
- No `Date.now()`/`new Date()` in `packages/core` domain logic (clock is injected — determinism, 58)
- Money values type-branded (`Paise`), never bare `number` arithmetic on branded types without the money utils (C-7)

## Structure & style

- Functions small and single-purpose; **pure core, effects at edges**: domain logic in `packages/core` takes data, returns data — I/O lives in thin adapters (50, the testability spine of 58).
- Naming: domain vocabulary from the glossary (00) verbatim — a `PoolEntry` is never a `playerItem`; ubiquitous language is a lint-adjacent review rule (20 terminology, applied to code).
- Errors: typed result objects (`{ ok } | { error: code }`) for expected outcomes (bid rejections); thrown exceptions only for the unexpected; error codes from the shared taxonomy (50).
- Comments state *why* and constraints, never *what*; every exported `packages/core` function carries a doc-section reference where it implements one (`// 41 §gauntlet-9`).
- No TODO without an issue link; no commented-out code in main.

## React specifics

- Server components by default on public surfaces (57); client components justified at the boundary.
- State: server state via the RPC layer's cache; UI state local; **two sanctioned client stores maximum** (live-session store + app-shell store) — the reference's FIP ruling, carried because it worked: state sprawl is the frontend's tenancy bleed.
- No `useEffect` for derivable data; effects are for subscriptions and imperative edges (the live stream hook owns the socket, 51).
- Components consume `@da/ui`; screens compose, they do not style (19 consumption law).

## Review rules

- PRs small (< 400 lines diff guideline), one concern; description cites the doc sections implemented (59 gate 9).
- Two approvals for: `packages/core` money paths, migrations, auth/policy, engine protocol. One elsewhere.
- The review question hierarchy: correct per docs? → invariant-safe? → tested at the right layer? → consistent with the codebase's idiom? Style nits below that are the linter's job, not the reviewer's.
