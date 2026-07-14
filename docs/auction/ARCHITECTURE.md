# AUCTION ARCHITECTURE

## DesiAuction NEXT · v1.0 · 2026-07-14 · CTO · **Permanent engineering asset** (IP-4, M-IP4-1)

> Implemented behavior only, at the M-IP4-1 tree. Companions:
> [ADRS](ADRS.md) · [EVENT_CATALOG](EVENT_CATALOG.md) · [RECOVERY](RECOVERY.md) ·
> [MONEY](MONEY.md) · [API](API.md). Engine specification: canon
> [doc 41](../41-auction-rules.md); machines: [doc 39](../39-state-machines.md).

## 1 · Domain ownership (never reversed)

**Competition owns** participants, registrations, schedule, venues — consumed via
`scheduleSnapshot`, the approved-registration projection and Competition APIs only.
**Auction owns** lots, bids, paddles, timers, events, fairness. **Identity owns**
authentication and authorization (`auction.conduct` gates every mutation).

## 2 · Layering

`packages/core/src/auction.ts` — every rule, pure (machines, gauntlet, ladder,
timer, config, replay reducer; no IO, no ambient time, no randomness).
`packages/db` migration 0008 — `auctions`, `paddles`, `lots`, `bids`,
`auction_events` (org-scoped, RLS `USING`+`WITH CHECK`, integer-paise bigints,
epoch-ms timers). `apps/web/src/server/auction/` — the aggregate (sole mutation
path), the AuctionReady projection, read models, gated actions.

## 3 · The state machines (frozen; rendered from core's machine descriptors)

**Auction** (doc 39 — `reconciled` declared for IP-6; abort = doc 39 Abandoned):

```
scheduled ──open──▶ live ⇄ paused ──complete──▶ completed ──reconcile──▶ reconciled
    │                │        │                                    (IP-6 settlement)
    └────abort───────┴─abort──┘──▶ abandoned  (terminal, ledger frozen as-is)
guards: open = ≥2 paddles ∧ ≥1 queued lot · complete = zero unresolved lots
```

**Lot** (Prepare/Queue/Open/Hold/Sold/Unsold/Withdrawn + doc 39 ClosingSoon):

```
prepared ──queue──▶ queued ──open──▶ on_block ⇄ closing_soon
    │withdraw          │withdraw         │  │hold      │hold
    ▼                  ▼                 │  ▼           │
withdrawn          withdrawn             │ frozen ──────┤ (sell/pass/requeue)
                                sell│pass│              │
                                    ▼    ▼              ▼
                                  sold  unsold ──requeue──▶ queued (policy rounds)
guards: sell = leading bid · pass = NO leading bid · requeue = unsold policy
sold undo = a COMPENSATING event (doc 41 lot.reopen, post-M-IP4-1), never a back edge
```

**Bid record**: `accepted → outbid → invalidated` (invalidated terminal). Rejected
attempts never become records — they are events + audit only.

## 4 · The bid gauntlet (doc 41's eleven ordered checks — exact codes)

`LOT_NOT_OPEN → NOT_AUTHORIZED → ALREADY_LEADING → INVALID_AMOUNT → BELOW_BASE →
BELOW_CURRENT → INVALID_INCREMENT → BUDGET_EXCEEDED → RESERVE_VIOLATION →
SQUAD_FULL → ROLE_LIMIT`. First failure returns its code. Pure and total
(`decideBid`). The increment ladder walks slab-by-slab from the base — flat mode
is a single open-ended slab; the reserve rule guarantees a team can always
complete `squadMin`.

## 5 · Timer & auto-extension (invariant 14, frozen)

`LotTimer { opensAtMs, endsAtMs, extensions }`, policy `{initial 30s, extension
15s}` (doc 41 defaults). On each ACCEPTED bid:
`endsAt := min(max(endsAt, now + extension), now + initial)` — the timer never
shrinks and never grants more runway than a fresh lot. Hold freezes the
non-negative remainder; open after hold re-attaches it to server-now. Server
time only, injected as a number — core never reads a clock; no setTimeout
exists anywhere (live scheduling is M-IP4-2). Deterministic: the fold of bid
times fully determines endsAt (no race — bids apply in seq order).

## 6 · Events, replay, audit

Every mutation appends exactly ONE event (see [EVENT_CATALOG](EVENT_CATALOG.md))
in the per-auction `seq` total order — the fairness proof — plus one audit row:
who (actor) · what (action) · when (at) · why (reason) · source · correlation ·
evidence (event seq). `replayAuction(events)` is a pure fold to the projection
(auction status, per-lot state + leading bid + sale, per-paddle committed
purse); it fails closed on sequence gaps, unknown types, illegal replayed
transitions and shrinking timers. Recovery strategy: [RECOVERY](RECOVERY.md).

## 7 · Paddles

Immutable identity: Competition → Auction → Person, refined with the canon's
team-bidding model (doc 41: purses/squads are per TEAM) — a paddle is issued to
a PERSON to bid FOR a TEAM: `(auction, team)` unique, `(auction, number)`
unique, human numbers `P01…`, no update or delete path exists. In M-IP4-1 the
conductor holds paddles; owner invitation/claims arrive with M-IP4-2.

## 8 · AuctionReady

The sole gateway (`auction-ready.ts`): deep-frozen projection built from the
ScheduleSnapshot + the approved-registration read model; checks = intake closed
∧ pool non-empty ∧ ≥2 teams. `createAuction` refuses anything else. Creation
locks the config (doc 41) and prepares the pool as lots in registration-number
order with band-resolved base prices.

---

## v1.1 · The live engine (M-IP4-2)

## 9 · The engine process (apps/engine)

The dedicated single-writer process — the ONLY mutation authority for live
auctions. The flow is exactly the directive's: client → command → engine →
aggregate → event store → projection → **AuctionSnapshot** → broadcast. Web
routes authenticate (session → tenant → `auction.conduct` where required) and
SUBMIT COMMANDS over HTTP with a shared secret; browsers receive snapshots over
the engine's WebSocket. The shared aggregate lives in `packages/auction`
(consumed by web AND engine — no duplicated rules; the boundary graph proves
packages never import apps).

**Command queue**: per-auction FIFO promise chain — commands execute strictly
serially; the single writer is a fact of the process, backstopped by the unique
`(auction_id, seq)`. **Idempotency**: `commandId` is the key; a duplicate
returns the ORIGINAL ack without re-execution. Every command acks
Accepted/Rejected with a deterministic reason.

**After every command** the engine re-folds the event log (core's pure
reducer), verifies the row projections against it, rebuilds the snapshot and
broadcasts. Any integrity failure — replay error, projection mismatch,
snapshot indeterminism (periodic double-build byte check) — HALTS the auction
fail-closed: commands are rejected with `engine_halted` until `RecoverAuction`
heals rows from events.

## 10 · AuctionSnapshot

Core's `buildAuctionSnapshot`: a deep-frozen, presentation-ready projection —
auction status, current lot (player, base, status, absolute `endsAtMs`,
extension count, next minimum bid, leader, bid history), the queue, paddles
with per-team purse. `version` = last event seq (the client's out-of-order
rejection key). Canonical JSON (sorted keys) makes identical events →
identical BYTES; no timestamp is generated during serialization — the server
clock rides the TRANSPORT envelope for client drift correction.

## 11 · WebSocket model

Snapshots only — never rules, never timer logic. Connect requires an
HMAC ticket minted by the web tier; on join the client receives the full
current snapshot (reconnect ≡ snapshot replay); heartbeats every 10s carry
`serverNowMs` (drift) and terminate dead sockets; clients reject frames whose
version is older than what they hold. Countdown rendering is
`endsAtMs − (clientNow + drift)` — clients never own time.

## 12 · Live timer & watchdog

The engine tick (250ms) is the timer authority: expiry closes the lot
in-engine (sold with a leader, unsold without — doc 41), the closing-soon
threshold flips the machine state, and both travel the SAME command queue as
bids — the timer cannot race a bid. Auction pause freezes the open lot's
remaining runway (`TimerHeld`); resume re-attaches it exactly
(`TimerResumed`) — reconnect and recovery restore exact remaining time from
the log. The watchdog also reports stall via /healthz and logs tick drift.

## 13 · Paddle claims

Identity stays immutable: a CLAIM issues a new paddle to a person for a team
(one ACTIVE paddle per team — partial unique); a RELEASE ends the claim
(`released_at` + event) — released paddles never bid and numbers are never
reissued. Fairness check 3 upgraded to TEAMS (doc 41 verbatim): a team that
swaps paddles still cannot outbid itself. Purse/squad/quota projections
aggregate per TEAM across all its paddles.
