# IP-4 — FREEZE CERTIFICATION (RC1)

**Tag:** `ip4-frozen` · **Version:** v0.4.0 · **Status:** ENGINEERING COMPLETE

This is the release-closeout freeze artifact for IP-4 (the Auction Engine). It
records the state certified for freeze after independent implementation review,
independent remediation, independent challenge review, and a final certification
board — all re-run fresh against live Postgres 17.

Every number here is repository truth as measured this cycle, not a claim carried
forward. Where documentation and implementation disagreed, implementation won and
the documentation was reconciled (see §Documentation).

---

## 1 · Freeze Report

IP-4 is **CERTIFIED FOR FREEZE**. The event-sourced auction engine — single
writer, pure deterministic core, append-only log, fail-closed watchdog — holds
under hostile challenge. Five findings raised across the review cycle are
resolved and regression-locked; one (runtime tenant isolation) is a documented
pre-deploy operational item, not a freeze blocker.

| Finding | Class | Resolution | Regression lock |
|---|---|---|---|
| **FB-1** ladder-walk DoS | Freeze-Blocking | `ladderContains` rewritten O((amount−base)/step) → **O(#slabs)** arithmetic | `auction.test.ts` EQUIVALENCE (10M-comparison fuzz, 0 drift) + DoS-bound |
| **MAJ-1** deleted lot row invisible to watchdog | Major | `diffProjection` reverse row-scan for lots (parity with bids/paddles) | `certification` DELETED LOT ROW drill (halt → restore) |
| **MAJ-2** runtime RLS not wired | Major (pre-deploy) | Confirmed **application-layer isolation (B)**; code-tree docs corrected | Existing RLS policy proofs + app-layer isolation tests |
| **MIN-1** audit source mislabeled | Minor | `source` derived from engine sentinel actor | `live-engine` AUDIT SOURCE drill |
| **MIN-2** WS ticket never expired | Minor | Windowed HMAC, bounded ≤ 48h lifetime | `server.test.ts` ticket lifetime tests |
| **OBS-1** snapshot comment inaccurate | Observation | Comment + THREAT_MODEL reconciled to implementation | Snapshot determinism + spectate e2e |

---

## 2 · Certification Summary (fresh, cache-forced, live PG17)

| Gate | Result |
|---|---|
| TypeScript (`tsc --strict`) | clean · 8/8 workspaces · zero source suppressions |
| Lint (`--max-warnings 0`) | 0 errors · 8/8 workspaces |
| Boundaries (dependency-cruiser) | 0 violations |
| Format (prettier) | clean |
| **Unit** | **211** — core 149 · ui 52 · engine 8 · contracts 2 |
| **Integration (live PG17)** | **163** — engine 64 (certification 31 · live-engine 16 · conduct-ceremony 15 · healthz 2) · web 99 |
| **E2E (Playwright, real Chrome)** | auction suite green (foundation · conduct-ceremony · live-auction), axe zero violations |
| Migration replay (empty DB → zero) | 24 tables · 18 RLS policies · applied cleanly |
| Production build | clean (web Next + engine esbuild bundle) |
| Performance harness | no regression (§3) |

## 3 · Performance Summary (fresh `perf:scale` / `perf:live`, live PG17)

Binding constraint remains **broadcast = snapshot bytes × spectators × events**.
The FB-1 rewrite removed a synchronous multi-second hot path (16,487× on the
worst-case crafted bid); the MAJ-1 reverse-scan is O(#lots) and negligible.

| Scale | PlaceBid ack (p50) | snapshot load+fold+verify | recovery | pure fold | snapshot bytes |
|---|---|---|---|---|---|
| small (≈240 ev) | 6.2 ms | 2.3 ms | 2.7 ms | 0.1 ms | — |
| 2500 lots (5063 ev) | 61.1 ms | 23.8 ms | 26.6 ms | 1.8 ms | 358.6 KiB |

Broadcast fan-out (real WebSockets, windowed ticket): 50 spectators converge in
16 ms · 200 in ~13 ms (small) · 1000 in 180 ms (p95 247 ms). Ledger regeneration
0.5 ms @5063 rows. Concurrent bids → exactly one winner (single-writer proven).

## 4 · Engineering Metrics

- Findings raised across review cycle: **6** · resolved/locked: **5** · pre-deploy operational: **1** (MAJ-2).
- Freeze-blocking defects at RC1: **0**.
- Ladder membership: worst-case crafted bid **1766.8 ms → 0.1 ms**; MAX_SAFE_INTEGER and step=1 both O(1).
- Projection watchdog: deleted/corrupted/duplicate/reordered/gapped/partial all detected or fail-closed; **0** false positives across 5063-event runs.
- Money: overflow / underflow / negative / non-integer / NaN / Infinity all fail-closed (throw or `{ok:false}`), never silent.
- Runtime tenant isolation: **B — application layer** (role `rolsuper=t rolbypassrls=t`, `withTenant` call sites = 0, no `set_config` in serving/command paths).

## 5 · Repository Statistics

| Metric | Value |
|---|---|
| Commits (at freeze) | 49 |
| Tracked TS/TSX source files | 198 |
| Source LOC (`packages`/`apps` src) | 21,330 |
| Migrations (forward-only) | 11 |
| Tests (unit + integration + e2e) | 211 + 163 + e2e |
| Prior freeze tags | `ip1-frozen` · `ip2-frozen` · `ip3-frozen` · `va1-rc1` |

---

## 6 · Documentation reconciled this cycle

Counts synced to runner truth (`GATES`, `IP-4_CLOSURE_REPORT`, `REVIEW_PACKAGE`:
unit 208→211, integration 161→163, certification 30→31, live-engine 15→16,
conduct-ceremony 17→15). WS ticket bounded lifetime documented (`API`,
`ARCHITECTURE`, `SECURITY`, `SNAPSHOT`, `THREAT_MODEL`). Snapshot person-data
statement corrected to include the auctioned player's name (no bidder identity).

## 7 · Remaining operational items (PRE-DEPLOY ONLY — not freeze blockers)

1. **Tenant isolation (MAJ-2):** wire `withTenant` into the serving path **and**
   deploy under a non-BYPASSRLS role before multi-tenant production exposure. The
   RLS policies are proven correct under a non-superuser role in tests; at runtime
   isolation is application-layer. No user-controlled `orgId` reaches a write.
2. **Advisory:** a transport-edge upper bound on `amountRaw` (defense-in-depth
   beyond the O(#slabs) fix).

---

**IP-4 is CERTIFIED FOR FREEZE.** Engineering for IP-4 ends at this artifact.
