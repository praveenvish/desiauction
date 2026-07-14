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
| `PaddleIssued` | issuePaddle / claimPaddle (M-IP4-2) | paddleId, teamId, personId, paddleNumber | registers paddle, committed = 0 |
| `PaddleReleased` | releasePaddle (M-IP4-2) | paddleId, teamId | marks the paddle released — it never bids again; the identity row survives |
| `LotPrepared` | createAuction | lotId, registrationId, lotNumber, basePrice | lot enters `prepared` |
| `LotQueued` | transitionLot(queue) | lotId | `prepared→queued` (also legal from unsold/frozen — counts a round, clears the leader) |
| `AuctionOpened` | transitionAuction(open) | from | status → `live` |
| `AuctionPaused` | transitionAuction(pause) | from | status → `paused` |
| `AuctionResumed` | transitionAuction(resume) | from | status → `live` |
| `AuctionClosed` | transitionAuction(complete) | from | status → `completed` |
| `AuctionAborted` | transitionAuction(abort) | from | status → `abandoned` |
| `AuctionRecovered` | recoverAuction | divergences, eventCount | — (recovery IS the replay) |
| `LotOpened` | transitionLot(open) | lotId, endsAtMs | lot → `on_block`, timer set |
| `LotClosingSoon` | the engine watchdog tick (M-IP4-2) | lotId | lot → `closing_soon` |
| `LotHeld` | transitionLot(hold) | lotId, heldRemainingMs | lot → `frozen` |
| `LotSold` | transitionLot(sell) | lotId, bidId, paddleId, amount | lot → `sold`; paddle committed += amount |
| `LotUnsold` | transitionLot(pass) | lotId | lot → `unsold` |
| `LotRequeued` | transitionLot(requeue) | lotId | unsold/frozen → `queued`; roundsUsed += 1; leader cleared |
| `LotWithdrawn` | transitionLot(withdraw) | lotId | lot → `withdrawn` |
| `BidAccepted` | placeBid (gauntlet passed) | lotId, bidId, paddleId, amount, prevBidId | bidCount += 1; leader replaced |
| `BidRejected` | placeBid (gauntlet failed) | lotId, paddleId, amount, code | — (evidence only) |
| `BidInvalidated` | transitionLot(requeue of a frozen leader); adjudication (future) | lotId, bidId, reason | — this milestone (adjudication projection arrives with undo) |
| `TimerExtended` | placeBid (anti-snipe) | lotId, endsAtMs | endsAt updated; a `closing_soon` lot returns to `on_block` (the extend edge — the M-IP4-2 watchdog-caught regression); replay REJECTS a shrink (`timer_shrank`) |
| `TimerHeld` | transitionAuction(pause) (M-IP4-2) | lotId, heldRemainingMs | the open lot's runway freezes with the auction: endsAt → null |
| `TimerResumed` | transitionAuction(resume) (M-IP4-2) | lotId, endsAtMs | the held remainder re-attaches to server-now |

**Emission discipline**: every aggregate mutation appends exactly one event
(bid acceptance may add `TimerExtended`, requeue may add `BidInvalidated` — each
its own envelope, same correlationId). Every envelope has a same-transaction
audit row carrying `{source, correlationId, eventSeq, reason?}`.

**Replay integrity** (fail-closed reasons): `sequence_gap` · `unknown_event_type`
· `illegal_replayed_transition` · `malformed_*` · `unknown_lot` /
`unknown_paddle` · `timer_shrank`.

---

## v1.2 additions (M-IP4-3 — Conduct & Ceremony)

| Event | Emitted by | Payload | Replay effect |
|---|---|---|---|
| `OwnerInvited` | inviteOwner (InviteOwner command) | inviteId, teamId | registers the invitation (secrets NEVER enter the log — the token hash lives only in `auction_owner_invites`) |
| `OwnerAccepted` | acceptOwnerInvite (AcceptOwnerInvite command) | inviteId, teamId, personId | marks the invitation accepted; an unknown invitation fails replay closed (`unknown_invite`) |
| `PaddleGranted` | grantPaddle (GrantPaddle command) | grantId, teamId, personId | registers the grant — the explicit authorization behind every claim |
| `LotReopened` | undoLastAction (UndoLastAction command) | lotId, compensatesSeq, endsAtMs | THE COMPENSATING UNDO (doc 41 `lot.reopen`): legal only from `sold`/`unsold`; a sold reopen returns the amount to the team's purse and clears the sale; leading clears (its `BidInvalidated{reason:"undo"}` precedes this, same correlation); lot → `on_block` with the fresh window; `timerExtensions` reset |

**Projection additions (v1.2).** `ownerInvites` / `paddleGrants` (the replayed
workflow), `lastOutcome` (the most recent resolution — sold/unsold/withdrawn/
held/reopened with amount + paddle; cleared by `LotOpened`; the ceremony's
input), `recoveries` (count of `AuctionRecovered`). New fail-closed reasons:
`malformed_invite` · `unknown_invite` · `malformed_grant` · `malformed_reopen`.

**BidInvalidated (updated).** Now emitted by BOTH the frozen-leader requeue AND
the compensating undo (`reason:"undo"`); the bid ROW transitions to
`invalidated` — voided-but-visible, forever.

---

## v1.3 — CERTIFICATION (M-IP4-4) · **CATALOG CLOSED**

**28 event types. The set is FROZEN.** The reducer fails closed on anything else
(`unknown_event_type`) — which is also why an older engine reading a newer log
**halts loudly** instead of mis-folding it. Adding an event type is an ADR.

### The bid ledger is now replayed (defect D-2)

The `bids` table is a projection of `BidAccepted`/`BidInvalidated` — and it is the
row the gavel reads the **sale price** from (`leadingBidOf` → `soldPrice` → the
`LotSold` event). Until M-IP4-4 the reducer did not model it, so those rows were
outside projection verification: a corrupted bid row would have been **sold at the
corrupted price**, with the lie then written into the immutable log as history.

The reducer now folds a `bids` projection, so the money rows can be verified
against the log on every command:

| Event | Additional replay effect (v1.3) |
|---|---|
| `BidAccepted` | records the bid `{lotId, paddleId, amount, status:"accepted"}` **and demotes the previous leader to `outbid`** — mirroring exactly what the aggregate writes to the rows, so the two can be compared |
| `BidInvalidated` | the bid → `invalidated` (voided-but-visible). An id the log never accepted fails replay closed (**`unknown_bid`**) |

**Projection addition (v1.3):** `bids: Record<bidId, {lotId, paddleId, amount, status}>`.

**Replay integrity — the complete closed set of fail-closed reasons:**
`sequence_gap` · `unknown_event_type` · `illegal_replayed_transition` ·
`malformed_*` · `unknown_lot` · `unknown_paddle` · `unknown_invite` ·
**`unknown_bid`** · `timer_shrank`.

**Certified:** a bid amount tampered with directly in the database now **halts the
engine** (`bid …: amount diverged (rows=X events=Y)`) and is **healed from
`BidAccepted`** by `RecoverAuction`. See [SECURITY](SECURITY.md) §4,
[DIAGNOSTICS](DIAGNOSTICS.md) §3.

### The paddle rows are now verified (defect D-3)

`PaddleReleased` additionally records the **release timestamp** on the projection
(`PaddleProjection.releasedAtMs`, from the event's `atMs`) so recovery can heal the
`paddles.released_at` column precisely. The `paddles` table gates authorization
(`personId`) and purse/squad/role attribution (`teamId`); it is now verified
against `PaddleIssued`/`PaddleReleased` on every command, and healed on recovery.
See [SECURITY](SECURITY.md) §4, [RECOVERY](RECOVERY.md).
