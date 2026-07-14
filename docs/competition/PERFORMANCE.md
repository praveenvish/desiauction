# COMPETITION PERFORMANCE REPORT

## DesiAuction NEXT · v1.0 · 2026-07-14 · CTO · **Permanent engineering asset** (IP-3, M-IP3-4)

> **Measured observations, not estimates.** Harness:
> `pnpm --filter @desiauction/web perf:competition`
> (`apps/web/scripts/perf-competition.ts`) — seeds 520 published fixtures (12 teams,
> 4 grounds, dense 8-slots/day packing) plus a 300-registration competition against the
> local PG17 container, measures each path 20× after a warm-up, reports median + p95,
> and cleans up. Machine: local dev (Apple Silicon, Docker Postgres 17). 2026-07-14,
> freeze-candidate tree.

## 1 · Measured results

| Path | median | p95 |
|---|---:|---:|
| `fixtureStats` (520 fixtures) | 0.4 ms | 0.7 ms |
| `queryFixtures` page 1 of 21 (25/page, kickoff sort) | 4.4 ms | 6.5 ms |
| `queryFixtures` deep page 21 of 21 | 3.7 ms | 4.4 ms |
| `queryFixtures` filtered (status+team+number search) | 1.4 ms | 1.7 ms |
| Conflict engine, pure (520 fixtures, full pairwise) | 2.3 ms | 3.9 ms |
| `competitionConflicts` (DB load + engine) | 5.2 ms | 6.1 ms |
| `rescheduleFixture` (conflict-checked mutation + audit tx) | 6.4 ms | 7.5 ms |
| `scheduleSnapshot` (520 fixtures, full frozen projection) | 4.4 ms | 5.1 ms |
| `serializeScheduleCsv` (pure, 520 rows) | 0.2 ms | 0.5 ms |
| `registrationStats` (300 registrations) | 1.0 ms | 1.4 ms |
| `queryRegistrations` page 1 (search+sort, 25/page) | 5.5 ms | 9.2 ms |
| `queryRegistrations` deep page 12 | 3.1 ms | 4.0 ms |

## 2 · Targets vs reality

- **500+ fixture scheduling** ✓ — every dashboard/calendar path single-digit ms at 520.
- **Registration dashboard scale** ✓ — 300 registrations, search+sort+page ≤ 9.2 ms p95
  (the M-IP3-2 300-row regression also pins pagination correctness).
- **Stable pagination / deterministic ordering** ✓ — every sort carries a stable
  `seq`/`id` tiebreak; disjoint-pages and order-stability are regression tests, and deep
  pages cost no more than page 1 (index-served).
- **Conflict engine latency** ✓ — 2.3 ms median for the full 520-fixture pairwise scan;
  a conflict-checked mutation lands at 6.4 ms end-to-end including its audit transaction.
- **Snapshot generation** ✓ — 4.4 ms for the complete deep-frozen 520-fixture
  projection; serialization is effectively free (0.2 ms).

## 3 · One defect found and fixed by measurement (M-IP3-4)

First measurement showed the pure conflict engine at **127.3 ms** median (520 fixtures):
`intervalOf`/`pairKey`/date-slicing ran **inside** the O(n²) pair loop, so kickoff
parsing executed ~135k times. Fix: precompute intervals, pair keys and dates once per
fixture (O(n)) before the pair scan — behavior identical (75/75 core tests unchanged),
result **2.3 ms** (~55× faster). Recorded in [ADR-ConflictEngine](ADRS.md); the perf
harness is the permanent guard against regressing it.

## 4 · Known headroom (recorded, not needed at current scale)

Pairwise conflict scan is O(n²) over an org's non-cancelled fixtures — fine to a few
thousand; an interval-index (sweep line) inside the pure engine is the known next step.
First-load JS unchanged at freeze: heaviest competition route 114 kB (budget-clean,
verified in the production build).
