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
| `GET /ws?auction&ticket` | windowed HMAC ticket (bounded ≤ 48h) | Snapshot broadcast: full snapshot on join, then every change + 10s heartbeats |
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

---

## v1.2 · Conduct & Ceremony (M-IP4-3)

## Commands (additions to the closed set)

`OpenAuction` · `IssuePaddle{teamId, personId}` (manual mode) ·
`WithdrawLot{lotId}` · `HoldLot{lotId}` · `RequeueLot{lotId}` ·
`InviteOwner{teamId, tokenHash, expiresAtMs}` ·
`AcceptOwnerInvite{inviteId}` · `GrantPaddle{teamId, personId}` ·
`UndoLastAction{reason?}` — conduct-only except AcceptOwnerInvite (any
authenticated actor; validated against the invitation row); UndoLastAction
additionally demands `override` on the envelope (`auction.override`, resolved
by the web gate). `ClaimPaddle` now refuses without an active grant
(`no_grant`). The generic web gateway BLOCKS `InviteOwner`/`AcceptOwnerInvite`
(token flows live in dedicated actions — the raw token never transits the
gateway). New reject reasons: `no_grant` · `not_an_owner` · `already_accepted`
· `expired` · `unknown_invite` · `nothing_to_undo` · `undo_window_closed`.

## Engine transport (additions)

| Endpoint | Auth | Behavior |
|---|---|---|
| `GET /diagnostics/:auctionId` | `x-engine-secret` | Read-only diagnostics: version/eventCount, halted reason, queue depth, processed/accepted/rejected, avg/max/last processing ms, commands-per-minute, replay/recovery durations, broadcast latency, sha-256 snapshot + projection hashes, recoveries, watchdog (tick age/drift/stalled), connected clients, WS heartbeat age (contract: `engineDiagnosticsSchema`) |

## Web actions (M-IP4-3)

| Action | Capability | Behavior |
|---|---|---|
| `cockpitView(slug)` | `auction.conduct` | The cockpit seed: auction view, owner board, teams, ws URL, viewer flags (incl. `canOverride`) |
| `spectatorView(slug)` | membership | Names + ws URL ONLY — no teams, no flags, no diagnostics |
| `ledgerView(slug)` | `auction.conduct` | The AuctionLedger, regenerated from events (+ generation ms) |
| `replayViewerData(slug)` | `auction.conduct` | Events + refs + the engine's current serialized snapshot (comparison target) |
| `engineDiagnosticsAction(slug)` | `auction.conduct` | Zod-validated proxy to `/diagnostics` |
| `inviteOwnerAction(slug, teamId)` | `auction.conduct` | Mints the one-time token (hash → InviteOwner command), returns `/owner-join/<token>` |
| `ownerJoinPreview(token)` / `acceptOwnerJoin(token)` | session | Preview without consuming; accept = org membership (audited) + AcceptOwnerInvite command |
| `grantPaddleAction(slug, teamId, personId)` | `auction.conduct` | GrantPaddle command |
| `submitAuctionCommand(...)` | per-command | The single gateway — now resolves `override` and blocks token-flow commands |

**Setup actions rewired.** `auctionLifecycleAction`, `queueAllLotsAction`,
`issuePaddleAction`, `verifyReplayAction` now SUBMIT COMMANDS (OpenAuction /
Pause / Resume / Complete / Abort, QueueLots, IssuePaddle, RecoverAuction) —
`lotLifecycleAction` is gone (lot conduct lives on the cockpit through the
gateway); `createAuctionAction` alone still calls the aggregate (creation
precedes live state). The engine reset nudge (`notifyEngineReset`) is deleted.

---

## FROZEN (M-IP4-4)

The auction API surface is **frozen**. The full command contract — authority,
validation, transition, events, ledger impact and recovery behaviour for each of
the 20 commands — is specified in [COMMAND_MODEL](COMMAND_MODEL.md). The wire
contract every surface renders is specified in [SNAPSHOT](SNAPSHOT.md).

### Engine endpoints (web-tier only — `x-engine-secret`, constant-time compared)

| Endpoint | Purpose |
|---|---|
| `POST /command` | the single mutation gateway; returns a deterministic `CommandAck` |
| `GET /snapshot/:auctionId` | current snapshot bytes; **409 while halted** — a lying snapshot is never served |
| `GET /diagnostics/:auctionId` | counters + hashes only; never payloads, never secrets ([DIAGNOSTICS](DIAGNOSTICS.md)) |
| `GET /healthz` | `db` + `watchdog`; **503** if the timer authority has stalled |
| `POST /admin/reset` | drop in-memory state ≙ restart. **404 in production** |
| `WS /ws?auction=&ticket=` | **snapshots only**; windowed HMAC ticket (bounded ≤ 48h), constant-time compared |

**Stability contract.** Additive fields are a minor version. Removing or re-typing
a field, adding a command, or adding an event type is a **breaking change
requiring an ADR and a thaw** — downstream phases consume these surfaces and must
never need them changed.
