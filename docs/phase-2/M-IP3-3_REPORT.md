# M-IP3-3 MILESTONE REPORT · FIXTURES & VENUES

## IP-3 Competition Core · 2026-07-14 · CTO · Awaiting founder review

## 1 · What was built

The complete Fixture & Venue subsystem — scheduling only, exactly as directed: no
auction logic, no scoring, no live match management. Competition can now plan an
entire tournament before a single auction begins.

- **`packages/core/src/fixture.ts`** — the pure scheduling heart:
  - the canonical **Fixture lifecycle machine** (`draft → scheduled → published →
    in_progress → completed | cancelled`): typed states, typed events, a schedule
    guard (kickoff + ground required), fail-closed, terminal states with **no exits**;
  - the **deterministic scheduling engine**: circle-method round-robin pairings
    (single/double, byes for odd counts) + a pure slot assigner (kickoff times ×
    grounds per day, rounds never share a day) — conflict-free by construction,
    zero randomness, zero ambient time;
  - the **reusable conflict engine** (CTO addition 4): structural detection of
    team double-booking, ground double-booking, venue overlap, invalid duration,
    invalid kickoff, duplicate fixture, and fixtures outside competition dates —
    each typed `blocking` (invariant) or `warning` (organizer's call), output
    deterministically sorted. Auction/Match engines will consume this exact module;
  - **deterministic fixture numbers** (CTO addition 3): `MPL26-F001` from a
    name+year competition code and a per-competition sequence, derived once at
    creation, stored, stable forever.
- **`packages/core/src/fixture-csv.ts`** — pure fixture CSV validation (whole-file
  or nothing), reusing the registration tokenizer.
- **`packages/db` migration 0007** — `venues`, `grounds`, `fixtures` (org-scoped,
  ULID ids, wall-clock TEXT kickoffs, five indexes for the 500+ target). RLS
  `ENABLE`+`FORCE` with **both** `USING` and `WITH CHECK` from day one.
- **`apps/web/src/server/competition/`**:
  - `venues.ts` — the Venue aggregate (venue → ground hierarchy, ground metadata:
    surface/capacity/floodlights/indoor/status, availability filtering);
  - `fixture-aggregate.ts` — **the FixtureAggregate** (CTO addition 1): the ONLY
    module that mutates fixtures. Generate, create, edit, schedule, publish,
    reschedule, start, complete, cancel — every decision from core's machine +
    conflict engine, every mutation in one transaction with its audit row,
    blocking conflicts refused at the choke point;
  - `fixtures.ts` — **FixtureSnapshot** (CTO addition 2): the frozen read-only
    projection every downstream surface consumes (dashboard, calendar, exports,
    future engines); server-driven stats/filter/sort/pagination, calendar
    day/week ranges, competition timeline, upcoming, match-day grouping,
    organizer schedule, deterministic CSV export, audit timeline;
  - `fixture-import.ts` — atomic CSV import (names resolved against DB; any
    unknown name refuses the whole file; drafts only);
  - `fixture-actions.ts` — the internal RPC: session → tenant → capability →
    aggregate, nothing else.
- **Capability model extension** (additive): `venue.manage`, `fixture.manage`;
  `org:owner` and `org:staff` both hold them.
- **FLOODLIGHT UI** — `/org/[slug]/venues` (venue+ground management),
  `/competitions/[slug]/fixtures` (stats, conflicts panel, generate wizard,
  manual create, filter/sort/paginate, per-fixture lifecycle + reschedule,
  import/export), `/fixtures/calendar` (day/week/timeline + upcoming, pure
  server-rendered links), `/fixtures/match-day` (per-ground, start/complete),
  and an organizer-schedule strip on `/competitions`.

## 2 · What was verified (all green, local)

| Gate | Result |
| --- | --- |
| TypeScript | ✓ strict, 7/7 workspaces, zero suppressions |
| Lint | ✓ 0 errors, 7/7 |
| Unit | ✓ 134 — core **75** (fixture machine/generator/conflict engine/CSV **32** new) · ui 52 · engine 5 · contracts 2 |
| Integration (PG17) | ✓ 74 — **fixture-ops regression 24** (deterministic generation ×2-runs-equal, ordering, team/ground overlap refusals, window enforcement, reschedule provenance, illegal transitions, published protection, completed immutability, mutation + import rollback, audit completeness, export scoping/authz, **RLS READ + WRITE proofs** on all 3 new tables, **520-fixture scale**) · all 50 prior tests unchanged |
| E2E (real Chrome) | ✓ 44 — new scheduling journey (venue → grounds → generate → publish → **conflict refused** → resolve → calendar → export) + **axe zero** on venues + fixtures pages; 42 prior specs unchanged |
| Boundaries | ✓ dep-cruiser 0 violations / 396 modules; core stays pure, db stays leaf, web orchestrates |
| Migrations | ✓ 0000–0007 apply idempotent (re-applied clean); RLS enabled+forced+both-policies confirmed via pg_policies on venues/grounds/fixtures |
| Build | ✓ production build clean; 4 new dynamic routes; first-load JS ≤ 114 kB |

## 3 · Engineering decisions

- **Kickoffs are wall-clock TEXT (`YYYY-MM-DDTHH:MM`), not timestamptz.** Matches
  the competitions `starts_on` discipline; lexicographic order IS chronological
  order (indexable), export/import round-trips byte-identically, and the
  conflict engine's interval math is timezone-independent (UTC arithmetic on
  wall time). Local-first tournaments run in one timezone; multi-TZ arrives, if
  ever, as an explicit migration — not a silent assumption.
- **Conflict scope is the ORG, not the competition.** Grounds are physical,
  org-wide resources — two competitions cannot share a ground simultaneously.
  Team checks stay competition-local by construction (team ids are per-competition).
- **Drafts hold slots.** A draft with a kickoff+ground occupies its slot in the
  conflict engine. Conservative: the organizer can never sleepwalk two staged
  schedules into the same ground; the conflicts panel shows tension before
  anything goes live.
- **`start` lives on the aggregate.** The directive's aggregate op list omits it,
  but the canonical machine requires the `published → in_progress` edge and
  "nothing else may mutate fixtures" — so the aggregate owns every edge,
  including start. It is a lifecycle transition, not match management.
- **Generation is refused while live fixtures exist.** Regenerating over a live
  schedule would corrupt stable fixture numbers; cancel first (audited), then
  regenerate. Deterministic proof: two identical competitions produce identical
  schedules (regression-pinned).
- **Bulk = N singles** (the M-IP3-2 contract carried forward): schedule-all and
  publish-all iterate the single audited operation; each fixture gets its own
  audit row, skips are per-fixture, no bulk-only shortcut.
- **Journal `when` ordering trap avoided again**: drizzle-kit generated 0007 with
  a `when` that sorted before 0006 (the exact M-IP3-1 skip-trap); hand-corrected
  before first apply.

## 4 · Domain decisions (flagged for the founder)

- **Venue → Ground hierarchy, fixtures reference grounds only.** Venue
  information exists exactly once (`(org, name)` unique); a fixture reaches its
  venue through its ground. Ground metadata: surface, capacity, floodlights,
  indoor/outdoor, status (active/unavailable — the availability engine input).
- **Conflict severity split**: team double-booking, ground double-booking,
  window violations, malformed schedule data = **blocking** (machine-refused);
  same-venue overlap and same-day rematch = **warning** (surfaced, organizer
  decides). The directive's invariants map exactly onto the blocking set.
- **Cancelled fixtures release their slots** and become terminal; the row and its
  audit history remain (nothing is deleted — no delete operation exists).
- **Results, standings, statistics are NOT here** — the directive scoped M-IP3-3
  to scheduling only ("no scoring engine"); the IP-3_DESIGN milestone table's
  older, wider wording is superseded by this directive.

## 5 · Performance observations

520-fixture competition: stats, page-1 fetch, and deep pagination (page 21) all
served from indexed queries in single-digit milliseconds locally; page size is
capped at 100 and every sort carries a stable `seq` tiebreak, so pagination never
drops or repeats a row. The conflict engine is O(n²) pairwise over an org's
non-cancelled fixtures per mutation — at the 500-fixture target that is ~130k
cheap comparisons in-process (sub-millisecond); an interval index inside the
engine is the known next step if orgs ever hold thousands of live fixtures.

## 6 · Risks

- **RLS still not load-bearing in the serving path** (carried from IP-2/M-IP3-1):
  the app connects as superuser locally; the new tables are proven under a
  non-superuser probe, and `withTenant()` wiring remains the named pre-deploy item.
- **Wall-clock scheduling assumes one timezone per deployment** — correct for
  local-first; recorded so a future multi-region decision re-opens it explicitly.
- **Concurrent generation race** is closed by the `(competition_id, seq)` unique
  index (loud failure, retry-able), not by a lock — acceptable at organizer scale.
- No git remote yet (IP-0 founder tail) — all gates local.

## 7 · Founder demonstration (~5 minutes, everything local)

`docker compose up -d db && pnpm dev` → sign in → your organization → **Venues**:
create "Azad Maidan", add grounds "Main Oval" + "Side Strip" → **/competitions**:
create "MPL 2026" (dates + location), add 4 teams → **Fixtures** → Generate
(start date, times `18:00,20:00`, both grounds) → watch 6 drafts appear with
stable numbers → **Schedule all drafts** → **Publish schedule** → pick a fixture,
**Move** it onto another fixture's slot → the conflict engine refuses with the
reason → move it to a free evening instead → **Calendar** (day/week/timeline) →
**Match day** (start/complete a match) → **Export CSV**. Every step is the exact
e2e journey, 44/44 green — the demo cannot surprise us.

## 8 · Recommended founder decision

**APPROVE M-IP3-3** and authorize **M-IP3-4 (Competition APIs & Freeze)** — the
shared contracts the Auction engine consumes (IP-4 input), the phase DoD sweep,
and the `ip3-frozen` tag. One decision to confirm: the **blocking/warning split**
above (specifically: same-venue overlap warns rather than blocks, and same-day
rematches warn) — it hardens into the shared conflict engine that Auction and
Match Operations will consume unchanged.
