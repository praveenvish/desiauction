# AUCTION ARCHITECTURE DECISION RECORDS

## DesiAuction NEXT · v1.0 · 2026-07-14 · CTO · **Permanent engineering asset** (IP-4, M-IP4-1)

> All **Accepted** and implemented. Context → Decision → Consequences → Evidence.

---

## ADR-EventLogSourceOfTruth — rows are projections; the log is the ledger

**Context.** An auction is a legal-tempered money event: "what happened" must be
reconstructible exactly, after any crash, forever (C-9). Mutable rows alone
cannot prove history; a log alone cannot serve dashboards.

**Decision.** Dual-write in ONE transaction: every aggregate operation appends
exactly one immutable event to `auction_events` (per-auction `seq`) AND updates
the row projections. The events are the source of truth: `recoverAuction`
replays the log with core's pure reducer and heals rows from it. Nothing reads
hidden state; nothing writes outside the aggregate.

**Consequences.** Crash recovery is a fold; divergent rows are healable evidence,
not corruption; the future live engine (M-IP4-2) adopts the same log unchanged.
Cost: one extra insert per mutation — measured trivial.

**Evidence.** Regression: replay = persisted state; corrupted-row heal;
sequence-gap fail-closed; duplicate-seq loud failure.

---

## ADR-SingleWriterSeq — fairness is a total order, enforced structurally

**Context.** Doc 41: "bids are processed in arrival order at the engine (single
writer = total order, the seq is the proof); no priority lanes." The reference
implementation needed Redis locks because racing serverless handlers had no
order; we remove the race instead.

**Decision.** The per-auction `seq` is allocated inside the mutation transaction
and protected by unique `(auction_id, seq)`: a second concurrent writer fails
loudly instead of interleaving silently. This is the M-IP4-1 stand-in with the
same invariant the dedicated single-writer engine process will inherit.

**Consequences.** Ordering disputes are impossible by construction; "who bid
first" is answered by an integer. Under real concurrency a retry loop (or the
engine process) resolves collisions — a scheduling concern, never a fairness one.

**Evidence.** Duplicate-seq insertion rejected (regression); event log contiguity
asserted 1..N; replay re-verifies the order.

---

## ADR-AuctionReadyGateway — one door into Auction, built from frozen surfaces

**Context.** IP-3 froze with the condition that the Auction engine consumes
Competition ONLY via `scheduleSnapshot` / approved-registration projections and
adds a readiness gate before ingesting (GATES condition 2, doc 39 AuctionReady).

**Decision.** `auctionReady()` is that gate: a deep-frozen projection built
exclusively from the ScheduleSnapshot, the approved-registration read model and
the CompetitionSummary API. `createAuction` accepts only a passing projection;
creation locks the config and materializes the pool as deterministic lots.
Auction code contains no query against a mutable Competition entity.

**Consequences.** Competition invariants cannot be violated from Auction; the
pool an auction ingests is exactly what the organizer approved; the freeze
condition is discharged structurally, not procedurally.

**Evidence.** Regression: not-ready refusal (open intake / empty pool),
frozen+deterministic projection, deterministic lot preparation.

---

## ADR-PaddleTeamIdentity — a paddle is a person bidding FOR a team

**Context.** The directive's hierarchy is Competition → Auction → Person; the
canon's money model (doc 41) is per-TEAM: purses, squads, quotas and
"already leading" are all team properties.

**Decision.** Paddle = (auction, team, person, number): issued once per team
(unique), numbered `P01…` (unique), immutable (no update/delete path). The
person is WHO holds it; the team is WHOSE money it spends. Purse and squad
projections derive from sold lots per paddle.

**Consequences.** Both the directive's identity chain and the canon's money
model hold; owner handover (a new person for the same team) is a future
compensating issuance, never a mutation.

**Evidence.** Regression: P01/P02 stable, reissue refused, foreign team refused;
gauntlet checks 3/8/9/10/11 operate on the paddle's team projections.

---

## ADR-DeterministicTimer — domain timers, server time, no scheduling yet

**Context.** Client clocks cannot be trusted; UI timers drift; a timer that can
shrink or exceed its cap is a fairness hole (invariant 14). M-IP4-1's stop
condition forbids live timers.

**Decision.** The timer is a VALUE (`{opensAtMs, endsAtMs, extensions}`) and a
set of pure functions: open, extend-on-bid (`max(endsAt, now+ext)` capped at
`now+initial`), hold-remainder, resume, expiry, closing-soon. Server epoch-ms is
injected; core never reads a clock. Live expiry scheduling (watchdog) is
M-IP4-2 — it will CALL these functions, not replace them.

**Consequences.** Timer behavior is unit-testable and replay-verifiable (a
shrinking TimerExtended fails replay closed); the auto-extension algorithm is
race-free because bids apply in seq order — the fold determines the end.

**Evidence.** 6 timer unit tests (never-shrink, cap, hold/resume, deterministic
fold); replay `timer_shrank` fail-closed test.
