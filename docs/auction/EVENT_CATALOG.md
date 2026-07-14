# AUCTION EVENT CATALOG

## DesiAuction NEXT · v1.0 · 2026-07-14 · CTO · **Permanent engineering asset** (IP-4, M-IP4-1)

> The complete, closed set of auction events. Envelope (persisted in
> `auction_events`, append-only): `seq` (per-auction total order) · `type` ·
> `atMs` (server epoch ms) · `actor` (person ULID) · `correlationId` (ties the
> event to its audit row and request) · `payload` (below). The replay reducer
> (`replayAuction`) fails closed on any type not in this catalog. Money in
> payloads is integer paise (JSON-exact).

| Event | Emitted by | Payload | Replay effect |
|---|---|---|---|
| `AuctionCreated` | createAuction | competitionId, lotCount, name | — (initial state is `scheduled`) |
| `PaddleIssued` | issuePaddle | paddleId, teamId, personId, paddleNumber | registers paddle, committed = 0 |
| `LotPrepared` | createAuction | lotId, registrationId, lotNumber, basePrice | lot enters `prepared` |
| `LotQueued` | transitionLot(queue) | lotId | `prepared→queued` (also legal from unsold/frozen — counts a round, clears the leader) |
| `AuctionOpened` | transitionAuction(open) | from | status → `live` |
| `AuctionPaused` | transitionAuction(pause) | from | status → `paused` |
| `AuctionResumed` | transitionAuction(resume) | from | status → `live` |
| `AuctionClosed` | transitionAuction(complete) | from | status → `completed` |
| `AuctionAborted` | transitionAuction(abort) | from | status → `abandoned` |
| `AuctionRecovered` | recoverAuction | divergences, eventCount | — (recovery IS the replay) |
| `LotOpened` | transitionLot(open) | lotId, endsAtMs | lot → `on_block`, timer set |
| `LotClosingSoon` | (timer-derived; runtime arrives M-IP4-2) | lotId | lot → `closing_soon` |
| `LotHeld` | transitionLot(hold) | lotId, heldRemainingMs | lot → `frozen` |
| `LotSold` | transitionLot(sell) | lotId, bidId, paddleId, amount | lot → `sold`; paddle committed += amount |
| `LotUnsold` | transitionLot(pass) | lotId | lot → `unsold` |
| `LotRequeued` | transitionLot(requeue) | lotId | unsold/frozen → `queued`; roundsUsed += 1; leader cleared |
| `LotWithdrawn` | transitionLot(withdraw) | lotId | lot → `withdrawn` |
| `BidAccepted` | placeBid (gauntlet passed) | lotId, bidId, paddleId, amount, prevBidId | bidCount += 1; leader replaced |
| `BidRejected` | placeBid (gauntlet failed) | lotId, paddleId, amount, code | — (evidence only) |
| `BidInvalidated` | transitionLot(requeue of a frozen leader); adjudication (future) | lotId, bidId, reason | — this milestone (adjudication projection arrives with undo) |
| `TimerExtended` | placeBid (anti-snipe) | lotId, endsAtMs | lot endsAt updated; replay REJECTS a shrink (`timer_shrank`) |

**Emission discipline**: every aggregate mutation appends exactly one event
(bid acceptance may add `TimerExtended`, requeue may add `BidInvalidated` — each
its own envelope, same correlationId). Every envelope has a same-transaction
audit row carrying `{source, correlationId, eventSeq, reason?}`.

**Replay integrity** (fail-closed reasons): `sequence_gap` · `unknown_event_type`
· `illegal_replayed_transition` · `malformed_*` · `unknown_lot` /
`unknown_paddle` · `timer_shrank`.
