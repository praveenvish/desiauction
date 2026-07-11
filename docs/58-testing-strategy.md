# 58 — Testing Strategy

> Canon: C-9, C-15, C-21 · v1.0 · 2026-07-11

## Shape: a pyramid with a special spine

Standard pyramid (unit → integration → E2E) **plus the engine determinism suite** — the auction engine is the product's reactor core and gets test machinery nothing else needs.

## The engine determinism suite (the signature investment)

The engine reducer is pure (C-9): `(state, event) → state`, and command validation is pure: `(state, command) → accept(event) | reject(code)`. Therefore:

- **Property-based tests (fast-check):** generated command streams (random bids/closes/pauses/reopens across random configs) assert the global invariants over every walk: purse never negative, reserve rule never violated post-hoc, no Sold without Purchase, timer never shrinks, seq strictly monotonic, replay(events) ≡ state (40 enforcement map).
- **Chaos replay:** recorded real-auction ledgers (anonymized) replayed against every engine change — behavioural regression = diff in any projection.
- **Simulation harness:** scripted "auction nights" (N teams, M lots, bid patterns incl. snipe wars, disconnects, restarts mid-lot) run in CI; the same harness drives load tests (k6 wraps it) and staging rehearsals (60).
- **Concurrency tests:** the single-writer claim is tested — parallel command floods must serialize to a legal total order (no lost updates, no interleaved validation).

## Layers

| Layer | Tooling | Scope & rules |
|-------|---------|---------------|
| Unit | Vitest | `packages/core` (rules, machines, policy, formatters — exhaustive), `@da/ui` logic components. Fast, no I/O |
| Contract | Vitest + zod schemas | API handlers against `packages/contracts`: every error code reachable, idempotency replay behavior, problem+json shape (50) |
| Integration | Vitest + Testcontainers Postgres | Repositories, projections, RLS policies (**tenancy tests: cross-org access attempts must fail at the DB even with app checks removed**, 49), migrations forward on production-shaped fixtures (52) |
| E2E | Playwright | The six Golden Journeys (70) on the CI matrix (14 viewports); auth flows; the full auction night via simulation harness + real browsers on all five surfaces simultaneously (invariant 12 asserted by scraping the same value from three surfaces) |
| Visual | Playwright screenshots (or Chromatic) | `@da/ui` stories both themes; golden screens per surface; diffs block merge (18 token changes) |
| A11y | axe-core in stories + E2E | Zero serious/critical violations (13); reduced-motion snapshot parity (11) |
| Load | k6 + simulation harness | 57 capacity targets, pre-GA and per engine-significant change |

## Policy

- **Coverage is a signal, not a goal**: `packages/core` ≥ 95% branch (it's the money); elsewhere, meaningful-scenario coverage reviewed by humans; no coverage-driven test theater.
- Tests are spec-first for domain code: the rule's doc section ID appears in the test name (`inv-14: timer never shrinks`) — traceability from constitution to assertion (40 → tests).
- Flaky = broken: quarantine within a day, fix or delete within a week; retries hide truth (C-2 spirit).
- Test data: factories in `packages/core/testing`; no shared mutable fixtures; every E2E run builds its own tournament and destroys it (the reference program's seed-hygiene lessons, institutionalized).
- The suite runs full on every PR < 10 min (parallelized); E2E+visual on merge queue; load/chaos nightly.
