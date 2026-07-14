# AUCTION OPERATIONAL RUNBOOKS

## DesiAuction NEXT · v1.0 · 2026-07-14 · CTO · **Permanent operations asset** (IP-4, M-IP4-4)

> Written so that an engineering team **that has never met the authors** can run
> an auction night, diagnose it, recover it, and roll it back.
>
> The one rule that governs everything below: **the event log is the truth.**
> Rows, snapshots, caches and dashboards are all projections of it. When they
> disagree with the log, the log wins and the platform halts until they agree.

---

## 1 · Auction night checklist

**T−1 day**
- [ ] Registration closed; pool approved. The `AuctionReady` gate is the only door into auction creation.
- [ ] Auction created; config locked (purse, squad min/max, slabs, timer, unsold policy, base-price bands). **Config cannot change after creation** — verify it now.
- [ ] Owners invited (`InviteOwner`) and accepted (`AcceptOwnerInvite`).
- [ ] Paddles granted (`GrantPaddle`) to every accepted owner. **No paddle exists without an explicit grant.**
- [ ] `pnpm --filter @desiauction/engine perf:scale` sanity-run if the pool exceeds 500 lots.

**T−1 hour**
- [ ] Engine `/healthz` returns 200 (`db: ok`, `watchdog: ok`).
- [ ] `QueueLots` **now, before opening** — at 2 500 lots this occupies the command queue for ~5 s (see [PERFORMANCE](PERFORMANCE.md) §6).
- [ ] Owners claim paddles (`ClaimPaddle`). Confirm paddle count ≥ 2 (the open guard).
- [ ] Diagnostics: `halted: null`, `queueDepth: 0`, watchdog `stalled: false`.
- [ ] Confirm the spectator ceiling for this pool size ([PERFORMANCE](PERFORMANCE.md) §5).

**Go**
- [ ] `OpenAuction` (requires ≥2 paddles and ≥1 queued lot).
- [ ] `OpenLot` → conduct → gavel (`CloseLot`) or let the timer close it.
- [ ] Watch `recoveries` in diagnostics. Any increment means the engine healed something — read the ledger.

**Close**
- [ ] Every lot resolved (`CompleteAuction` refuses while any lot is on the block, closing, or frozen).
- [ ] `CompleteAuction`. Export the ledger.

---

## 2 · Engine startup

```bash
docker compose up -d db
pnpm --filter @desiauction/engine db:migrate      # idempotent; safe to re-run
pnpm --filter @desiauction/engine dev             # or: node dist/index.mjs
```

The engine binds `PORT` (default 4000) and requires `ENGINE_SECRET` and
`DATABASE_URL`. It **replays every auction it touches from the log on first
access** — startup does no eager work and holds no state that survives a restart.

**A dead process is safer than a lying one.** Unhandled rejections and uncaught
exceptions call `die()`: log, flush Sentry, `exit(1)`. Restart it; it recovers.

Watchdog cadence: **250 ms** tick (timer authority), **10 s** WS heartbeat,
**30 s** deep verification.

---

## 3 · Recovery

**The single command:** `RecoverAuction` (requires `auction.conduct`). It is the
**only** command accepted while an auction is halted.

It re-folds the log, compares every row against it, **heals the rows from the
events**, and emits `AuctionRecovered` carrying the divergence count.

| Symptom | Diagnosis | Action |
|---|---|---|
| `halted: "projection_mismatch: …"` | A row disagrees with the log (lot status, sale price, sold paddle, **bid amount/paddle/status**) | `RecoverAuction`. Rows are healed FROM the events. Read the divergence list into the incident record. |
| `halted: "replay_failed: sequence_gap@N"` | **An event is missing from the log.** | **STOP. Do not restart in a loop.** Recovery cannot heal this — see §4. Escalate. |
| `halted: "replay_failed: unknown_event_type"` | The engine is older than the log (a newer version wrote an event this build does not know). | **Deploy the newer engine.** Never delete the event. |
| `halted: "snapshot_mismatch"` | Deep verify folded the same log to two different snapshots — non-determinism. | Escalate as a **P0 engineering defect**. Capture the log and both snapshots. |
| `halted: "replay_failed: illegal_replayed_transition@N"` | An event at seq N is illegal in the state the log folds to — i.e. an **unreplayable event was written**. | Escalate as **P0**. This is the D-1 class of defect; it is not operator-recoverable. |

**Restarting the engine is always safe.** In-memory state is derived; a cold
engine rebuilds byte-identical state from the log alone (measured: 28.5 ms at
2 500 lots). `POST /admin/reset` does the same without a process bounce (non-prod
only).

---

## 4 · When recovery cannot help (and why that is correct)

A **sequence gap** means an event was deleted or lost. The platform **refuses to
invent history**: replay stops at the gap, the engine stays halted, no snapshot is
ever served, and `RecoverAuction` also refuses.

This is a deliberate design property, not a limitation. The alternative — folding
around the hole — would silently produce a *plausible but false* auction, which is
precisely what C-2 (zero silent failures) forbids.

**Procedure:**
1. Do **not** restart repeatedly; the halt is stable and safe.
2. Preserve the log: `SELECT * FROM auction_events WHERE auction_id = $1 ORDER BY seq`.
3. Restore `auction_events` for that auction from backup (see [62-backup-strategy](../62-backup-strategy.md)); the table is append-only, so a point-in-time restore is exact.
4. Re-run `RecoverAuction`. Rows heal from the restored log.
5. If the gap cannot be repaired, the auction is **not resumable**. Abort it (`AbortAuction`, which freezes the ledger as-is) and re-run from a fresh auction. Never hand-write events.

---

## 5 · Undo

`UndoLastAction` requires **`auction.conduct` AND `auction.override`** — conduct
alone is never enough.

It reverses the most recent lot resolution with **compensating events**
(`BidInvalidated` + `LotReopened`). Nothing is ever deleted: the winning bid
survives as `invalidated`, the purse restores **by projection** (committed money
is derived, never stored), and the lot returns to the block with a fresh window.

**The window is closed when** another lot has opened since the resolution, **or**
the target lot has already been requeued / withdrawn / frozen. In both cases the
ack is `undo_window_closed`. This is correct: a resolution the conductor has
already moved past cannot be coherently reversed.

**Undo is not a general edit tool.** There is no way to alter a bid, a price, or a
past event. That is the point.

---

## 6 · Incident response

1. **Is any auction LIVE?** If yes: **no deploys, no migrations, no risky maintenance** (C-22).
2. `GET /diagnostics/:auctionId` (web-tier secret). Capture the whole payload into the incident.
3. Read `halted`. If non-null, go to §3.
4. Read the **ledger** — it is the complete operational history and it regenerates from events in under a millisecond. Every row carries actor, paddle, team, lot, amount, result, reason and correlation id.
5. Cross-reference `audit_log` by `correlationId` for the request that caused it.
6. If money looks wrong: **do not edit rows.** Rows are projections. Run `RecoverAuction` and let the log win. If the log itself is wrong, that is a P0 engineering defect — escalate; do not patch data.

---

## 7 · Diagnostics interpretation

`GET /diagnostics/:auctionId` — see [DIAGNOSTICS](DIAGNOSTICS.md) for the full field list.

| Field | Healthy | Investigate when |
|---|---|---|
| `halted` | `null` | **anything else** — the auction is refusing commands |
| `queueDepth` | 0–2 | sustained > 10: commands arriving faster than they process (check `avgProcessMs` against [PERFORMANCE](PERFORMANCE.md)) |
| `avgProcessMs` / `maxProcessMs` | tracks the lot count (§1 of PERFORMANCE) | far above the matrix for your pool size → DB pressure |
| `watchdog.stalled` | `false` | `true` = no tick in 5 s. The timer authority is down; lots will not close. **Restart the engine.** |
| `watchdog.tickDriftMs` | < 250 | large drift = event-loop starvation |
| `recoveries` | stable | any increment = the engine healed a divergence. **Read the ledger.** |
| `snapshotHash` / `projectionHash` | change only when `version` changes | changing while `version` is static = non-determinism → P0 |
| `connectedClients` | within the envelope | see [PERFORMANCE](PERFORMANCE.md) §5 — the spectator ceiling depends on lot count |
| `lastBroadcastLatencyMs` | tens of ms | growth tracks spectators × snapshot bytes |

---

## 8 · Performance tuning

There are exactly three levers, in order of value:

1. **Reduce spectators or lots** — broadcast cost is `snapshot bytes × spectators × events` (PERFORMANCE §4). This is the only lever that works *today*.
2. **Queue the pool before opening**, never during (PERFORMANCE §6).
3. **Give PostgreSQL headroom.** Command latency is dominated by re-loading the event log, not by the fold (1.7 ms at 5 063 events). Disk/connection pressure shows up directly in `avgProcessMs`.

Do **not** attempt to tune by raising the tick rate, adding engine replicas, or
sharding an auction. **One auction has exactly one writer.** More writers = a
broken auction, not a faster one.

---

## 9 · Deployment

- **Never deploy while an auction is LIVE** (C-22). The platform knows its live windows; respect them.
- Migrations are **idempotent** and forward-only (verified: applied twice, clean).
- The engine is stateless across restarts. Rolling it is safe **between** auctions and safe *during* one only in the sense that it will recover — but clients will drop and reconnect, and the auction will visibly stutter. Don't.

## 10 · Rollback

- **Code:** roll the engine back to the previous build. Safe **only if** the older build knows every event type present in the log. If a newer event type was written, the older engine halts with `unknown_event_type` — this is the log protecting itself. Roll *forward* instead.
- **Data:** never roll back `auction_events`. It is append-only and it is the truth. Restoring an *older* log silently destroys history.
- **Schema:** migrations are forward-only. A schema rollback requires a new forward migration.

---

## 11 · Known constraints

| Constraint | Impact | Status |
|---|---|---|
| Broadcast = full snapshot × every spectator, per event | Bounds the operating envelope (PERFORMANCE §4/§5) | **Certified limit**; remedy is a wire-contract change, deferred post-freeze |
| Command latency is O(events) | Auction night is O(n²); 60 ms p95 at 2 500 lots | Certified; remedy (checkpointing) is internal and non-breaking |
| Idempotency cache is per-process | A duplicate command across a restart re-executes | Safe: the bid gauntlet refuses it (`ALREADY_LEADING` / `BELOW_CURRENT`). Defence in depth, not the guard. |
| Voided bids unmarked in `bidHistory` | A reversed bid is not visually distinct from a live one | Intentional ("voided-but-visible"); no money impact. Additive wire fix deferred. |
| A sequence gap is unrecoverable | The auction cannot resume | **Correct by design** (§4) |

---

## 12 · FAQ

**Can I edit a bid / a price / a sale?** No. There is no such command, by design.
Use `UndoLastAction` (conduct + override) to reverse the most recent resolution.
Everything else is history.

**A row in the database looks wrong. Can I just fix it?** No. Rows are
projections. Edit one and the watchdog will halt the auction on the next command
— which is exactly what it is for. Run `RecoverAuction` and let the log heal it.

**The engine crashed mid-auction. What do we lose?** Nothing. Every accepted
command was committed with its event in one transaction. Restart; the engine
replays and continues. Clients reconnect and receive the full snapshot.

**Two clients show different numbers.** They cannot, if both are on the current
`version`. Check `version` on each: a stale client is a *transport* problem
(reconnect it), not a truth problem. If two clients show different values at the
*same* version, that is a P0 determinism defect — escalate immediately.

**Can we run two engines for redundancy?** No. One auction, one writer (C-9). A
second writer would interleave the event sequence; the unique `(auction_id, seq)`
index turns that into a loud failure rather than silent corruption, but the
auction will halt. Run one engine and rely on fast recovery (28.5 ms).

**Is it safe to restart the engine to clear a problem?** Yes — always. It is the
first thing to try for anything transport- or memory-shaped. It cannot corrupt
anything: all durable truth is in the log.
