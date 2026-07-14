# M-IP4-2 MILESTONE REPORT · LIVE BIDDING ENGINE

## IP-4 Auction Engine · 2026-07-14 · CTO · Awaiting founder review

## 1 · What was built

The Auction Engine is operational: a deterministic real-time bidding system in
which every connected client converges to the identical AuctionSnapshot and
nothing weakens an M-IP4-1 invariant.

- **The dedicated engine process** (`apps/engine`): the only mutation authority
  for live auctions. Per-auction FIFO **command queue** (strictly serial — the
  single writer is now a process fact, backstopped by the unique event seq);
  command **idempotency** by `commandId` (duplicates return the original ack);
  after every command the engine re-folds the event log, verifies row
  projections, rebuilds and broadcasts the snapshot.
- **AuctionSnapshot** (core, pure): deep-frozen presentation projection —
  current lot, leader, bid history, queue, per-team purses, absolute
  `endsAtMs`, extension count, `version` = last event seq. Canonical JSON:
  identical events → identical bytes; no serialization timestamps (the server
  clock rides the transport envelope).
- **WebSocket transport**: snapshots only. HMAC tickets, full-snapshot replay
  on connect/reconnect, 10s heartbeats with dead-socket termination, version-
  based out-of-order rejection, graceful shutdown.
- **Live timer + anti-snipe execution**: the engine tick (250ms) is the timer
  authority — expiry closes lots in-engine (sold/unsold by leader, doc 41),
  closing-soon flips the machine state, and timer commands travel the SAME
  queue as bids (the timer cannot race a bid). Auction pause freezes the open
  lot's exact remainder (`TimerHeld`); resume re-attaches it (`TimerResumed`).
- **Watchdog**: stall detection on /healthz, tick-drift logging, and fail-closed
  halts on replay failure / projection mismatch / snapshot indeterminism —
  halted auctions reject every command except `RecoverAuction`, which heals
  rows FROM events and resumes.
- **Paddle claiming + owner console + live bidding UI**
  (`/competitions/[slug]/auction/live`): claim/release (immutable identity —
  one ACTIVE paddle per team via partial unique; released paddles never bid,
  numbers never reused), bid with acknowledgements, drift-corrected countdown
  rendering only, organizer conduct (open/close lot, pause/resume, complete,
  recover). Clients decide nothing.
- **`packages/auction`**: the shared aggregate moved out of the web tier
  (consumed by web AND engine — zero duplicated rules), extended with
  claim/release, gavel close, closing-soon, pause/resume timer events, and
  per-TEAM purse/fairness projections.

## 2 · What was verified (all fresh, this milestone)

| Gate | Result |
| --- | --- |
| TypeScript / Lint | ✓ strict + 0 errors, 8/8 workspaces (incl. the new package) |
| Unit | ✓ **124** — core 117 (snapshot determinism, canonical JSON, command set, anti-snipe replay regression) · engine transport 7 |
| Integration (PG17) | ✓ **116** — web 99 unchanged · **live engine 17**: 10-paddle concurrent bids (ONE accepted, nine explained with evidence), escalating burst serialization, duplicate-command idempotency, late bids after expiry, anti-snipe execution (never shrinks, no duplicate extension), timer pause/resume exactness (from the log, not wall clocks), watchdog expiry close + dedupe, broadcast ordering, snapshot byte-equality across instances, restart recovery (measured), projection healing after corruption, fail-closed halt + RecoverAuction, closing-soon bid regression |
| Playwright | ✓ **47** — the founder demonstration (organizer + 3 bidder browsers: claim → bid → outbid → last-second anti-snipe extension visible on every window → gavel → engine restart → reconnect → identical snapshot versions everywhere → complete) + all 46 prior specs (2 pre-existing axe flakes passed on retry AND in isolation) |
| Boundaries | ✓ 0 violations / 411 modules — packages/auction imports core+db only; apps never import each other |
| Build | ✓ production clean; /auction/live at 113 kB first-load; engine esbuild bundle clean |
| Migrations | ✓ 0000–0009 idempotent (0009: paddle claims — released_at + partial unique) |
| Replay / recovery / snapshot equality | ✓ regression-pinned AND measured (below) |

## 3 · Engineering decisions

- **The shared aggregate became `packages/auction`.** "No duplicated business
  rules" + "no component may bypass the engine" both hold: web setup surfaces
  and the engine call the same aggregate; live mutations flow only through
  engine commands; the transitional setup-surface writes nudge the engine
  cache (`/admin/reset`) and fully migrate onto commands in M-IP4-3.
- **Rebuild-verify after every command.** Correctness over responsiveness, as
  directed: the engine pays ~3ms to re-fold and verify the log per mutation and
  in exchange can NEVER serve a snapshot that disagrees with the ledger.
- **`/admin/reset` ≡ restart.** Engine state is a pure cache of the event log,
  so dropping it and replaying IS the restart path — the same code the founder
  demo and e2e exercise; no manual repair exists anywhere.
- **One defect found live and pinned** (the directive's discipline): the
  anti-snipe status flip (`closing_soon → on_block`) mutated rows without a
  replay-side effect — the watchdog HALTED the auction on the divergence
  exactly as designed. Fix: `TimerExtended` IS the extend edge in the reducer;
  now a core unit test + an engine regression test.

## 4 · Domain decisions

- **Fairness check 3 upgraded to TEAMS** (doc 41 verbatim: "team is not already
  leading") — a team that releases its paddle and claims another still cannot
  outbid itself; purse/squad/quota projections aggregate per team.
- **Paddle claims preserve immutability**: claim = a NEW paddle issuance;
  release = `released_at` + `PaddleReleased` (the identity row survives, its
  number is never reissued); one active paddle per team (partial unique).
- **Pause is total** (doc 39): the open lot's runway freezes with the auction
  and re-attaches exactly on resume — both through events, so reconnect and
  recovery restore the exact remaining time.
- **Any org member may claim and bid** this milestone; owner-scoped grants
  (team invitations) arrive with M-IP4-3 conduct work.

## 5 · Performance observations (measured — harness `pnpm --filter @desiauction/engine perf:live`)

| Path | median | p95 |
|---|---:|---:|
| PlaceBid command latency (queue → gauntlet → tx → re-fold → broadcast) | 6.1 ms | 7.4 ms |
| 10 simultaneous bids, full burst wall time (1 winner, 9 explained) | 56.7 ms | 83.9 ms |
| buildLiveSnapshot (load 213 events + fold + verify + refs) | 2.1 ms | 2.8 ms |
| Pure replay fold (213 events) | 0.1 ms | 0.1 ms |
| Engine recovery (restart → replay → snapshot) | 2.4 ms | 2.6 ms |
| Bid → **50 spectators** all converged (real WebSockets) | 7.3 ms | 9.2 ms |
| Bid → **200 spectators** all converged | 12.7 ms | 15.3 ms |

10 paddles stable under simultaneous fire (regression-pinned); 200 spectators
converge in ~13ms — comfortably beyond a local tournament hall. Recovery after
a kill is effectively instant (the log is small and the fold is 0.1ms).

## 6 · Risks

- **The setup surface still writes via the aggregate directly** (M-IP4-1
  contract) with a cache-nudge — full migration onto engine commands is named
  M-IP4-3 work.
- **Per-command re-fold is O(log length)** — trivial at auction-night scale
  (hundreds of events, 2-3ms); snapshot-checkpointing is the known lever if
  logs ever grow to tens of thousands.
- **Spectator auth is org-membership + HMAC ticket** — public/anonymous
  spectator mode is explicitly M-IP4-3 (stop condition here).
- RLS-in-serving-path and no-remote/CI carry unchanged.

## 7 · Founder demonstration (~10 minutes, everything local)

`docker compose up -d db && pnpm dev` (web + engine). Organizer: create the
competition → approve a pool → create the auction → invite 3 bidders → each
claims a paddle on **/auction/live** → queue lots, open the auction, **open the
lot** — every window shows the same countdown. Bidder A bids, B outbids, C bids
inside the final 15 seconds → **the timer extends on every screen at once**.
Organizer gavels → sold to C everywhere. Kill the engine process (Ctrl-C the
engine, or POST /admin/reset), restart → clients reconnect and **every browser
shows the identical snapshot version**; open the next lot and continue. No
divergence, no duplicated bids, no lost state — the exact 47/47-green e2e
journey.

## 8 · Recommended founder decision

**APPROVE M-IP4-2** and authorize **M-IP4-3 (Conduct & Ceremony)** — the
Cockpit, manual conduct mode, undo via compensating events, owner invitations,
spectator mode and the FLOODLIGHT ceremony, all on this now-operational engine.
One decision is genuinely yours: confirm that **any org member may claim a team
paddle** until owner invitations land (the current rule), or whether M-IP4-3
should gate claiming behind explicit owner grants from day one.
