# IP-4 CLOSURE REPORT — AUCTION PLATFORM

## DesiAuction NEXT · v1.0 · 2026-07-14 · CTO · **FREEZE CANDIDATE** (M-IP4-4)

> M-IP4-1 (foundation) · M-IP4-2 (live engine) · M-IP4-3 (conduct & ceremony) were
> approved. M-IP4-4 is certification: engineering stopped adding capability and
> set out to prove the platform deserves to become infrastructure.

## 1 · Mission outcome

The Auction platform behaves **deterministically** under normal operation,
recovery, replay, concurrency and failure — and, where it does not, it **halts
rather than lies**.

Certification found **three freeze-blocking defects**. All three were caught by
attacking the platform, not by re-running its own passing tests. All are fixed and
regression-locked. Full detail: [REVIEW_PACKAGE](REVIEW_PACKAGE.md) §4.

| | |
|---|---|
| **D-1** | `UndoLastAction` after a requeue wrote an **unreplayable event**, permanently bricking the auction (replay *and* recovery both fail closed on it, forever). Reachable by ordinary conduct on auction night. |
| **D-2** | The **`bids` table** — the row the gavel reads the **sale price** from — was outside projection verification. A corrupted bid row would be sold at the corrupted price, and the lie written into the immutable log as history. |
| **D-3** | The **`paddles` table** — which gates *who* may bid (`personId`) and attributes every bid and sale to a purse (`teamId`) — was outside projection verification. Reassigning a paddle was an **undetected authorization hijack** and a latent purse misattribution. Found by the **independent hostile audit** after D-1/D-2 were already closed. |

**Note on process:** D-3 was found *after* the first freeze recommendation, by an
independent review that assumed the prior certification was wrong until re-proven.
That it existed at all is the argument for hostile audit: D-2 fixed the bid rows
and declared the rule "every row the engine reads is verified" — but left the
sibling paddle rows uncovered. Re-attacking the exact claim, rather than trusting
it, is what exposed the gap.

A third finding was investigated and **deliberately rejected** as a design change
rather than a defect (voided bids visible in `bidHistory` — intentional, no money
impact). The in-progress change was reverted. Certification must not smuggle new
business rules in under the banner of "defect".

## 2 · Evidence summary

| Gate | Result |
|---|---|
| TypeScript (strict) | clean, 8/8 workspaces, zero suppressions |
| Lint | 0 errors (`--max-warnings 0`) |
| **Unit** | **211** (core 149 · ui 52 · engine 8 · contracts 2) |
| **Integration (live PG17)** | **163** (engine 64 incl. **31 certification drills** · web 99) |
| **E2E / accessibility** | **48** Playwright, real Chrome; axe **zero violations** |
| Boundaries | dep-cruiser 0 violations / 485 modules / 1385 deps |
| Migrations | **idempotent** (applied twice, clean) |
| Production build | clean (web + engine) |
| **Performance** | measured matrix, lots 100→2500 × spectators 50→1000 |
| **Determinism** | two independent engines → **byte-identical** snapshots |

**Total: 417 automated tests green.**

## 3 · Engineering decisions

**E-1 · The bid ledger belongs in the replay reducer.** The `bids` table is a
projection of `BidAccepted`/`BidInvalidated`, so the reducer — the single
authority on what the events say — now models it (`projection.bids`). Any other
placement would have meant a second source of truth for the most money-critical
rows in the system. This is what makes D-2's verification possible at all.

**E-2 · Projection verification covers every row the engine derives truth from.**
Auction status, lot rows (status, sale price, sold paddle, **rounds**), bid rows
(amount, paddle, lot, status), **and paddle rows (team, person, number, released)**,
plus rows missing from the log and events missing a row. If the engine reads it to
make a decision, the watchdog verifies it. This rule was proven the hard way: D-2
established it for bids, and D-3 — found by re-attacking the *claim itself* —
extended it to paddles. Completeness of this set is now the load-bearing
invariant, not any individual row.

**E-3 · Healable vs. unhealable is a deliberate, load-bearing distinction.**
Divergence between *derived rows* and the log is healed **from** the log.
Corruption *of the log itself* (a gap, an illegal transition) is **never** healed
— replay stops, no snapshot is served, and recovery refuses. The platform will not
invent history. This is C-2 ("zero silent failures") reduced to a mechanism.

**E-4 · Defence in depth on the compensating write.** `decideUndo` closes the
window (pure, testable), *and* `undoLastAction` re-checks the lot's row status
before writing. An unreplayable event should require two independent failures.

**E-5 · Certification harnesses are permanent assets.** `perf-scale.ts` and the
30-drill certification suite live in the repo and run in CI, not in a
one-off report. A claim that cannot be re-run is not evidence.

## 4 · Domain decisions

**D-1 · The undo window closes per-LOT, not globally.** Doc 41 says undo is
allowed "until the next lot opens". Certification added: **and until the target
lot is itself acted on** (requeued / withdrawn / frozen). Undoing a resolution the
conductor has already moved past is both semantically incoherent and physically
unreplayable. Scoping the check per-lot means acting on an *unrelated* lot never
blocks a legitimate undo — the rule is tightened exactly where it was unsound, and
nowhere else.

**D-2 · "Voided-but-visible" is confirmed canon.** Money reversed by an undo or a
requeue override stays visible — in the ledger permanently, and in the current
lot's `bidHistory`. Certification confirmed this is intentional and carries no
money impact. It is **not** changed under freeze.

**D-3 · No new business rules were added.** The bid gauntlet, the increment
ladder, the timer model, anti-snipe, the state machines and the purse/reserve/
squad/role rules are **byte-for-byte as approved in M-IP4-1..3**.

## 5 · Architecture decisions

**A-1 · The AuctionSnapshot wire contract is FROZEN.** Additive fields are a minor
version; removing or re-typing a field requires a new ADR and a thaw.
([SNAPSHOT](SNAPSHOT.md))

**A-2 · The command model is CLOSED.** 20 external command types + 2 internal
(timer) types. A new command is an ADR. Every conduct-gated command is enforced by
a regression that loops the whole list — adding one without a gate fails the
suite. ([COMMAND_MODEL](COMMAND_MODEL.md))

**A-3 · The event catalog is CLOSED.** 28 event types. The reducer fails closed on
anything else — which is also what makes an old engine reading a new log halt
loudly instead of mis-folding. ([EVENT_CATALOG](EVENT_CATALOG.md))

**A-4 · The ledger stays a pure fold, never a table.** Immutable and append-only
*by construction*: it cannot be forged because nothing can write to it, and it
cannot drift because it is re-derived from the log (0.5 ms for 5 063 rows).
([LEDGER](LEDGER.md))

**A-5 · One auction, one writer — permanently.** Not a scaling stage to be grown
out of. Horizontal scaling of a *single* auction is architecturally forbidden;
fast recovery (28.5 ms) is the availability answer instead of replication.

## 6 · Performance observations

Full matrix: [PERFORMANCE](PERFORMANCE.md).

- **Recovery is a non-risk:** full restart + replay of the largest certified
  auction (2 500 lots, 5 063 events) = **28.5 ms**. Ledger regeneration = **0.5 ms**.
- **The pure domain is free:** folding 5 063 events costs **1.7 ms**. The reducer
  is never the bottleneck; the round trip is.
- **Command latency is linear in auction size:** `PlaceBid` 7.4 ms @100 lots →
  **52.6 ms @2 500** (p95 60 ms), because every command re-folds the entire log.
  Comfortable today; **O(n²) per night** is the trend to watch.
- **Broadcast volume is the binding constraint:** the full snapshot goes to every
  spectator on every event. 359 KiB @2 500 lots × 1 000 spectators ≈ **359 MB per
  event** — not viable. The certified envelope stays well inside it:
  **recommended ≤500 lots / ≤250 spectators; ceiling 2 500 lots or 1 000
  spectators, never both.**

## 7 · Remaining risks (none freeze-blocking)

| # | Risk | Disposition |
|---|---|---|
| R-1 | Broadcast = snapshot × spectators × events | **Certified limit.** Remedy (delta frames / queue pagination) is **wire-breaking** — correctly deferred past the freeze, must be an ADR. Enforce the envelope at the web tier. |
| R-2 | Command latency O(events) → night is O(n²) | Remedy (snapshot checkpointing) is **internal and non-breaking**; no auction rule changes. Post-freeze backlog. |
| R-3 | A forged event log cannot be *detected* | Recommend **hash-chaining** the log (`prev_hash` per event). Today's mitigations are operational (restrict write access to the engine role; PITR/WAL; the independently-written audit trail). |
| R-4 | `auction.override` can repeatedly undo | Inherent to having undo. Bounded (most recent resolution only) and **loud** (permanent attributed ledger row). Detection, not prevention. Grant narrowly; review `UNDO` rows. |
| R-5 | Idempotency cache is per-process | Safe: the gauntlet refuses duplicate bids independently. Defence in depth. |
| R-6 | `QueueLots` holds the queue 4.7 s @2 500 lots | Pre-auction only; the runbook mandates queueing **before** opening. |
| R-7 | Voided bids unmarked in `bidHistory` | Intentional; no money impact. Additive wire fix deferred. |
| R-8 | No CI (repo has no remote) | Carried from IP-0. All gates run locally and are scripted (`pnpm verify`). Founder tail item. |

## 8 · Founder demonstration

The complete auction night runs **end to end in a real browser** — it is the
`conduct-ceremony` Playwright journey, green, with **zero axe violations**:

Create auction → invite owners → grant paddles → claim paddles → open auction →
conduct live bidding → **anti-snipe extension** → pause → resume → **undo** →
**replay** → ledger review → **diagnostics** → **restart engine** → **recovery** →
continue → complete.

Every client converges on the same snapshot `version`. Every replay matches
byte-for-byte. Every recovery succeeds. Everything runs locally.

## 9 · CTO freeze recommendation

**RECOMMEND FREEZE.**

The platform now earns the claim the directive demanded: another engineering
organisation could build every future auction-dependent capability on top of this
without modifying a single auction rule. The invariants are **machine-enforced**,
not documented — every recovery is reproducible, every replay is deterministic,
and every claim in this package is backed by a command a reviewer can run.

**Three** freeze-blocking defects were found *because* certification attacked the
platform instead of admiring it — the third (D-3) by an independent audit that
re-attacked the very claim the D-2 fix had declared true, and found the sibling
paddle rows still uncovered. All three are closed with permanent regressions in the
pure core *and* in integration. The lesson is recorded deliberately: the value was
not in the first certification pass but in **re-attacking its conclusions**.

The remaining risks are **ceilings, not cracks**: they bound how large an auction
may be, not whether it tells the truth. Each has a named remedy and none requires
changing an auction rule — which is precisely the property a freeze needs.

**Freeze conditions carried forward (operational, not blocking):**
1. Enforce the certified operating envelope at the web tier ([PERFORMANCE](PERFORMANCE.md) §5).
2. Restrict `auction_events` write access to the engine role before production.
3. Grant `auction.override` narrowly; review `UNDO` ledger rows after each auction.
4. R-1 (delta broadcast) and R-3 (hash-chained log) enter the post-freeze backlog as ADR candidates.

## 10 · Phase readiness assessment

| Phase | Ready? | Condition |
|---|---|---|
| **IP-5 / Settlement** | **Yes, on freeze.** | Consumes the ledger as the *only* history. Must not add a second source of truth for money, and must not require an auction-rule change. The ledger already carries final sales, reversals, per-team committed money and full attribution ([LEDGER](LEDGER.md) §6). |
| Wallet / Budget / Payments | Yes, after Settlement | Derive from settlement outcomes, never from auction rows directly. |
| Notifications | Yes | Subscribe to auction events read-only. **Never on the money path** (C-16, C-19). |
| Analytics | Yes | Read projections/ledger only. Never a writer. |
| Match Operations | Yes | Consumes completed squads. |

**Stop condition observed.** No downstream work has begun. Auction awaits **CTO
FREEZE approval** before any dependent phase opens.
