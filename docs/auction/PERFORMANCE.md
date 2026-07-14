# AUCTION PERFORMANCE CERTIFICATION

## DesiAuction NEXT · v1.0 · 2026-07-14 · CTO · **MEASURED** (IP-4, M-IP4-4)

> Every number here was produced by `pnpm --filter @desiauction/engine perf:scale`
> against **live PostgreSQL 17**, with a real engine, real commands through the
> real command queue, and real WebSocket spectators. Nothing is estimated.
>
> Harness: `apps/engine/scripts/perf-scale.ts`. Latency harness (single scale,
> deeper percentiles): `perf-live.ts`. Local hardware (Apple Silicon, Docker
> PG17) — treat as **relative** truth, not a production SLO.

## 1 · The scale matrix (lots)

Median / p95 milliseconds.

| Metric | 100 lots | 250 | 500 | 1000 | 2500 |
|---|---|---|---|---|---|
| `createAuction` (pool → lots + events) | 146 | 291 | 620 | 1 545 | **2 919** |
| Engine load (replay + verify + snapshot) | 12.5 | 4.2 | 5.5 | 11.4 | **22.4** |
| `QueueLots` (whole pool, one command) | 202 | 494 | 987 | 1 985 | **4 741** |
| └─ per-lot queue cost | 2.0 | 2.0 | 2.0 | 2.0 | 1.9 |
| **`PlaceBid` ack** (incl. re-fold + rebuild) | **7.4** / 9.0 | **10.1** / 20.9 | **14.2** / 16.4 | **25.0** / 28.0 | **52.6** / 60.2 |
| `replayAuction` **pure fold** | 0.1 | 0.2 | 0.3 | 0.7 | **1.7** (5 063 events) |
| `buildLiveSnapshot` (load+fold+verify+build) | 2.6 | 3.7 | 5.6 | 11.4 | **25.3** |
| **Recovery** (restart → replay → snapshot) | 3.1 | 4.5 | 6.5 | 12.3 | **28.5** |
| Ledger regeneration (all rows, from events) | 0.1 | 0.1 | 0.1 | 0.1 | **0.5** (5 063 rows) |
| Diagnostics refresh | <0.1 | <0.1 | <0.1 | <0.1 | <0.1 |
| **Snapshot payload (KiB)** | 18.2 | 39.3 | 74.5 | 144.8 | **358.6** |

## 2 · The spectator matrix (broadcast fan-out)

Real WebSocket clients on a 250-lot auction (39.3 KiB snapshot). "Converged" =
the **last** spectator to receive the new snapshot after a real bid.

| Spectators | Join (connect → full snapshot) | Bid → ALL converged |
|---|---|---|
| 50 | 7.6 / 9.4 | **16.8** / 22.2 |
| 100 | 4.2 / 5.3 | **20.1** / 22.1 |
| 250 | 11.2 / 34.7 | **32.9** / 35.5 |
| 500 | 15.4 / 43.0 | **57.3** / 58.9 |
| 1000 | 46.4 / 102.6 | **106.1** / 108.0 |

Convergence is **linear in spectator count** (~0.1 ms per spectator), as expected
for a fan-out that serializes once and writes N sockets.

## 3 · What the numbers say

**Recovery is a non-risk.** A full restart-and-replay of the largest certified
auction (2 500 lots, 5 063 events) completes in **28.5 ms**. Recovery is not on
the critical path of anything. The same is true of the ledger: regenerating the
entire operational history of an auction night takes **0.5 ms**.

**The pure domain is essentially free.** Folding 5 063 events costs **1.7 ms**.
The reducer is not the cost; the *round trip* is.

**Command latency is linear in auction size.** `PlaceBid` costs 7 ms at 100 lots
and **53 ms at 2 500**. The cause is architectural and deliberate: after **every**
command the engine re-loads the entire event log, re-folds it, re-verifies every
row, and rebuilds the snapshot. That is what makes the fail-closed guarantee
real — but it makes per-command cost **O(events)**, and therefore an auction
night **O(n²)** in total. At 2 500 lots the p95 bid ack is 60 ms, which is still
comfortably inside human reaction time; it is the *trend*, not the current
number, that bounds the platform.

## 4 · The dominant constraint: broadcast volume

The snapshot embeds the entire queue, so payload grows with the pool — and the
**full snapshot is broadcast to every spectator on every event**:

```
broadcast bytes per event  =  snapshot bytes × spectators
```

| | 100 spectators | 1000 spectators |
|---|---|---|
| 250 lots (39 KiB) | 3.9 MB / event | **39 MB / event** |
| 2500 lots (359 KiB) | 35.9 MB / event | **359 MB / event** |

At a realistic bidding cadence (~1 event/second during a hot lot) the 2 500-lot ×
1 000-spectator corner is **not viable on any ordinary network link**. This is the
single most important operational finding of IP-4.

It is a **contract** problem, not a bug: fixing it means delta frames or removing
the queue from the hot snapshot, both of which change the wire contract this
milestone is freezing. It is therefore recorded as a **certified limit** with a
named remedy, and the operating envelope below is set to stay well inside it.

## 5 · Certified operating envelope

| | Recommended | Certified ceiling | Refuse |
|---|---|---|---|
| **Lots** | ≤ 500 | 2 500 | > 2 500 (unmeasured) |
| **Spectators** | ≤ 250 | 1 000 (at ≤ 250 lots) | 1 000 spectators **and** > 500 lots |
| **Bid ack (p95)** | < 20 ms | 60 ms | — |

**Operational rule:** the spectator ceiling is a function of the lot count.
Above ~500 lots, cap spectators at 250 until delta broadcasting ships. The
cockpit's diagnostics panel exposes `connectedClients` — see
[RUNBOOKS](RUNBOOKS.md) §7.

## 6 · Cost hotspots, ranked (for the post-freeze backlog)

1. **Full-snapshot broadcast** (§4) — remedy: delta frames / queue pagination.
   *Highest value, wire-breaking, must be an ADR.*
2. **Full re-fold per command** (§3) — remedy: incremental fold, or periodic
   snapshot checkpointing so replay starts from a checkpoint rather than seq 1.
   Purely internal; does **not** touch the wire contract or any auction rule.
3. **`createAuction` / `QueueLots` are per-row loops** — each lot costs a
   `SELECT max(seq)` + insert + audit insert. 2.0 ms/lot is stable and these are
   one-time pre-auction operations, but `QueueLots` occupies the command queue
   for **4.7 s** at 2 500 lots. Do it *before* opening the auction (the runbook
   says so). Remedy: batch the seq allocation.

None of the three is freeze-blocking: each is a performance ceiling, not a
correctness defect, and none requires changing an auction rule.

## 7 · Reproducing

```bash
docker compose up -d db
pnpm --filter @desiauction/engine perf:scale   # the matrix in §1 and §2
pnpm --filter @desiauction/engine perf:live    # deep percentiles at one scale
```

Both harnesses seed, measure, and clean up after themselves. If a run crashes
mid-matrix it leaves its seed data behind; purge with the `Scale %` org filter
before re-running.
