# COMPETITION ARCHITECTURE

## DesiAuction NEXT · v1.0 · 2026-07-14 · CTO · **Permanent engineering asset** (IP-3, M-IP3-4)

> Describes **implemented behavior only**, at the `ip3-frozen` tree. The Competition
> subsystem is a platform dependency: future phases consume it, they do not redesign it.
> Companion documents: [ADRS](ADRS.md) · [API](API.md) · [THREAT_MODEL](THREAT_MODEL.md) ·
> [RUNBOOKS](RUNBOOKS.md) · [DPDP_REVIEW](DPDP_REVIEW.md) · [PERFORMANCE](PERFORMANCE.md) ·
> [REVIEW_PACKAGE](REVIEW_PACKAGE.md).

## 1 · What Competition is

Competition models **who competes, in what, where, and when** — everything a tournament
knows before its first auction: organizations run Competitions (≡ the Canon's
Tournament); Persons enter through Registrations; Teams exist as competition-local
identities; Venues hold Grounds; Fixtures schedule team pairs onto grounds at wall-clock
kickoffs. Auction (IP-4), Money (IP-6) and Operations consume this model one-way; nothing
here imports them.

## 2 · Layering (enforced by dependency-cruiser, 0 violations)

| Layer | Owns | Never contains |
|---|---|---|
| `packages/core` | Pure rules: state machines, scheduling generator, conflict engine, fixture numbers, CSV validation, capability engine | Storage, IO, ambient time (clock injection only) |
| `packages/db` | Drizzle schema, SQL migrations (RLS included), client factory, ULIDs | Business rules |
| `apps/web/src/server/competition` | Orchestration: aggregates (the only mutation paths), read models, actions (session → tenant → capability → act → audit) | Business rules in routes; direct SQL in pages |
| `apps/web/src/app` | FLOODLIGHT pages/panels rendering server-provided views | Queries, rules, scheduling logic |

## 3 · Aggregate map (the only mutation paths)

| Aggregate | Module | Owns |
|---|---|---|
| **Competition** | `server/competition/competitions.ts` | Season/competition/team creation; the competition lifecycle (`advanceCompetition`, decided by core's machine) |
| **Registration** | `server/competition/registration-aggregate.ts` | Every registration `status` write: single + bulk transitions (bulk ≡ N singles, one transaction), team assignment, notes |
| **Fixture** | `server/competition/fixture-aggregate.ts` | Every fixture write: generate, create, edit, schedule, publish, reschedule, start, complete, cancel — machine-decided, conflict-checked, audited in-transaction |
| **Venue** | `server/competition/venues.ts` | Venue/ground creation, ground availability status |

No other module writes these tables. Read models (`registrations.ts`, `fixtures.ts`,
`schedule-snapshot.ts`) are read-only and return plain frozen shapes, never ORM entities.

## 4 · State machines (packages/core, exhaustively unit-tested)

**Competition** (pre-auction slice): `draft → setup → registration_open ⇄
registration_closed`. Guard: setup→open requires name+dates+location (doc 44).
`AuctionReady`+ are IP-4 states, declared not stubbed.

**Registration**: `submitted → approved | rejected(reason required) | waitlisted →
… → withdrawn`; `rejected/withdrawn → submitted` only via explicit `restore`.

**Fixture** (canonical): `draft → scheduled → published → in_progress → completed`,
`cancel` legal from every pre-terminal state. Schedule guard: kickoff + ground.
**Completed and cancelled have no exits** — completed fixtures are immutable,
permanently. Edit window: draft+scheduled. Reschedule window: scheduled+published
(the only way a published fixture moves).

## 5 · Entity relationships

```
Organization ─┬─ Season (minimal container: name+year)
              ├─ Competition ─┬─ Team           (unique name per competition)
              │               ├─ Registration   (unique person per competition) ── Person (frozen IP-2)
              │               └─ Fixture ── home/away Team, Ground?
              └─ Venue ─── Ground               (unique name per venue / per org)
```

All rows org-scoped (`org_id`, C-13). Fixtures reference **grounds only** — venue data is
never duplicated. Team ids are per-competition, so cross-competition team collisions are
structurally impossible.

## 6 · Scheduling engine (pure, deterministic)

`roundRobinPairings` (circle method, byes, 1–2 legs, home/away balanced) +
`planRoundRobin` (slot assignment: kickoff times × grounds per day; rounds never share a
day → generated schedules are conflict-free **by construction**). Zero randomness, zero
ambient time: identical inputs produce identical fixtures, forever (regression-pinned).
Fixture numbers `MPL26-F001` = `competitionCode(name, startsOn)` + per-competition `seq`,
derived once at creation, stored, stable forever.

## 7 · Conflict engine (pure, reusable — the ONE scheduling-conflict authority)

`detectConflicts(fixtures, window)` → typed conflicts, deterministically sorted.
**Blocking** (machine-refused by the aggregate): `team_double_booking`,
`ground_double_booking`, `invalid_duration`, `invalid_kickoff`,
`outside_competition_dates`. **Warning** (surfaced, organizer decides): `venue_overlap`,
`duplicate_fixture` (same pair, same day). Cancelled fixtures hold no slot; drafts with
slots DO hold them (conservative). Conflict scope is the **org** (grounds are physical,
cross-competition). Future Auction scheduling and Match Operations consume this exact
module — scheduling logic exists nowhere else.

## 8 · Read models

- **FixtureSnapshot** — one fixture joined flat (teams, ground, venue), frozen.
- **ScheduleSnapshot** (`schedule-snapshot.ts`) — THE canonical downstream read model:
  competition identity+code+window, teams, referenced venues/grounds, all fixture
  snapshots in seq order, stats. Deep-frozen, deterministic (no generated-at — same data,
  same bytes). CSV export is a pure serialization of it. Auction/Match engines consume
  this, never mutable rows.
- Server-driven queries: dashboard pagination (≤100/page, stable seq/id tiebreaks),
  calendar day/week ranges, competition timeline, upcoming, match-day grouping, organizer
  schedule, audit timelines.

## 9 · Authorization & tenancy

Capabilities (closed union, core): `competition.create/manage`, `team.manage`,
`registration.review`, `venue.manage`, `fixture.manage`. `org:owner` holds all;
`org:staff` holds team/registration/venue/fixture management. Enforcement composes the
frozen `hasCapability` at org scope OR competition (`tournament`) scope — per-competition
delegation works through the same helper when such grants are issued. Every action:
session → tenant resolution (membership-gated, non-members ≡ 404) → capability → act →
audit. RLS second lock: all seven competition tables `ENABLE`+`FORCE` with `USING` +
`WITH CHECK` (registrations add a person-scoped read disjunct).

## 10 · Time model

Kickoffs and competition dates are **local wall-clock TEXT** (`YYYY-MM-DDTHH:MM` /
`YYYY-MM-DD`): lexicographic order is chronological, exports round-trip byte-identically,
and conflict math is timezone-independent (UTC arithmetic on wall time). One timezone per
deployment — a recorded assumption, revisited only by explicit decision.
