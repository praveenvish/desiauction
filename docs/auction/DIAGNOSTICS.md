# AUCTION DIAGNOSTICS & WATCHDOG

## DesiAuction NEXT · v1.0 · 2026-07-14 · CTO · **CERTIFIED** (IP-4, M-IP4-4)

> `GET /diagnostics/:auctionId` — the recovery dashboard's feed. Web-tier only
> (shared secret). It exposes **counters and hashes, never payloads, never
> secrets, never person data**. Spectators can never reach it.

## 1 · The fields

| Field | Meaning |
|---|---|
| `auctionStatus` | from the current snapshot |
| `version` | last event seq — the snapshot's ordering key |
| `eventCount` | events folded into the current state |
| `halted` | **`null` = healthy.** Anything else is the halt reason (§3) |
| `queueDepth` | commands enqueued but not yet finished |
| `processed` / `accepted` / `rejected` | command counters since load |
| `avgProcessMs` / `lastProcessMs` / `maxProcessMs` | command latency |
| `commandsPerMinute` | throughput over the load window |
| `lastReplayMs` | last event-log fold + snapshot rebuild |
| `lastRecoveryMs` | last `RecoverAuction` (replay → diff → heal) |
| `lastBroadcastLatencyMs` | rebuild start → broadcast handoff |
| `snapshotHash` / `projectionHash` | SHA-256 of the canonical bytes |
| `recoveries` | count of `AuctionRecovered` events |
| `watchdog.lastTickMs` / `tickDriftMs` / `stalled` | timer-authority health |
| `connectedClients` / `wsHeartbeatAgeMs` | WS room health |

**Interpretation table → [RUNBOOKS](RUNBOOKS.md) §7.**

## 2 · The watchdog

The engine **is** the timer authority. A 250 ms tick drives two things, both
through the **same command queue** as human commands — which is why the timer can
never race a bid:

- `now ≥ endsAtMs` → `_TimerClose` (sold or unsold, by leading bid — doc 41).
- remaining ≤ extension window → `_ClosingSoon` (`on_block → closing_soon`).

A 30 s **deep verification** folds the log twice and compares bytes.

`watchdog.stalled` = no tick in 5 s. It also fails `/healthz` (503), because an
engine that cannot close lots is not healthy even if its database is.

## 3 · Every halt condition (certified)

A halt is fail-closed: **every command except `RecoverAuction` is rejected**, no
snapshot is broadcast, and the reason is exposed in diagnostics. Certification
drills every one of these.

| Halt | Trigger | Recoverable? |
|---|---|---|
| `projection_mismatch: lot …` | a lot row disagrees with the log (status, sale price, sold paddle) | **Yes** — `RecoverAuction` heals rows FROM events |
| `projection_mismatch: bid … amount diverged` | **a bid row's money disagrees with `BidAccepted`** | **Yes** — healed from the log *(closed defect D-2)* |
| `projection_mismatch: bid … rows=X events=Y` | a bid's lifecycle status was tampered with (e.g. a losing bid re-crowned as leader) | **Yes** — healed |
| `projection_mismatch: paddle … person diverged` | **a paddle row was reassigned to a different person** (authorization hijack) | **Yes** — healed from `PaddleIssued` *(closed defect D-3)* |
| `projection_mismatch: paddle … team/released/number diverged` | a paddle's team (purse), release state (bid gating), or number was tampered with | **Yes** — healed *(D-3)* |
| `projection_mismatch: lot … rounds diverged` | a lot's requeue-round count was tampered with (unsold-policy bypass) | **Yes** — healed *(D-3)* |
| `projection_mismatch: auction: rows=…` | the auction status row disagrees with the log | **Yes** — healed |
| `replay_failed: sequence_gap@N` | an event is **missing** from the log | **No** — the platform refuses to invent history. [RUNBOOKS](RUNBOOKS.md) §4 |
| `replay_failed: unknown_event_type` | the engine is older than the log | **No** — deploy the newer engine |
| `replay_failed: illegal_replayed_transition@N` | an **unreplayable event was written** | **No** — P0 engineering defect *(this is the D-1 class)* |
| `replay_failed: timer_shrank` | invariant 14 violated: a bid shortened a lot | **No** — P0 |
| `replay_failed: unknown_bid` | a bid was invalidated that the log never accepted | **No** — P0 |
| `snapshot_mismatch` | deep verify folded one log to two different snapshots | **No** — P0 determinism defect |

**The distinction is deliberate.** Divergences between *derived rows* and the log
are **healable** — the log is the truth and the rows are rebuilt from it.
Corruption *of the log itself* is **not** healable, and the platform will not
pretend otherwise: it halts, serves nothing, and escalates.

## 4 · What halting protects

An engine that has detected an inconsistency has exactly two options: guess, or
stop. It stops.

That is the whole of C-2 ("zero silent failures") reduced to a mechanism: a
corrupted row cannot become a sale, a missing event cannot become a plausible
auction, and a non-deterministic snapshot cannot reach two clients as two
different truths.

## 5 · Evidence

`apps/engine/src/integration/certification.integration.test.ts` §WATCHDOG
CERTIFICATION and §RECOVERY CERTIFICATION — each halt condition is triggered
against a real engine and a real database, the halt is asserted, commands are
asserted refused while halted, and recovery is asserted to heal (or to correctly
refuse).
