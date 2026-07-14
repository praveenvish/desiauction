# IP-4 — AUCTION ENGINE · DETAILED DESIGN

## DesiAuction NEXT · v1.0 · 2026-07-14 · CTO · Active phase artifact

> Governed by Blueprint §IP-4, Canon C-7/C-9/C-13, and the ratified engine
> specification [41-auction-rules](../41-auction-rules.md) + machines
> [39-state-machines](../39-state-machines.md). Consumes **frozen** `ip2-frozen`
> (Identity), `ui@0.1.0` (FLOODLIGHT) and `ip3-frozen` (Competition — via
> ScheduleSnapshot, approved-registration projections and Competition APIs only,
> per the IP-3 GATES entry condition 2). None is redesigned.

## 1 · Executive summary

IP-4 builds the Auction Engine — the heart of the product. The phase is
correctness-first: M-IP4-1 froze every invariant (machines, gauntlet, money,
timers, events, replay, audit) BEFORE any live behavior exists, so that bidding,
ceremony, recovery and settlement are additions on a fixed skeleton, never
redesigns. Doc 41 is the engine specification; `packages/core` implements it as
pure functions; the web aggregate orchestrates; the event log is the source of
truth.

## 2 · Architecture decisions (phase level)

- **D1 · Event log as source of truth, rows as projections.** Every mutation
  appends exactly one immutable event in a per-auction total order; row state
  (auctions/lots/bids/paddles) is a queryable projection that recovery can heal
  FROM the events. No hidden state.
- **D2 · Single-writer order, enforced structurally.** The unique
  `(auction_id, seq)` makes concurrent writers fail loudly. A dedicated
  single-writer engine process (apps/engine) adopts this same log when live
  bidding arrives; the invariant is already frozen.
- **D3 · Pure decisions, injected time.** Machines, the gauntlet, ladders and
  timers live in core with zero IO and zero ambient time; the server passes
  `Date.now()` — the engine clock is the only clock (doc 41 fairness).
- **D4 · AuctionReady is the only door.** Auction consumes Competition through
  the frozen read surfaces exclusively; `createAuction` accepts only a passing
  AuctionReady projection.

## 3 · Milestones

| ID | Name | Scope | Status |
|----|------|-------|--------|
| M-IP4-1 | **Auction Engine Foundation** | Aggregates (Auction/Lot/Bid/Paddle), machines, gauntlet, Money VO, timer + auto-extension model, event model, replay + recovery, audit, AuctionReady, demo surfaces | **complete — this milestone** |
| M-IP4-2 | Live bidding | Single-writer engine process, WebSockets, live timers/watchdog, owner paddle claims, real bidding surfaces | planned |
| M-IP4-3 | Conduct & ceremony | Cockpit, manual conduct, undo (compensating events), FLOODLIGHT ceremony, spectators | planned |
| M-IP4-4 | Auction freeze | Post-auction projections for IP-6 settlement, closure package, `ip4-frozen` | planned |

## 4 · Verification strategy

Unit (core): all three machines exhaustively, the eleven-check gauntlet with
exact codes, ladder membership across slab boundaries, timer never-shrink /
cap / hold-resume, replay determinism + fail-closed corruption. Integration
(real PG): the full aggregate choreography, event contiguity, audit correlation,
recovery healing, RLS read+write proofs on all five tables. E2E: the founder
demonstration journey + axe. Everything permanent CI assets.

*IP-4_DESIGN.md v1.0 · CTO · 2026-07-14. Stop condition honored: no live
bidding, no WebSockets, no ceremony in M-IP4-1.*
