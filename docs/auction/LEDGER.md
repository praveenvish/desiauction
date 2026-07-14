# THE AUCTION LEDGER

## DesiAuction NEXT · v1.0 · 2026-07-14 · CTO · **FROZEN** (IP-4, M-IP4-4)

> The **canonical operational record** of an auction: a human-readable projection
> of the event store. It is **never the event store itself**, and never a second
> source of truth.

## 1 · Immutable and append-only *by construction*

The ledger is a **pure function** `(events, reference data, actor names) → rows`.
It has no table, no writer, and no API that mutates it.

This is the strongest available form of the guarantee:

- **It cannot be forged**, because nothing can write to it.
- **It cannot drift**, because regenerating it re-derives it from the log.
- **Appending an event appends exactly one row** — always, for every event type.
- **Nothing can rewrite a past row**, because a past row does not exist between
  regenerations; it is recomputed from immutable events every time.

**Certified:** regeneration equality (build twice → byte-identical), and
append-only (after a new command, every prior row is byte-identical and the
sequence remains dense and strictly increasing, 1..N with no gaps).

## 2 · The ten columns (every row)

| Column | Source |
|---|---|
| `seq` | the event's position in the per-auction total order |
| `atMs` | server epoch ms (the only clock) |
| `actorId` / `actorName` | who did it |
| `paddleNumber` | resolved from `PaddleIssued` events, so even early rows resolve |
| `teamName` | the paddle's team |
| `lotNumber` / `playerName` | the lot |
| `amount` | integer paise (bid, sale, or base price) |
| `result` | human sentence: `SOLD`, `UNSOLD`, `Bid accepted`, `Anti-snipe — timer extended`, `UNDO — lot reopened (compensates #n)`, … |
| `reason` | the *why*: a bid rejection code, an undo reason, an override note |
| `correlationId` | ties the row to its audit row and the originating request |

## 3 · Dispute traceability

Every row answers **who · what · when · why · on whose authority**, and links to
`audit_log` by `correlationId` and to `auction_events` by `seq`.

A disputed sale can be reconstructed exactly:

1. Find the `SOLD` row → it carries lot, paddle, team, amount, seq.
2. Every `Bid accepted` row for that lot, in order, is the full bidding history.
3. Every `Bid rejected` row carries the doc-41 code that refused it — so
   "why wasn't my bid taken?" has a recorded, deterministic answer.
4. `UNDO — lot reopened (compensates #n)` names the exact seq it reversed.
5. `Bid voided` rows show money that was reversed — **voided, never deleted**.

## 4 · Compensating events and undo

History is **never** rewritten. An undo appends `BidInvalidated` + `LotReopened`.
The winning bid survives in the ledger as voided; the purse restores **by
projection** (committed money is derived from sold lots, never stored). The
reversal is itself permanent history.

## 5 · Unknown events never break the ledger

The ledger is a *rendering*, not a validator — replay integrity is the reducer's
job. An event type the renderer does not recognise is shown as its **raw type**
rather than being hidden or dropped. Nothing is ever invisible in the ledger.

## 6 · Settlement readiness (IP-6 hand-off)

The ledger is the only history settlement will consume. It already carries what
settlement needs:

- final sale rows (`SOLD` with lot, paddle, team, amount in integer paise);
- every reversal, explicitly linked to what it compensates;
- per-team committed money derivable purely by folding the log (the reducer
  tracks `committed` per paddle and the snapshot exposes `purseRemaining`);
- full actor attribution and correlation for every money movement.

Settlement must **consume** this; it must not add a second source of truth, and it
must not require any change to auction rules. That constraint is the freeze.

## 7 · Performance

Regenerating the **entire** operational history of an auction night is
effectively free: **0.5 ms for 5 063 rows** (2 500-lot auction). There is no
reason to cache it, and therefore no cache to go stale.

## 8 · Evidence

`packages/core/src/auction-ledger.ts` (the fold) ·
`packages/core/src/auction-conduct.test.ts` (unit) ·
`apps/engine/src/integration/certification.integration.test.ts` §LEDGER
CERTIFICATION — regeneration equality, append-only, ten-column completeness,
audit linkage (every event has an audit row carrying its seq).
