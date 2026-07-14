# IP-3 CLOSURE REPORT · COMPETITION CORE

## M-IP3-4 "Competition Freeze" · 2026-07-14 · CTO

## 1 · What was completed

M-IP3-4 added **one** piece of functionality by directive — the **ScheduleSnapshot**
(`schedule-snapshot.ts`): the permanent, deep-frozen, deterministic read model downstream
systems consume instead of mutable fixture entities; the fixtures CSV export was re-routed
to be a pure serialization of it, and a regression test pins its contract (determinism,
deep immutability at every level, stats/fixture reconciliation, self-contained ground
references). Everything else is closure evidence: the permanent documentation set
(`docs/competition/` — [ARCHITECTURE](../competition/ARCHITECTURE.md), five
[ADRs](../competition/ADRS.md), [API](../competition/API.md),
[THREAT_MODEL](../competition/THREAT_MODEL.md), [DPDP_REVIEW](../competition/DPDP_REVIEW.md),
[PERFORMANCE](../competition/PERFORMANCE.md), [RUNBOOKS](../competition/RUNBOOKS.md),
[REVIEW_PACKAGE](../competition/REVIEW_PACKAGE.md)), a rerunnable performance harness
(`perf:competition`) with measured results, one measured performance defect fixed
(conflict engine hot loop, §3), the full quality sweep rerun on the freeze candidate,
the [GATES entry](GATES.md), and this closure.

Phase scope shipped across four milestones: **M-IP3-1** domain foundation (machines,
capability extension, schema+RLS, first FLOODLIGHT slice) · **M-IP3-2** registration at
scale (operations dashboard, the Registration aggregate, bulk ≡ N singles, CSV
import/export, 300+ scale) · **M-IP3-3** fixtures & venues (venue→ground model, the
Fixture aggregate, deterministic scheduling + the shared conflict engine, calendar/
match-day, 500+ scale) · **M-IP3-4** this freeze.

## 2 · What was verified (all rerun fresh on the freeze candidate — no assumed results)

| Gate | Result |
| --- | --- |
| TypeScript | ✓ `tsc --strict` 7/7 workspaces, zero suppressions |
| Lint | ✓ 0 errors, 7/7 |
| Unit | ✓ **134** — core 75 · ui 52 · engine 5 · contracts 2 |
| Integration (PG17) | ✓ **75** — fixture-ops 25 (incl. SNAPSHOT contract + RLS read/write proofs + rollback + 520 scale) · registration-ops 13 · competition 10 · authz 12 · security 8 · auth 7 |
| Playwright | ✓ 44/44 real Chrome (one pre-existing orgs-axe spec flaked under parallel compile load; passed on retry and clean in isolation — documented M-IP2-4 jitter) |
| Axe | ✓ zero violations on every competition surface + all IP-1/IP-2 suites |
| Boundaries | ✓ dep-cruiser 0 violations / 363 modules / 963 deps; dependency direction one-way |
| RLS | ✓ READ + WRITE proofs under non-superuser probe on all seven competition tables (0005 + 0007) |
| Migrations | ✓ 0000–0007 re-applied idempotent |
| Production build | ✓ clean; heaviest competition route 114 kB first-load |
| Performance | ✓ measured, recorded in [PERFORMANCE](../competition/PERFORMANCE.md) (summary §5) |

## 3 · Final engineering decisions (this milestone)

- **D-M4-1 · ScheduleSnapshot carries no generated-at field.** Determinism outranks
  provenance in the read model: identical database state must serialize to identical
  bytes (regression-pinned). Consumers that need "when" attach their own timestamps.
- **D-M4-2 · Conflict-engine hot-loop fix (measured defect).** First measurement showed
  127.3 ms median for the pure engine at 520 fixtures — kickoff parsing ran inside the
  O(n²) pair loop. Intervals/pair-keys/dates are now precomputed once per fixture:
  2.3 ms, ~55× faster, zero behavior change (75/75 core tests untouched). The perf
  harness is the permanent guard.
- **D-M4-3 · The performance harness is a repository asset**, not a scratch script
  (`apps/web/scripts/perf-competition.ts`, `pnpm perf:competition`): seeds, measures
  median/p95 over 20 runs, cleans up. "Measured, not estimated" stays rerunnable.
- **D-M4-4 · The export path was re-pointed, not duplicated.** `exportFixturesCsv` was
  deleted; the action serializes the ScheduleSnapshot. One read model, no parallel query
  path to drift.

## 4 · Domain decisions (phase summary, flagged at their milestones, none reopened)

Competition ≡ Canon Tournament; Season = minimal container (founder confirmed at
M-IP3-2 authorization) · Person ≠ participation — Registration is the participation
record, no Player table · rejection reasons are categorized, private, mandatory ·
Venue → Ground with fixtures referencing grounds only · blocking/warning conflict split
(simultaneous team/ground + window = machine-refused; venue overlap + same-day rematch =
organizer's call) — confirmed by M-IP3-4 authorization · completed fixtures immutable,
cancelled terminal, published moves only via the audited reschedule workflow.

## 5 · Performance (measured, freeze candidate — full table in PERFORMANCE.md)

520 fixtures: stats 0.4 ms · dashboard page 4.4 ms · deep page 3.7 ms · pure conflict
engine 2.3 ms · conflict-checked reschedule (incl. audit tx) 6.4 ms · ScheduleSnapshot
4.4 ms · CSV serialize 0.2 ms. 300 registrations: stats 1.0 ms · search+sort page
5.5 ms (9.2 ms p95). All medians single-digit milliseconds; every sort order is total
(stable tiebreaks) so pagination is deterministic at any depth.

## 6 · Remaining risks & conditions (none freeze-blocking)

1. **`withTenant()` serving-path wiring** — the RLS second lock is proven per-table but
   the app connects as superuser locally; named pre-deploy item, carried from IP-2, now
   spanning IP-2+IP-3 tables together.
2. **IP-4 entry requirement** — the Auction engine consumes Competition only via
   `scheduleSnapshot` / approved-registration projections and must implement the declared
   `AuctionReady` gate before ingesting.
3. **Advisory** — serializable transactions for conflict pre-checks if genuinely
   concurrent organizer mutation appears; sweep-line interval index beyond ~2k live
   fixtures/org; single-timezone wall-clock assumption re-opens only by explicit decision.
4. **No git remote / CI** — every gate above is a local run; the e2e-in-CI decision
   parked since IP-0 stays parked until the founder-tail remote exists.

## 7 · Founder demonstration (the canonical Competition walkthrough, ~8 minutes, all local)

`docker compose up -d db && pnpm dev` → sign in → **create competition** (name, dates,
location) → Begin setup → **Open registration** → **import players** by CSV on the
registrations dashboard → bulk **approve** → org page → **Venues** → create venue +
grounds → **Fixtures** → **Generate** round robin → Schedule all → **Publish schedule**
→ Move a fixture onto an occupied slot → **conflict refused** with the reason → move to
a free slot (**resolved**) → **Calendar** (day/week/timeline) → **Export** the schedule
CSV. Every step is the exact e2e-proven journey (44/44); RUNBOOKS R-1 records it as the
permanent walkthrough.

## 8 · Freeze declaration

All fifteen freeze-checklist items are true (domain, scheduling, registration, fixtures,
venues, calendar, snapshot, APIs, architecture, ADRs, threat model, runbooks, review
package, gates, demonstration). **IP-3 is FROZEN at tag `ip3-frozen`.** Competition is
now a platform dependency: an engineering team can build the Auction Engine from
[REVIEW_PACKAGE](../competition/REVIEW_PACKAGE.md) + [API](../competition/API.md) +
`scheduleSnapshot` without changing a single Competition invariant — which was the bar
for this freeze. Next: **await OPEN IP-4.**
