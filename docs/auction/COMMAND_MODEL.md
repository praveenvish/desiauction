# AUCTION COMMAND MODEL

## DesiAuction NEXT · v1.0 · 2026-07-14 · CTO · **FROZEN** (IP-4, M-IP4-4)

> The complete, closed set of auction commands. Every mutation of a live auction
> is a command submitted to the engine; the engine processes commands **strictly
> serially per auction** (the single writer, C-9). Every command receives an
> `Accepted` or `Rejected` ack with a deterministic reason — there are no silent
> failures and no fire-and-forget writes.
>
> Companions: [ARCHITECTURE](ARCHITECTURE.md) · [EVENT_CATALOG](EVENT_CATALOG.md) ·
> [SNAPSHOT](SNAPSHOT.md) · [SECURITY](SECURITY.md) · [API](API.md).

## 1 · The command path (one shape, no exceptions)

```
web tier (capability gate)  →  HTTP POST /command (shared secret)
   →  per-auction FIFO queue          ← the single writer is a fact of the process
      →  idempotency check (commandId → original ack)
      →  halt check (halted ⇒ everything except RecoverAuction is refused)
         →  execute: pure core decides → ONE transaction (rows + ONE event + ONE audit row)
            →  rebuild: re-fold the log → verify rows → rebuild snapshot
               →  broadcast (WebSocket, snapshots only)
```

The browser never reaches the engine. Capabilities are resolved by the **web
gate**, which passes the verdict (`conduct`, `override`) on the envelope; the
engine trusts its authenticated caller and never trusts a browser claim.

**Fail-closed:** if the post-command rebuild detects a replay failure or a
projection divergence, the auction **halts**. Every subsequent command is
rejected with `engine_halted` until `RecoverAuction` heals it. A lying snapshot
is never served.

## 2 · The envelope

| Field | Meaning |
|---|---|
| `commandId` | **Idempotency key.** Resubmitting returns the ORIGINAL ack; it never re-executes. |
| `auctionId` | The queue this command serializes into. |
| `type` | One of the 20 types below. Anything else → `unknown_command`. |
| `actor` | Person ULID. Recorded on the event and the audit row. |
| `conduct` | The web gate resolved `auction.conduct` on this actor. |
| `override` | The web gate resolved `auction.override`. Required by `UndoLastAction` only. |
| `payload` | Per-command; validated before the aggregate is touched (`invalid_payload`). |

## 3 · The commands

Authority column: **conduct** = requires `auction.conduct`; **holder** = the actor
must hold the paddle; **grant** = requires an unrevoked paddle grant.

| Command | Authority | Validation | Transition | Events | Ledger | Recovery behaviour |
|---|---|---|---|---|---|---|
| `InviteOwner` | conduct | team ∈ competition; auction not terminal | — | `OwnerInvited` | "Owner invited" | replayed into `ownerInvites` |
| `AcceptOwnerInvite` | actor = invitee | invite exists, unrevoked, unexpired, unclaimed | — | `OwnerAccepted` | "Owner invitation accepted" | replayed; re-accept by same person is idempotent |
| `GrantPaddle` | conduct | person is an ACCEPTED owner of the team | — | `PaddleGranted` | "Paddle grant issued" | replayed into `paddleGrants`; re-grant idempotent |
| `ClaimPaddle` | grant | unrevoked grant; no other active paddle for the team | — | `PaddleIssued` | "Paddle Pnn issued" | replayed; claiming your own paddle is idempotent |
| `IssuePaddle` | conduct | team ∈ competition | — | `PaddleIssued` | "Paddle Pnn issued" | replayed |
| `ReleasePaddle` | holder or conduct | an active paddle exists | — | `PaddleReleased` | "Paddle released" | replayed; a released paddle can never bid again |
| `QueueLots` | conduct | — (bulk ≡ N singles; refusals skipped) | `prepared→queued` ×N | `LotQueued` ×N | "Lot queued" ×N | replayed per lot |
| `OpenAuction` | conduct | **≥2 paddles · ≥1 queued lot** | `scheduled→live` | `AuctionOpened` | "Auction opened" | replayed |
| `OpenLot` | conduct | auction `live`; **block empty**; lot `queued` | `queued→on_block` | `LotOpened` | "Lot on the block" | replayed; opening window restored from the event |
| `PlaceBid` | holder or conduct | **the doc-41 gauntlet, 11 ordered checks** | — (lot may flip `closing_soon→on_block`) | `BidAccepted` (+`TimerExtended`) **or** `BidRejected` | "Bid accepted" / "Bid rejected · CODE" | replayed; rejected bids are evidence, never rows |
| `CloseLot` | conduct | leading bid ⇒ sell, else pass | `→sold` / `→unsold` | `LotSold` / `LotUnsold` | "SOLD" / "UNSOLD" | replayed |
| `HoldLot` | conduct | lot on block | `→frozen` | `LotHeld` | "Lot frozen" | replayed; remaining runway frozen |
| `RequeueLot` | conduct | unsold policy allows (rounds) | `unsold\|frozen→queued` | `LotRequeued` (+`BidInvalidated`) | "Lot requeued" | replayed; round counted, leader cleared |
| `WithdrawLot` | conduct | lot `prepared`/`queued` | `→withdrawn` | `LotWithdrawn` | "Lot withdrawn" | replayed |
| `PauseAuction` | conduct | auction `live` | `live→paused` | `AuctionPaused` (+`TimerHeld`) | "Auction paused" | **pause is TOTAL** — the open lot's runway freezes with it |
| `ResumeAuction` | conduct | auction `paused` | `paused→live` | `AuctionResumed` (+`TimerResumed`) | "Auction resumed" | the held remainder re-attaches to server now |
| `CompleteAuction` | conduct | **zero unresolved lots** | `→completed` | `AuctionClosed` | "Auction completed" | replayed |
| `AbortAuction` | conduct | non-terminal | `→abandoned` | `AuctionAborted` | "Auction aborted" | replayed; ledger freezes as-is |
| `UndoLastAction` | **conduct AND override** | window open (§4) | `sold\|unsold→on_block` | `BidInvalidated` + `LotReopened` | "UNDO — lot reopened (compensates #n)" | replayed; purse restores by projection |
| `RecoverAuction` | conduct | — (the only command legal while halted) | rows healed FROM events | `AuctionRecovered` | "Engine recovered — n divergence(s)" | see [RECOVERY](RECOVERY.md) |

### Internal commands (engine-only; never accepted from transport)

| Command | Actor | Trigger |
|---|---|---|
| `_TimerClose` | `ENGINE_ACTOR` | watchdog tick: `now ≥ endsAtMs` → close (sold/unsold by leading bid) |
| `_ClosingSoon` | `ENGINE_ACTOR` | watchdog tick: remaining ≤ extension window → `on_block→closing_soon` |

Both enter the **same FIFO queue** as human commands. This is why the timer can
never race a bid: expiry and bidding are totally ordered by the single writer.
Their `commandId` is derived (`timer-close-{lotId}-{endsAtMs}`), so repeated
ticks before processing dedupe through the idempotency cache.

## 4 · The undo window (doc 41 · certification-hardened)

Undo is the **highest-friction action in the platform**: it requires `conduct`
AND `override`, and it never deletes history — it writes *compensating* events.

The window is closed when **either**:

1. **another lot has opened** since the resolution (`LotOpened`/`LotReopened`) —
   doc 41's rule; or
2. **the target lot has itself been acted on** since it resolved
   (`LotQueued`/`LotRequeued`/`LotWithdrawn`/`LotHeld`) — added by certification.

Rule 2 closes **defect D-1**. Without it, `UndoLastAction` after a requeue wrote
a `LotReopened` event onto a lot that replay sees as `queued`. The reducer
rejects that transition, so the event log **stopped folding** — and because
recovery *is* a replay, the auction could never be recovered again. One ordinary
conductor sequence (lot goes unsold → requeue it → change your mind → Undo)
permanently bricked the auction. The check is per-LOT, so acting on an unrelated
lot never blocks a legitimate undo.

Defence in depth: `undoLastAction` re-checks the target lot's row status before
writing, so no caller can write an unreplayable compensating event even if
`decideUndo` were to regress.

## 5 · Rejection reasons (closed set — every one is deterministic)

`unknown_command` · `unknown_auction` · `engine_halted` · `not_authorized` ·
`illegal_transition` · `guard_failed` · `not_found` · `auction_not_live` ·
`another_lot_open` · `paddle_held` · `no_active_paddle` · `no_grant` ·
`unknown_team` · `invalid_payload` · `replay_failed` · `terminal_auction` ·
`undo_window_closed` · `nothing_to_undo` · `already_accepted` · `expired`

Plus the eleven **doc-41 bid codes** returned by `PlaceBid`: `LOT_NOT_OPEN` ·
`NOT_AUTHORIZED` · `ALREADY_LEADING` · `INVALID_AMOUNT` · `BELOW_BASE` ·
`BELOW_CURRENT` · `INVALID_INCREMENT` · `BUDGET_EXCEEDED` · `RESERVE_VIOLATION` ·
`SQUAD_FULL` · `ROLE_LIMIT`.

## 6 · Idempotency (and why money is safe without it)

The ack cache (`commandId → ack`, 512 entries per auction, in-memory) returns the
original acknowledgement for a duplicate command and never re-executes it.

**Certified constraint:** the cache is **per-process**. After an engine restart it
is empty, so a command replayed across a restart *would* re-execute. This is
safe, and certification proved why: the money path does not depend on the cache.
A duplicate `PlaceBid` is refused by the gauntlet itself — the same team is
already leading (`ALREADY_LEADING`), or the amount no longer clears the current
bid (`BELOW_CURRENT`). Idempotency is **defence in depth; the gauntlet is the
guard.** See [SECURITY](SECURITY.md) §4.

## 7 · Evidence

`apps/engine/src/integration/certification.integration.test.ts` — every
conduct-only command refuses a non-conductor (a loop over all 15, no exceptions);
undo demands conduct AND override; a paddle cannot be driven by a person who does
not hold it; unknown commands are refused before the aggregate; duplicate
`commandId` returns the original ack and writes exactly one bid row; ten
simultaneous bids at the same price produce exactly one winner.
