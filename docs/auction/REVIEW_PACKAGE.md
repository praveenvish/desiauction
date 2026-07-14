# IP-4 REVIEW PACKAGE

## DesiAuction NEXT · v1.0 · 2026-07-14 · CTO · **Freeze candidate** (M-IP4-4)

> Everything a reviewer needs to accept or reject the freeze, in one place.
> Claims here are backed by runnable evidence; nothing is asserted from memory.

## 1 · What is being frozen

The **Auction platform** becomes infrastructure: the domain (machines, gauntlet,
ladder, timer, replay reducer), the aggregate, the engine (single writer, command
queue, watchdog), the event log, the **AuctionSnapshot wire contract**, the
ledger, recovery, diagnostics, and the capability model.

After the freeze, downstream phases (Settlement, Wallet, Payments, Notifications,
Analytics, Match Ops) **consume** Auction. They do not modify auction rules.

## 2 · How to verify this package yourself

```bash
docker compose up -d db
pnpm install
pnpm verify                                       # lint · typecheck · unit · format · boundaries
pnpm test:integration                             # 163 tests vs live PG17
pnpm --filter @desiauction/web exec playwright test   # 48 e2e, real Chrome, axe
pnpm --filter @desiauction/engine perf:scale      # the performance matrix
pnpm --filter @desiauction/engine db:migrate      # idempotent; run it twice
```

## 3 · Gate evidence

| # | Gate | Evidence |
|---|---|---|
| 1 | Type safety | `tsc --strict` clean, 8/8 workspaces, zero suppressions in source |
| 2 | Lint | 0 errors, 8/8 workspaces (`--max-warnings 0`) |
| 3 | Unit | **208** — core **147** · ui 52 · engine 7 · contracts 2 |
| 4 | Integration | **161 vs live PG17** — engine **62** (certification **30**, live-engine 15, conduct-ceremony 17) · web 99 |
| 5 | E2E / a11y | **48 Playwright**, real Chrome; axe **zero violations** on cockpit, stage, owner room, replay, ledger |
| 6 | Performance | Measured matrix: lots 100→2500, spectators 50→1000 — [PERFORMANCE](PERFORMANCE.md) |
| 7 | Boundaries | dep-cruiser **0 violations**, 485 modules, 1385 dependencies |
| 8 | Migrations | Idempotent (applied twice, clean) |
| 9 | Build | Production build clean (web + engine) |
| 10 | Determinism | Two independent engines → **byte-identical** snapshots; 10 folds → 1 hash |

## 4 · Defects found and fixed during certification

Certification is only worth something if it *finds* things. It found three, all
by attacking the platform rather than re-running its own happy path — the third
(**D-3**) by an independent hostile audit that re-attacked the very claim the D-2
fix had just declared true.

### D-1 · Undo after a requeue wrote an unreplayable event — **freeze-blocking**

**Severity:** catastrophic, unrecoverable, reachable by ordinary conduct.

A lot goes UNSOLD → the conductor requeues it → the conductor changes their mind
and hits **Undo**. `decideUndo` only closed the undo window on `LotOpened`, so it
happily targeted the superseded resolution and wrote `LotReopened` onto a lot that
replay sees as `queued`. The reducer rejects that transition — so the event log
**stopped folding at that seq, permanently**. And because **recovery *is* a
replay**, `RecoverAuction` failed too. The auction was **bricked forever**.

Proved live before the fix:

```
TAIL: 17:LotOpened  18:LotUnsold  19:LotRequeued  20:LotReopened
REPLAY AFTER UNDO: FAILED illegal_replayed_transition @seq 20
```

**Fix** (`packages/core/src/auction.ts`): the undo window now also closes when the
**target lot itself** has been requeued, withdrawn or frozen since it resolved.
The check is **per-lot**, so acting on an unrelated lot never blocks a legitimate
undo. Defence in depth: `undoLastAction` re-checks the lot's row status before
writing, so no caller can write an unreplayable compensating event.

**Regressions:** 4 pure-core (`auction-conduct.test.ts`) + 2 integration —
including one that asserts the *poisoned* event is rejected by the reducer, so the
mechanism that made this catastrophic is itself pinned.

### D-2 · The money rows were outside the watchdog — **freeze-blocking**

**Severity:** silent money corruption.

`diffProjection` verified the auction status and the lot rows — but **not the
`bids` table**, which is the row the gavel reads the **sale price** from
(`leadingBidOf` → `soldPrice` → the `LotSold` event). A corrupted bid row would
therefore be **sold at the corrupted price**, and the lie written into the
immutable log as history. Proved live: a bid amount doubled directly in the
database, engine restarted → `HALTED: null`. **The watchdog did not notice.**

**Fix:** the replay reducer now folds the **bid ledger** (`BidAccepted` demotes
the previous leader to `outbid`; `BidInvalidated` voids), so bid rows can be
verified against the log. `diffProjection` now checks every bid row's **amount,
paddle, lot and status** (plus rows missing from the log, and events missing a
row), and `recoverAuction` **heals bid rows from the events**.

After the fix, the same attack yields:

```
HALTED: "projection_mismatch:bid …: amount diverged (rows=2000000 events=1000000)"
```

…and `RecoverAuction` restores the true amount from `BidAccepted`.

**Regressions:** 3 pure-core + 3 integration drills (tampered amount; re-crowned
losing bid; healed from log).

### D-3 · The paddle rows were outside the watchdog — **freeze-blocking**

**Severity:** silent authorization hijack + purse misattribution. **Found by the
independent hostile audit, after D-1 and D-2 were already closed and the first
freeze recommendation had been made.**

D-2 fixed the bid rows and declared the rule "every row the engine reads is
verified." The audit re-attacked that exact claim and found it false for the
sibling **`paddles` table** — which `diffProjection` never checked. The engine
reads the paddle row on the bid hot path: `personId` gates *who* may bid
(`holder = paddle.personId === actor`), `teamId` attributes every bid and sale to
a purse/squad/role, and `releasedAt` gates whether it may bid at all. Proved live:
reassigning a paddle's `personId` in the database, then restarting the engine →
`halted: null`. **A stranger could be handed a paddle and the watchdog would never
notice.**

**Fix:** the reducer already folded the paddle identity; it now also records the
exact release timestamp (`releasedAtMs`). `diffProjection` verifies every paddle
row's **team, person, number and release state** (plus paddles missing a row), and
`recoverAuction` **heals them from `PaddleIssued`/`PaddleReleased`**. Lot
`roundsUsed` (the requeue-policy counter, already folded) was verified in the same
change.

After the fix:

```
HALTED: "projection_mismatch:paddle …: person diverged"
```

…and `RecoverAuction` restores the true `personId` from `PaddleIssued`.

**Regressions:** 2 pure-core (reducer records the release timestamp) + 3 integration
drills (person hijack; release-flag tamper; rounds tamper — each halt → heal).

### Rejected: a change that was *not* a defect

Certification also flagged that voided bids remain in the snapshot's
`bidHistory` with no `voided` marker, and I began "fixing" it. An existing test
asserted the opposite, with an explicit comment: *"voided-but-VISIBLE… the history
rides the snapshot for everyone to see."* That is a **deliberate M-IP4-3
transparency decision**, it carries **no money impact** (`decideBid` and
`nextMinimumBid` read the *leading* amount, which the reducer clears on reopen),
and changing it would be a **new business rule** — which this milestone forbids.

**The change was reverted.** It is recorded instead as a certified constraint
([SNAPSHOT](SNAPSHOT.md) §5, C-2) with an additive remedy deferred to post-freeze.
Certification must not smuggle design changes in under the banner of "defect".

## 5 · The determinism claims, and how each is proved

| Claim | Proof |
|---|---|
| Two independent engines → byte-identical snapshots | Two `AuctionEngine` instances, no shared memory, load the same log → identical `serialized`, identical SHA-256, identical `version` |
| Deterministic serialization | Canonical JSON (sorted keys); source key order cannot change the bytes |
| Hash stability | 10 independent folds → **1** snapshot hash, **1** projection hash |
| No clock in the snapshot | Two builds 25 ms apart → identical bytes (`serverNowMs` lives on the transport envelope) |
| Recovery equality | Kill + restart → byte-identical snapshot from the log alone |
| Ledger regeneration equality | Build twice → byte-identical; every prior row unchanged after a new event |
| Replay fails closed | sequence gap · unknown type · illegal transition · shrinking timer · unknown bid — each stops the fold at the offending seq |

## 6 · Remaining risks (none freeze-blocking)

1. **Broadcast volume is the binding constraint.** Full snapshot × every spectator
   × every event. 2 500 lots × 1 000 spectators ≈ **359 MB per event** — not
   viable. The certified envelope ([PERFORMANCE](PERFORMANCE.md) §5) stays inside
   it. Remedy (delta frames) is **wire-breaking** and correctly deferred.
2. **Command latency is O(events)** — a full re-fold after every command. 60 ms p95
   at 2 500 lots today; the *trend* is the risk. Remedy (snapshot checkpointing) is
   internal, non-breaking, and touches no auction rule.
3. **A forged event log cannot be detected** (A6). Recommend hash-chaining
   (`prev_hash` per event) post-freeze; mitigations today are operational.
4. **Idempotency cache is per-process** — safe, because the gauntlet is the real
   guard; documented as defence in depth.
5. **`auction.override` is a powerful grant.** Undo is bounded and loud, but
   prevention is not possible; grant it narrowly and review `UNDO` ledger rows.

## 7 · What a downstream phase may and may not do

**May:** read the ledger, read snapshots, consume `AuctionCompleted` outcomes,
add new capabilities and surfaces, add new tables that reference auction ids.

**May not:** write to `auction_events`; add a second source of truth for money;
mutate lots/bids/paddles outside the aggregate; add a second writer to an auction;
change the bid gauntlet, the timer model, or the state machines; require a change
to the snapshot contract to function.

If a downstream phase *needs* one of these, that is an **ADR and a thaw**, not a
patch.
