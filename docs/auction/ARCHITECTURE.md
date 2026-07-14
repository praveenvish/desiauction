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

Snapshots only — never rules, never timer logic. Connect requires a
windowed HMAC ticket minted by the web tier (HMAC over `auctionId · 24h-window`,
bounded ≤ 48h lifetime); on join the client receives the full
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

---

## v1.2 · Conduct & Ceremony (M-IP4-3)

## 14 · Everything on the command path

The M-IP4-2 transitional note is closed: NO conduct mutation bypasses the
engine anymore. The setup surface's lifecycle/queue/paddle actions, the
cockpit, the owner workflow and the compensating undo all submit commands;
`createAuction` alone remains web-side (the aggregate's birth — no live state
exists before it). The command set grew to: `OpenAuction`, `IssuePaddle`,
`WithdrawLot`, `HoldLot`, `RequeueLot`, `InviteOwner`, `AcceptOwnerInvite`,
`GrantPaddle`, `UndoLastAction` (envelope now carries `override` — resolved
from `auction.override` by the web gate, demanded by undo on top of conduct).
"Skip lot" is not an edge: the cockpit opens ANY queued lot (doc 41 order
control — skip and bring-forward are the same act).

## 15 · The owner model (production paddle rule)

`auction_owner_invites` (hashed one-time tokens) + `paddle_grants`
(partial-unique active grant per auction/team/person), migration 0010, RLS
read+write. Invitation → acceptance → grant → claim; each step is an engine
command emitting `OwnerInvited` / `OwnerAccepted` / `PaddleGranted`, so
replay, the ledger and the audit trail carry the identical workflow.
`claimPaddle` refuses without an active grant (`no_grant`) — no active paddle
without an explicit grant, ever. Multiple owners may hold grants per team; one
ACTIVE paddle per team stands. Acceptance also inserts org MEMBERSHIP
(identity domain, audited `auction.owner_join`) — membership confers zero
capabilities. Conductor `issuePaddle` survives as manual mode: the
explicit-grant degenerate case.

## 16 · Compensating undo

`decideUndo(events)` (pure): the most recent LotSold/LotUnsold is the target;
any LotOpened/LotReopened first ⇒ `undo_window_closed` (doc 41: until the next
lot opens). The aggregate appends `BidInvalidated{reason:"undo"}` +
`LotReopened{compensatesSeq, endsAtMs}`; the winning bid row survives as
`invalidated` (voided-but-visible); the lot returns to `on_block` with a fresh
window; the purse restores BY PROJECTION (committed money is derived — nothing
stored to compensate). Replay of an undone night is byte-identical across
engine instances (regression-pinned).

## 17 · AuctionLedger

The canonical operational record — a PURE projection of the event store:
`buildAuctionLedger(events, refs, actorNames)` in core, assembled by
`ledgerOf`. One row per event (sequence · timestamp · actor · paddle · team ·
lot · bid · result · reason · correlation), regenerated on read, immutable and
append-only by construction. The ledger is a rendering, not a validator:
unknown types display as themselves; replay integrity stays with the reducer.

## 18 · Snapshot additions & the FLOODLIGHT ceremony

AuctionSnapshot gained two spectator-safe fields: `lastOutcome` (the most
recent resolution — kind/lot/names/amount/atSeq; cleared when the next lot
opens) and `recoveries`. `deriveCeremony(prev, next)` in core turns two
consecutive snapshots into the deterministic ceremony phase (recovery > pause
> completion > reopened > opening/extension/bid/sold…), keyed so a moment
triggers exactly once on every surface. The stage and the live status ribbon
are presentation only; reduced motion collapses transitions (IP-1).

## 19 · Diagnostics & the recovery dashboard

The engine tracks per-auction counters (queue depth via the pending map,
processed/accepted/rejected, avg/max processing, last replay/recovery
durations, broadcast latency) plus sha-256 hashes of the canonical snapshot
bytes and the folded projection. `GET /diagnostics/:auctionId` (shared secret)
serves them with room size, WS heartbeat age and watchdog state; the web
proxies conduct-gated. Spectator isolation is structural: sockets receive
snapshots only, and the snapshot carries no person ids, no tokens, no
grants, no engine internals (regression-pinned over the serialized bytes).

## 20 · Surfaces

`/auction/cockpit` (conduct) — ceremony stage, ribbon, conduct controls,
lot queue with open-any/withdraw/freeze/requeue, undo (override-gated),
owner workflow panel, purse board. `/auction/live` — bidder view (grant-gated
claims). `/auction/spectate` — read-only ceremony + ribbon. `/auction/ledger`
(conduct) — the operational record. `/auction/replay` (conduct) — scrub the
log with core's fold; the final frame's bytes compared against the live
engine snapshot. `/auction/engine` (conduct) — recovery dashboard +
diagnostics, 2s polling. `/owner-join/[token]` — invitation acceptance.

---

## 21 · Certification & freeze (M-IP4-4)

The architecture above is **FROZEN**. The certification package that justifies
the freeze:

| Document | Certifies |
|---|---|
| [COMMAND_MODEL](COMMAND_MODEL.md) | the closed set of 20 commands: authority, validation, transition, events, ledger and recovery behaviour for each |
| [SNAPSHOT](SNAPSHOT.md) | the wire contract; determinism measured (two independent engines → byte-identical bytes) |
| [EVENT_CATALOG](EVENT_CATALOG.md) | the closed set of 28 events, incl. the replayed **bid ledger** (v1.3) |
| [LEDGER](LEDGER.md) | immutable and append-only **by construction** — a pure fold, never a table |
| [RECOVERY](RECOVERY.md) | healable vs. unhealable; measured (28.5 ms @2 500 lots) |
| [DIAGNOSTICS](DIAGNOSTICS.md) | every watchdog halt condition and its recoverability |
| [PERFORMANCE](PERFORMANCE.md) | the measured scale matrix and the certified operating envelope |
| [SECURITY](SECURITY.md) · [THREAT_MODEL](THREAT_MODEL.md) | capability enforcement; what an attacker with DB write access can and cannot do |
| [RUNBOOKS](RUNBOOKS.md) | operating the platform without the original authors |
| [REVIEW_PACKAGE](REVIEW_PACKAGE.md) · [IP-4_CLOSURE_REPORT](IP-4_CLOSURE_REPORT.md) | the freeze decision |

### The three defects certification found

All were caught by **attacking** the platform, not by re-running its own passing
tests, and all are now regression-locked. Their common thread is the whole point
of hostile review: each was a row or a transition the engine *trusted*.

- **D-1** — `UndoLastAction` after a requeue wrote an **unreplayable** `LotReopened`
  event. Replay stopped folding at that seq, and since recovery *is* a replay, the
  auction was **bricked forever**. Reachable by ordinary conduct. Fixed in the pure
  core: the undo window now also closes when the **target lot itself** has been
  requeued/withdrawn/frozen since it resolved (checked **per-lot**, so an unrelated
  lot never blocks a legitimate undo), with a second guard in the aggregate.
- **D-2** — the **`bids` table**, the row the gavel reads the **sale price** from,
  was outside projection verification. The reducer now folds a bid ledger, the
  watchdog verifies every bid row (amount, paddle, lot, status) against the log,
  and recovery heals them from `BidAccepted`.
- **D-3** — the **`paddles` table**, which gates *who* may bid (`personId`) and
  attributes every bid and sale to a purse (`teamId`), was outside projection
  verification — an **undetected authorization hijack**. Found by the independent
  hostile audit re-attacking the very claim D-2 had declared true. The watchdog now
  verifies every paddle row (team, person, number, released) against the log and
  heals it. The verification rule is now complete: **every row the engine reads to
  decide is verified.** ([ADR-6/7/8](ADRS.md))

### The architectural boundary the freeze creates

**One auction, one writer — permanently.** Not a stage to be grown out of.
Horizontal scaling of a *single* auction is forbidden; fast recovery is the
availability answer. Downstream phases **consume** Auction: they may read the
ledger and snapshots, but they may not write `auction_events`, may not add a
second source of truth for money, may not mutate lots/bids/paddles outside the
aggregate, and may not require an auction-rule change to function. If one does,
that is an **ADR and a thaw**, not a patch.
