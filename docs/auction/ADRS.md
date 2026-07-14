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

---

## v1.2 · Conduct & Ceremony (M-IP4-3)

## ADR-LedgerAsDerivation — the AuctionLedger is a fold, never a table

**Context.** The directive demands an immutable, append-only AuctionLedger —
the human-readable operational record (dispute surface, founder audit,
reconciliation input). A persisted ledger table would be a SECOND write per
event that could drift from the log it describes.

**Decision.** `buildAuctionLedger(events, refs, actorNames)` is a pure core
function; `ledgerOf` regenerates it from `auction_events` on every read.
Immutability and append-only-ness hold BY CONSTRUCTION: a projection of an
append-only log cannot be edited, and appending one event appends exactly one
row. Unknown event types render as their raw type (the ledger is a rendering,
not a validator — replay integrity remains the reducer's job).

**Consequences.** Zero divergence risk, zero extra writes, one more read-time
fold (measured: ~9 ms median at night-scale logs). The ledger inherits the
event log's RLS tenancy for free.

**Evidence.** Regression: one row per event; regeneration byte-identical;
sale/undo/rejection evidence carried; unknown-type rendering pinned.

## ADR-CompensatingUndo — undo appends, never deletes (doc 41 `lot.reopen`)

**Context.** Doc 41: undo is the highest-friction action — allowed until the
next lot opens, appends compensating events, never deletes (invariant 10);
prior bids stay voided-but-visible; requires an override-level capability.

**Decision.** `decideUndo(events)` is a pure backward scan: the most recent
LotSold/LotUnsold is the target; any LotOpened/LotReopened first closes the
window. The aggregate appends `BidInvalidated{reason:"undo"}` (sold only) +
`LotReopened{compensatesSeq, endsAtMs}`; the winning bid ROW survives as
`invalidated`; the lot returns to `on_block` with a fresh window. The purse
restores by PROJECTION (committed money is derived from sold lots — no stored
balance to compensate). The engine demands `conduct AND override` on the
envelope; the web gate resolves `auction.override` (org:owner only).

**Consequences.** Replay of an undone night is deterministic and byte-identical
across engine instances; history grows monotonically; a second undo inside the
same window is structurally impossible.

**Evidence.** Regression: purse restoration in replay; window enforcement;
fresh-engine snapshot equality after undo; capability refusals.

## ADR-OwnerGrantModel — no active paddle without an explicit grant

**Context.** M-IP4-2's temporary rule (any org member may claim) cannot ship:
production trust requires that only intended people can bid money for a team.

**Decision.** Invitation → acceptance → grant → claim. Auction-scoped
`auction_owner_invites` (hashed one-time tokens, the IP-2 discipline) and
`paddle_grants` (partial-unique active grant per auction/team/person), each
step an engine COMMAND emitting its event (`OwnerInvited`, `OwnerAccepted`,
`PaddleGranted`) — the ledger, audit trail and replay carry the same workflow.
`claimPaddle` refuses without an active grant (`no_grant`). Multiple owners per
team may hold grants; one ACTIVE paddle per team stands unchanged. The
conductor's manual `issuePaddle` (M-IP4-1) remains as the explicit-grant
degenerate case (grant+claim collapsed into one audited organizer act); no
implicit path exists anymore. Acceptance adds org MEMBERSHIP (identity domain,
audited separately) — membership confers zero capabilities (grants-not-roles).

**Consequences.** Paddle authorization is machine-enforced at claim time;
secrets never enter the event log (ids only); spectator snapshots carry no
owner data.

**Evidence.** Regression: claim-without-grant refused; grant-without-acceptance
refused; expired/stolen/replayed tokens refused; multiple owners; idempotent
re-grant.

## ADR-CeremonyDerivation — presentation is a pure function of two snapshots

**Context.** The FLOODLIGHT ceremony (sold splash, anti-snipe flash, recovery
notice) must be identical on every connected surface and own zero business
logic.

**Decision.** `deriveCeremony(prev, next)` in core: a deterministic, ordered
derivation (recovery > pause > completion > lot moments) keyed so transitions
trigger exactly once per moment. Inputs are ONLY broadcast AuctionSnapshots —
extended with spectator-safe `lastOutcome` and `recoveries` fields. Reduced
motion collapses the enter animation (IP-1 grammar).

**Consequences.** The cockpit, the bidder view and the spectator screen agree
on "what the room feels" by construction; ceremony is unit-testable without a
browser.

**Evidence.** Regression: opening → bid → sold → reopened walk; extension
dominance; pause/recovery dominance; steady-frame key stability; snapshot
carries no person ids.

## ADR-DiagnosticsReadOnly — engine truth is observable, never steerable

**Context.** The recovery dashboard must let an operator know instantly whether
the engine is healthy — without adding any state-changing surface.

**Decision.** The engine keeps per-auction counters (queue depth, throughput,
processing times, replay/recovery durations, broadcast latency) plus sha-256
hashes of the canonical snapshot bytes and the folded projection.
`GET /diagnostics/:auctionId` (shared secret, web-tier only) serves them; the
web proxies through a conduct-gated action. Spectator sockets receive
snapshots ONLY — engine internals never ride the broadcast channel.

**Consequences.** "Is the engine healthy" is one glance (halted reason,
watchdog, projection status, hashes); hash equality across independent engine
instances is the projection-equality proof operators can see.

**Evidence.** Regression: diagnostics shape; snapshot-hash = sha256(broadcast
bytes); halted visibility + recovery duration; spectator isolation over the
serialized snapshot.

---

## ADR-6 · The bid ledger lives in the replay reducer (M-IP4-4)

**Status.** Accepted · 2026-07-14 · certification defect **D-2**.

**Context.** The `bids` table is a projection of `BidAccepted`/`BidInvalidated`,
and it is the row the gavel reads the **sale price** from (`leadingBidOf` →
`soldPrice` → the `LotSold` event). The reducer did not model bids, so
`diffProjection` could not verify them: a bid row corrupted in the database would
be **sold at the corrupted price**, and the lie written into the immutable log as
history. Proved live: a doubled bid amount left the watchdog silent (`halted: null`).

**Decision.** The reducer folds a `bids` projection (`BidAccepted` records the bid
and demotes the previous leader to `outbid`; `BidInvalidated` voids it, and an
unknown bid id fails replay closed). `diffProjection` verifies every bid row's
amount, paddle, lot and status against the log — plus rows missing from the log
and events missing a row. `recoverAuction` heals bid rows from the events.

**Alternatives rejected.** (a) Verify bids in the aggregate rather than the
reducer — that would create a second authority on what the events say. (b) Trust
the rows because only the engine writes them — precisely the assumption
certification exists to destroy; the threat model's A5 (database write access) is
real, and the drill proved the hole.

**Consequences.** The rule now holds without exception: **if the engine reads a
row to make a decision, the watchdog verifies that row against the log.** An
attacker with write access to the projection tables cannot steal a lot — tampering
is detected on the next command, halts the auction, and is healed from the log.
Cost: the `bids` map in the projection, and one extra query per rebuild (folded
into the existing parallel read; `buildLiveSnapshot` at 2 500 lots = 25.3 ms).

**Evidence.** `certification.integration.test.ts` §RECOVERY (tampered amount →
halt → heal; re-crowned losing bid → halt → heal) · `auction-conduct.test.ts` §D-2.

---

## ADR-7 · The undo window closes per-LOT, not only on the next open (M-IP4-4)

**Status.** Accepted · 2026-07-14 · certification defect **D-1** (freeze-blocking).

**Context.** Doc 41: undo is allowed "until the next lot opens". `decideUndo`
implemented exactly that — and so it happily targeted a resolution that a later
`LotRequeued` had already superseded, writing `LotReopened` onto a lot that replay
sees as `queued`. The reducer rejects that transition, so the log **stopped
folding, permanently**; and because recovery *is* a replay, `RecoverAuction` failed
too. The auction was **unrecoverable**. Reachable by an ordinary conductor: lot
goes unsold → requeue it → change your mind → Undo.

**Decision.** The window also closes when the **target lot** has been requeued,
withdrawn or frozen since it resolved. The check is **per-lot**: acting on an
unrelated lot never blocks a legitimate undo. Defence in depth: `undoLastAction`
re-checks the lot's row status before writing, so an unreplayable compensating
event requires two independent failures.

**Alternatives rejected.** (a) Close the window on *any* subsequent lot event —
simpler, but it would refuse legitimate undos (e.g. queueing an unrelated lot after
a sale). (b) Make the reducer *tolerate* `LotReopened` from `queued` — this would
have "fixed" the crash by making the compensating event silently mean something
different depending on state, which is exactly the class of ambiguity event
sourcing exists to prevent.

**Consequences.** Undo is now total: for every reachable log, `UndoLastAction`
either produces a replayable compensating pair or refuses with
`undo_window_closed`. The reducer's fail-closed rejection of the poisoned event is
retained *and pinned by a regression* — the mechanism that made this catastrophic
is what caught it.

**Evidence.** `auction-conduct.test.ts` §D-1 (incl. a test asserting the poisoned
event is still rejected by the reducer) · `certification.integration.test.ts`
§REGRESSION D-1 (undo after requeue; undo after withdraw).

---

## ADR-8 · The paddle rows are verified against the log (M-IP4-4)

**Status.** Accepted · 2026-07-14 · **independent hostile audit**, freeze-blocking defect **D-3**.

**Context.** ADR-6 (D-2) brought the `bids` table under projection verification but
stopped there. The independent certification review attacked the `paddles` table —
which the engine reads on the bid hot path: `personId` gates *who* may bid
(`holder = paddle.personId === actor`), `teamId` attributes every bid and sale to a
purse/squad/role, and `releasedAt` gates whether the paddle may bid at all. None
was verified. Proved live: reassigning a paddle's `personId` directly in the
database, then restarting the engine, left `halted: null` — an **undetected
authorization hijack**, plus latent purse misattribution via `teamId`.

**Decision.** `diffProjection` now verifies every paddle row (team, person, number,
released) against the reducer's `PaddleProjection`, and `recoverAuction` heals them
from `PaddleIssued`/`PaddleReleased`. The reducer additionally records the exact
release timestamp (`releasedAtMs`, from the event `atMs`) so `released_at` heals
precisely. Lot `roundsUsed` (the unsold-policy counter, already folded by the
reducer) was verified in the same change.

**Alternatives rejected.** (a) Rely on the DB partial-unique index `(auction_id,
team_id) WHERE released_at IS NULL` — it blocks *some* team swaps but does nothing
for `personId`, and the drill proved it. (b) Treat paddle identity as immutable
"reference data" exempt from verification — false: it lives in a mutable table an
operator or attacker can write, and the engine reads it to authorize money.

**Consequences.** The verification rule is now **absolute and complete**: every row
the engine reads to make a decision — auction status, lots (incl. rounds), bids,
paddles — is verified against the log and healed from it. An attacker with
projection-table write access can corrupt none of them undetected. Cost: one small
`loadPaddleRows` query per rebuild (≈10 rows regardless of pool size); measured
performance is unchanged.

**Evidence.** `certification.integration.test.ts` §RECOVERY (corrupted paddle
person → halt → heal; corrupted paddle release → halt → heal; corrupted lot rounds
→ halt → heal) · `auction-conduct.test.ts` §D-3 (the reducer records the release
timestamp). Found by the independent audit; the throwaway probe that found it is
promoted into these permanent drills.
