# M-IP4-1 MILESTONE REPORT · AUCTION ENGINE FOUNDATION

## IP-4 Auction Engine · 2026-07-14 · CTO · Awaiting founder review

## 1 · What was built

The architectural foundation of the Auction Engine — deliberately almost no
visible functionality; every invariant that money, bidding, timing, recovery
and fairness depend on is now frozen and machine-enforced:

- **`packages/core/src/auction.ts`** — the pure heart: the three state machines
  (Auction `scheduled → live ⇄ paused → completed → reconciled | abandoned`;
  Lot `prepared → queued → on_block ⇄ closing_soon → sold | unsold | frozen`,
  requeue per policy, withdraw pre-block; Bid record `accepted → outbid →
  invalidated`) with typed guards and machine DESCRIPTORS as the single source
  for tests, docs and UI; the **doc-41 bid gauntlet** (eleven ordered checks,
  exact codes); the **increment ladder** (flat/slabs, exact rung membership);
  the **deterministic timer + auto-extension** (never shrinks, capped, hold/
  resume, server-time injected); **AuctionConfig** with doc-41 defaults, locked
  at creation; the **event model** (21-type closed catalog) and the **pure
  replay reducer** — fail-closed on gaps, unknown types, illegal replays and
  shrinking timers.
- **Money VO extension** (additive to the C-7 module): `comparePaise`,
  `multiplyPaise`, bijective `serializePaise`/`parsePaise`. Integer paise
  everywhere; no float touches money.
- **`packages/db` migration 0008** — `auctions`, `paddles`, `lots`,
  `bids`, `auction_events` (append-only log, unique per-auction seq = the
  single-writer total order), RLS `USING`+`WITH CHECK` from day one.
- **`apps/web/src/server/auction/`** — the **AuctionReady projection** (the
  sole gateway; consumes ScheduleSnapshot + approved-registration projections
  only — the IP-3 freeze condition discharged structurally); the **Auction
  aggregate** (create/paddles/open/pause/resume/complete/abort/lot lifecycle/
  bids/recover — every mutation = pure decision → one transaction with row
  updates + one immutable event + one correlated audit row); read models;
  `auction.conduct`-gated actions.
- **Founder demo surface** `/competitions/[slug]/auction`: the ready checklist,
  creation, paddles, the deterministic lot queue, all three machines rendered
  from core's descriptors, the event log with a live replay-verification
  button, and a computed timer worked example. No bidding UI exists.

## 2 · What was verified (all green, local)

| Gate | Result |
| --- | --- |
| TypeScript | ✓ strict, 7/7 workspaces, zero suppressions |
| Lint | ✓ 0 errors, 7/7 |
| Unit | ✓ **169** — core **110** (auction machines/gauntlet/ladder/timer/replay/config **35** new; money 7 incl. VO extension) · ui 52 · engine 5 · contracts 2 |
| Integration (PG17) | ✓ **99** — **auction foundation 24** (AuctionReady gate, deterministic lot prep, immutable paddles, lifecycle guards + illegal transitions, gauntlet with evidence for accepted AND rejected bids, replace semantics, sold-terminal, unsold/requeue policy, frozen non-blocking, event contiguity, audit correlation, replay = persisted, recovery heal, corrupted-log fail-closed, abort + re-create, RLS READ+WRITE proofs, duplicate-seq loud failure) · all 75 prior tests unchanged |
| E2E (real Chrome) | ✓ 46 — new foundation journey (ready gate → create → paddles → queue → open/pause/resume → replay proof → machines + timer viz) + **axe zero** on the auction page; 44 prior specs unchanged |
| Boundaries | ✓ dep-cruiser 0 violations / 413 modules; dependency direction Auction→Competition one-way |
| Migrations | ✓ 0000–0008 apply idempotent; RLS enabled+forced+both-policies confirmed on all five auction tables |
| Build | ✓ production clean; /auction route 114 kB first-load |

## 3 · Engineering decisions

- **Event log = source of truth, rows = healable projections** (dual-write in
  one transaction; recovery replays and heals FROM events). See ADRS.
- **Single-writer order enforced structurally**: unique `(auction_id, seq)` —
  concurrent writers fail loudly; the dedicated engine process (M-IP4-2)
  inherits the same log and invariant.
- **`bigint` money columns + epoch-ms timer columns**; int8 aggregates parsed
  exactly from driver strings — no float ever touches a money path.
- **Machine descriptors exported from core** — code, tests, docs and the demo
  UI render the same edge tables; diagrams cannot drift from truth.
- **One additive change to frozen Competition**: `basePriceBand` surfaced on the
  registration projection row (a new read-model field — the sanctioned additive
  path; no invariant touched).

## 4 · Domain decisions (flagged for the founder)

- **Paddle = a person bidding FOR a team.** The directive's chain (Competition →
  Auction → Person) is refined with the canon's per-team money model (doc 41):
  `(auction, team)` unique, immutable, `P01…`. Conductor-held this milestone;
  owner claims arrive with live bidding.
- **`reconciled` declared, not reachable** — the machine carries doc 39's
  post-settlement state and edge now so IP-6 adds an operation, never a state.
- **Frozen lots never block the night** (invariant 19): a frozen lot releases
  the block; it only blocks declaring the auction COMPLETE.
- **Rejected bids are events, not rows** — evidence without record pollution;
  accepted bids are immutable rows anchored to their event seq.

## 5 · Architecture decisions

Five ADRs shipped (docs/auction/ADRS.md): EventLogSourceOfTruth ·
SingleWriterSeq · AuctionReadyGateway · PaddleTeamIdentity · DeterministicTimer.
Deliverables complete: ARCHITECTURE (with machine diagrams), EVENT_CATALOG
(closed 21-type set + replay integrity), RECOVERY (fold → diff → heal,
fail-closed), MONEY specification, API surface, IP-4_DESIGN (phase plan).

## 6 · Risks

- **Seq allocation under real concurrency** currently fails loudly rather than
  queues — correct but not graceful; the M-IP4-2 single-writer engine process
  is the designed resolution (recorded in ADR-SingleWriterSeq).
- **`LotClosingSoon` runtime is timer-derived** and arrives with live timers;
  the machine edge + replay handling exist and are tested now.
- **RLS still not load-bearing in the serving path** (carried since IP-2; now
  spans IP-2+IP-3+IP-4 tables) — the same named pre-deploy item.
- No git remote yet — all gates local.

## 7 · Founder demonstration (~4 minutes, everything local)

From a registration-closed competition with an approved pool and two teams:
**Auction** → watch the AuctionReady checklist pass → **Create auction** (lots
appear instantly in deterministic order with band prices) → issue paddles P01/
P02 → **Queue all** → **Open auction** → pause/resume → press **"Replay events
& verify state"** and read "projection matches persisted state exactly" → scroll
the three frozen state machines and the anti-snipe worked example. The exact
e2e-proven journey, 46/46 green. No bidding — by design.

## 8 · Recommended founder decision

**APPROVE M-IP4-1** and authorize **M-IP4-2 (Live Bidding)** — the single-writer
engine process, WebSockets, live timers/watchdog, owner paddle claims and the
real bidding surfaces, all on this frozen skeleton. One decision is genuinely
yours: confirm the **paddle model** (one paddle per TEAM, held by a person) —
it hardens into every bidding, purse and ceremony surface from M-IP4-2 onward.
