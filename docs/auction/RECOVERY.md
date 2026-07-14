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
