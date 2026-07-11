# 66 — Architecture Principles

> Canon: C-3, C-9, C-12, C-16 · v1.0 · 2026-07-11

The first-principles record: what shape the system is, and *why* — including where we deliberately diverge from the reference implementation.

## 1. The auction is a stateful, ordered, financial event stream — model it as exactly that

The defining decision (C-9): event-sourced ledger, per-auction monotonic `seq`, pure reducer, projections. Every trust property the product sells (invariants 10–13, 29) falls out of this one modeling choice rather than being bolted on.

## 2. Single writer per auction — delete the race, don't manage it

The reference ran bidding through serverless handlers racing on shared state, needing Redis distributed locks, an external timer queue, *and* a cron watchdog to simulate one coherent process. **We build the coherent process**: an auction actor in a stateful engine service owns its auction's writes; commands serialize naturally; timers are local (C-16); the lock infrastructure ceases to exist. The watchdog remains — as a safety net, not a load-bearing wall (53).

## 3. Surfaces are projections (C-3)

No surface computes truth; all five render grant-filtered read models at a stated `seq` (51). UI disagreement is architecturally impossible, not carefully avoided (invariant 12).

## 4. Pure core, effectful edges (C-12)

`packages/core` is the product in pure functions — rules, machines, policy — imported identically by web and engine (65). Transports, databases, and providers are adapters. This is why the determinism suite (58) can exist, and why "where is the rule for X?" always has one answer.

## 5. Boring infrastructure, one interesting component

Exactly one component earns novelty: the engine. Everything else is deliberately conventional (Postgres, a queue on Postgres, Next.js, a managed CDN) — the innovation budget is spent where the product differentiates (02), nowhere else (03 §11).

## 6. Degrade honestly, never block the night (invariant 19)

Every dependency is classified spine or non-spine; non-spine failures degrade features silently or with honest labels (61 matrix); the spine (bidding) has fallbacks all the way to paper mode. Availability of *the night* outranks availability of any component.

## 7. Tenancy and immutability live in the database, not in discipline

RLS under the app's checks (49); INSERT-only permissions on ledgers (52). The invariants that matter most are enforced where bugs can't reach them.

## 8. Contracts are the only coupling

Apps meet through `packages/contracts` (schemas → types → OpenAPI → wire). Anything not in a contract is private and refactorable without ceremony (50, 65).

## 9. Designed for 10x, built for 1x, measured always

Honest scale posture (52, 57): cellular engine and CDN offload are designed-in levers, not built-out speculation. Capacity claims are load-tested numbers, and growth pulls levers documented in advance rather than triggering rewrites.

## 10. Operations are architecture (C-22)

Live-aware deploys, replay-based recovery, standing staging simulation, drilled runbooks — the system is designed to be *operated calmly*, because the product's brand is a calm night. An architecture whose operation is heroic has failed this document.

## Recorded divergences from the reference (behaviour kept, architecture replaced)

| Reference | Here | Why |
|-----------|------|-----|
| Serverless handlers + Redis locks | Single-writer engine actors | §2 |
| QStash timers + cron watchdog | In-process timers + watchdog job | C-16 |
| Pusher/managed realtime + SSE | Engine-served WS + SSE | Owning the fan-out honors seq/gap protocol end-to-end (51) |
| Mutable `budgetSpent` counters | Ledger + projections | Invariant 11 with teeth |
| 3 role enums | Grants (C-8) | 36 |
| Prisma | Drizzle | SQL-first control for RLS/permissions work (52) |
| Single Next.js app for everything | web + engine split | The two runtime shapes are real (65) |
