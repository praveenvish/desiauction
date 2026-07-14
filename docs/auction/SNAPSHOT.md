# AUCTION SNAPSHOT — THE WIRE CONTRACT

## DesiAuction NEXT · v1.0 · 2026-07-14 · CTO · **FROZEN** (IP-4, M-IP4-4)

> The `AuctionSnapshot` is the single thing every live surface renders. Cockpit,
> Owner Room, Stage and Overlay are **pure functions of this object** (C-3: one
> truth, five surfaces). No surface computes money or outcomes.
>
> This document freezes the contract. Additive fields are a minor version;
> removing or re-typing a field is a breaking change requiring a new ADR.

## 1 · The determinism claim, stated precisely

> **Two independent engines folding the same event log produce byte-identical
> snapshots.**

This is not an aspiration; it is **measured**, and the engine **enforces it at
runtime**:

- `buildAuctionSnapshot` is a pure function of `(replayed projection, static
  reference data, current-lot bids)`.
- **No clock is read** during construction or serialization. Remaining time
  travels as the absolute `endsAtMs` from the event log. `serverNowMs` lives on
  the *transport envelope*, never inside the snapshot — so the bytes stay stable
  while wall time moves.
- Serialization is **canonical JSON**: object keys sorted at every level, no
  whitespace. Source key order cannot change the bytes.
- Every collection has a **deterministic order**: lots by `seq`, paddles by
  `paddleNumber`, bid history by event `seq`.
- The engine's `deepVerify` rebuilds the snapshot **twice** from the log and
  compares bytes. Indeterminism is an integrity failure and **halts the auction**
  like any other.

### Measured evidence (M-IP4-4)

| Claim | Drill | Result |
|---|---|---|
| Two independent engines agree | Two `AuctionEngine` instances, no shared memory, load the same auction | **byte-identical** `serialized`, identical SHA-256, identical `version` |
| Hash stability | 10 independent folds of the same log | **1 distinct snapshot hash, 1 distinct projection hash** |
| Canonical serialization | Same data, different key order | identical bytes |
| No clock dependence | Two builds 25 ms apart | identical bytes |

## 2 · The contract

```ts
interface AuctionSnapshot {
  version: number;            // = last event seq. THE out-of-order rejection key.
  auctionId: string;
  auctionName: string;
  auctionStatus: AuctionStatus;
  currentLot: {
    lotId, lotNumber, playerName, role, basePrice,
    status: LotStatus,
    endsAtMs: number | null,  // absolute server time; clients render countdowns from it
    extensions: number,       // anti-snipe extensions on the current opening
    nextMinimumBid: number,   // the engine publishes the next legal rung
    currentBid: SnapshotBidEntry | null,
    bidHistory: SnapshotBidEntry[],   // current lot, seq order
  } | null;
  queue: SnapshotQueueEntry[];        // queued lots, seq order
  paddles: SnapshotPaddleEntry[];     // paddle-number order; committed + purseRemaining
  lotsResolved: number;
  lotsTotal: number;
  lastOutcome: { kind, lotId, lotNumber, playerName, amount, teamName, paddleNumber, atSeq } | null;
  recoveries: number;                 // count of AuctionRecovered — the ceremony trigger
}
```

`version` is the ordering key: a client that receives a lower `version` than it
already holds **discards the frame**. Reconnects are safe because a joining
socket is sent the full current snapshot immediately.

## 3 · Spectator isolation

The snapshot carries **team names and paddle numbers — never person identity**.
No phone, no email, no person ULID reaches a spectator surface. `lastOutcome`
(the SOLD/UNSOLD/HELD/REOPENED ceremony input) is spectator-safe by construction.
Regression: `expect(JSON.stringify(snapshot)).not.toContain(personId)`.

Dignity (C-23): UNSOLD is a neutral fact in the snapshot; rejection reasons and
`BidRejected` evidence live in the ledger and diagnostics, **never** on the wire
to spectators.

## 4 · Transport

WebSockets carry **snapshots only** — never business logic, never timer logic,
never rules.

```json
{"kind":"snapshot","serverNowMs":1752…,"version":42,"snapshot":{…}}
{"kind":"heartbeat","serverNowMs":1752…,"version":42}
```

`serverNowMs` on the envelope is the client's **drift correction**: countdowns
render from `endsAtMs − serverNowMs`, never from the browser's own clock. Access
requires an HMAC ticket minted by the web tier (`wsTicket(auctionId, secret)`).
The ticket is HMAC over `auctionId · 24h-window`, accepted for the current or
previous window — a **bounded lifetime** (≤ 48h), not a permanent bearer (MIN-2).

## 5 · Known constraints (certified, deferred by design)

**C-1 · Payload grows linearly with the pool.** The snapshot embeds the whole
queue, so it is 18 KiB at 100 lots and **359 KiB at 2500 lots**, and the full
snapshot is broadcast to every spectator on every event. Broadcast cost is
therefore `snapshot bytes × spectators × events`. This bounds the certified
operating envelope — see [PERFORMANCE](PERFORMANCE.md) §4. The fix (delta frames,
or splitting the queue out of the hot snapshot) is a **wire-contract change** and
is deliberately **not** made under a freeze.

**C-2 · Voided bids are not marked in `bidHistory`.** After an undo or a requeue
override, the reversed bid remains in the current lot's `bidHistory`, and
`SnapshotBidEntry` has no `voided` flag — so it is not visually distinguishable
from a live bid. This is **intentional** ("voided-but-visible", M-IP4-3): the
cockpit and stage see what was reversed rather than money silently vanishing.
Certification confirmed it carries **no money impact** — `decideBid` and
`nextMinimumBid` both read the *leading* amount, which the reducer clears on
reopen, and the ledger records the `BidInvalidated` event permanently. Adding an
explicit `voided` marker is an additive wire change deferred to post-freeze.

## 6 · Evidence

`packages/core/src/auction-snapshot.test.ts` (unit) ·
`apps/engine/src/integration/certification.integration.test.ts` §SNAPSHOT
CERTIFICATION (two independent engines, hash stability, canonical serialization,
clock independence) · `apps/engine/src/integration/live-engine.integration.test.ts`
(broadcast ordering, reconnect replay).
