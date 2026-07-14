# AUCTION API SURFACE

## DesiAuction NEXT · v1.0 · 2026-07-14 · CTO · **Permanent engineering asset** (IP-4, M-IP4-1)

> Next server actions (internal RPC), source `apps/web/src/server/auction/`.
> One gate everywhere: session → membership-gated competition resolution →
> `auction.conduct` → aggregate. **No bidding endpoint exists this milestone**
> (stop condition): the bid aggregate (`placeBid`) is exercised by the
> regression suite and awaits M-IP4-2's live surfaces.

## Actions (`actions.ts`)

| Action | Capability | Behavior |
|---|---|---|
| `auctionDashboard(slug)` | membership (+`canConduct`) | AuctionReady checks + pool/teams, the auction view (paddles, lots, stats, last events), the three machine descriptors, the computed timer example |
| `createAuctionAction(slug)` | `auction.conduct` | Gated by a passing AuctionReady projection; locks the doc-41 default config; prepares the pool as lots (deterministic order, band-resolved bases); refuses if an auction already exists (unless abandoned) |
| `issuePaddleAction(slug, teamId)` | `auction.conduct` | One immutable paddle per team (`P01…`); conductor-held in M-IP4-1 |
| `auctionLifecycleAction(slug, command)` | `auction.conduct` | `open` (guard: ≥2 paddles, ≥1 queued lot) / `pause` / `resume` / `complete` (guard: no unresolved lots) / `abort(reason)` |
| `lotLifecycleAction(slug, lotId, command)` | `auction.conduct` | `queue` / `open` (live auction, one lot on the block; frozen never blocks) / `hold` / `sell` (guard: leading bid) / `pass` (guard: none) / `requeue` (guard: unsold policy) / `withdraw` (pre-block only) |
| `queueAllLotsAction(slug)` | `auction.conduct` | Bulk ≡ N singles, per-lot events |
| `verifyReplayAction(slug)` | `auction.conduct` | Runs `recoverAuction`: replay → diff → heal-from-events → `AuctionRecovered`; fail-closed on a corrupted log |

## Aggregate exports (server-side, for the future engine — not actions)

`createAuction` · `issuePaddle` · `transitionAuction` · `transitionLot` ·
`queueAllLots` · `placeBid` (the full doc-41 gauntlet; accepted → bid row +
`BidAccepted` + timer extension; rejected → `BidRejected` evidence, no row) ·
`recoverAuction` · `loadEvents`. Read models: `auctionOf`, `auctionView`,
`bidsOf`. Gateway: `auctionReady`.

## Error surface

Every action returns `{ ok, error? }` with human copy; the aggregate returns
typed reasons (`illegal_transition`, `guard_failed`, `not_found`,
`auction_not_live`, `another_lot_open`, `not_ready`, `auction_exists`,
`already_issued`, …) and bids return the doc-41 rejection codes verbatim —
codes-to-copy mapping is a surface concern (doc 21), never an engine one.

---

## v1.1 · The live surface (M-IP4-2)

## Engine transport (apps/engine)

| Endpoint | Auth | Behavior |
|---|---|---|
| `POST /command` | `x-engine-secret` | Submit an `AuctionCommandEnvelope`; returns the deterministic `CommandAck` |
| `GET /snapshot/:auctionId` | `x-engine-secret` | The current serialized snapshot (409 while halted) |
| `GET /ws?auction&ticket` | HMAC ticket | Snapshot broadcast: full snapshot on join, then every change + 10s heartbeats |
| `GET /healthz` | — | db + watchdog-stall checks, fail-closed 503 |
| `POST /admin/reset` | secret, non-production | Drop in-memory state (≡ restart); replay-on-load rebuilds |

## Commands (the closed set)

`ClaimPaddle{teamId}` · `ReleasePaddle{teamId}` · `QueueLots` · `OpenLot{lotId}`
· `PlaceBid{lotId, paddleId, amountRaw}` · `CloseLot{lotId}` (gavel — sell or
pass by leading bid) · `PauseAuction` / `ResumeAuction` (timer held/resumed) ·
`CompleteAuction` · `AbortAuction{reason}` · `RecoverAuction`. Conduct-only
commands require the web gate's `auction.conduct`; `PlaceBid` requires holding
the paddle (or conduct = doc 41 manual mode). Internal timer commands
(`_TimerClose`, `_ClosingSoon`) are engine-enqueued only — the transport
refuses them.

## Web live actions (`live-actions.ts`)

`liveAuctionView(slug)` — the live page's seed (ws URL + ticket, teams, my
active paddle, viewer flags). `submitAuctionCommand(slug, commandId, type,
payload)` — THE single command gateway: session → tenant → capability → engine;
the client mints `commandId` so retries are idempotent end to end.
