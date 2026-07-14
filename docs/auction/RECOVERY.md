# AUCTION RECOVERY STRATEGY

## DesiAuction NEXT · v1.0 · 2026-07-14 · CTO · **Permanent engineering asset** (IP-4, M-IP4-1)

> Deterministic recovery, implemented and regression-pinned. No hidden state:
> everything an auction IS can be rebuilt from `auction_events`.

## 1 · The model

```
crash / doubt
   ↓
load auction_events (seq order — the single-writer total order)
   ↓
replayAuction(events)            pure fold in packages/core, deterministic
   ↓ ok?
   ├─ NO → FAIL CLOSED: report {atSeq, reason}; heal NOTHING; human attention
   ↓ YES
diff projection vs row state     (auction status · lot status/sale · paddles)
   ↓
heal rows FROM the projection    events win — rows are projections
   ↓
append AuctionRecovered {divergences, eventCount}  + audit
   ↓
resume conduct from the replayed state
```

## 2 · Guarantees (each a regression test)

- **Determinism** — the same log folds to the identical projection, every time.
- **Completeness** — the projection carries auction status, per-lot status,
  leading bid, sale (paddle + amount), rounds used, timer end, and per-paddle
  committed purse: everything the aggregates persist.
- **Fail-closed integrity** — a sequence gap, an unknown event type, an event
  illegal in its replayed state, a malformed payload, or a SHRINKING timer stops
  the replay with the offending seq. A corrupted log is surfaced, never
  absorbed; nothing is healed from a log that does not verify.
- **Healing direction** — rows are corrected from events, never the reverse.
  The regression proof corrupts a sold lot's row (status/price/paddle wiped) and
  recovery restores all three from the log.
- **Recovery leaves evidence** — `AuctionRecovered` + its audit row, with the
  divergence count.

## 3 · Timer recovery

Timers are values, not processes. A held/paused lot stores its non-negative
remainder (`heldRemainingMs`); re-opening re-attaches the remainder to server-now
(`resumeLotTimer`). After a crash, the replayed `endsAtMs` plus the current
server clock fully determine expiry — there is no in-memory countdown to lose.
The live watchdog (M-IP4-2, doc 41: "a durable watchdog re-checks from persisted
state if the engine restarts — the same idempotent close, exactly-once by seq")
will consume exactly this model.

## 4 · Operational procedure

Suspected divergence or post-crash restart: conduct → "Replay events & verify
state" (the `verifyReplayAction` surface) or call `recoverAuction` directly.
Zero divergences = proceed. Healed divergences = proceed; the ledger already
recorded what happened. Fail-closed replay = STOP: the log itself is damaged —
this is a P0 requiring the audit trail and database forensics, never an
automatic override.

---

## v1.2 · The recovery dashboard (M-IP4-3)

## 5 · Operational visibility

Recovery is no longer a developer act. `/competitions/[slug]/auction/engine`
(conduct-gated) polls the engine's read-only diagnostics every 2s and shows:
snapshot version + event sequence, replay duration, recovery duration, queue
depth, recovery status (verified / HALTED with the fail-closed reason),
watchdog (ticking/stalled + tick drift), connected clients, WS heartbeat age,
projection status, recovery count, throughput, avg/max processing, broadcast
latency, and the sha-256 snapshot + projection hashes. Hash equality across
independent engine instances is the projection-equality proof an operator can
SEE. The one button — Recover — submits the same `RecoverAuction` command as
every other surface. The organizer runs the entire procedure of §4 without
database access: halted state is visible, recovery is one click, and the
ledger records the evidence.

**Undo never threatens recovery.** Compensating events (`LotReopened` +
`BidInvalidated`) replay like any others; the regression suite pins that a
fresh engine folds an undone night to byte-identical snapshot state.

---

## CERTIFICATION UPDATE (M-IP4-4)

### The diff now covers every row the engine derives truth from

`diffProjection` verifies the auction status, the lot rows (status, sale price,
sold paddle) **and — new in M-IP4-4 — the bid rows** (amount, paddle, lot,
status), plus rows the log does not know about and events with no row.

This closed **defect D-2**: the `bids` table is where the gavel reads the sale
price from, and it was previously unverified. `recoverAuction` now **heals bid
rows from the events** as well.

### Healable vs. unhealable — the load-bearing distinction

| Class | Example | Recovery |
|---|---|---|
| **Derived rows diverge from the log** | lot status, sale price, **bid amount**, auction status | **Healed FROM the log.** The log wins; rows are rebuilt. |
| **The log itself is corrupt** | `sequence_gap`, `illegal_replayed_transition`, `unknown_event_type`, `timer_shrank`, `unknown_bid` | **NEVER healed.** Replay stops, **no snapshot is ever served**, and `RecoverAuction` refuses. |

The platform **will not invent history**. Folding around a hole would produce a
*plausible but false* auction — exactly what C-2 (zero silent failures) forbids.
Operator procedure for an unhealable log: [RUNBOOKS](RUNBOOKS.md) §4.

### Measured

| Auction size | Restart → replay → verify → snapshot |
|---|---|
| 100 lots | **3.1 ms** |
| 500 lots | 6.5 ms |
| 2 500 lots (5 063 events) | **28.5 ms** |

Recovery is a **non-risk**: it is not on the critical path of anything. This is
why availability is answered by fast recovery rather than by replication — and why
a second writer is architecturally forbidden (C-9).

### Certified drills

Kill + restart (byte-identical snapshot from the log alone) · corrupted lot row ·
**corrupted bid amount** · **re-crowned losing bid** · corrupted auction status ·
corrupted snapshot cache (derived, never authoritative — dropping it restores from
the log) · poisoned log with a sequence gap (halts, stays halted, recovery
refuses) · duplicate commands · deep verification. Commands are asserted **refused
while halted**. See `apps/engine/src/integration/certification.integration.test.ts`.

### The verified rows (complete set, after D-3)

`diffProjection` and `recoverAuction` cover **every row the engine reads to make a
decision**:

| Table | Verified against the log | Healed from |
|---|---|---|
| `auctions` | status | `Auction*` events |
| `lots` | status, sale price, sold paddle, **rounds used** | lot events |
| `bids` | amount, paddle, lot, status | `BidAccepted` / `BidInvalidated` (D-2) |
| `paddles` | **team, person, number, released** | `PaddleIssued` / `PaddleReleased` (D-3) |

Defect **D-3**: the `paddles` table gates authorization (`personId`) and purse/
squad/role attribution (`teamId`), yet was outside verification — a reassigned
paddle was an undetected authorization hijack. The reducer already folded the
paddle identity; it now also records the exact release timestamp so the row heals
precisely. Both gaps (D-2 bids, D-3 paddles) were found by hostile drills, and the
rule is now absolute: **if the engine reads a row to decide, the watchdog verifies
it.**
