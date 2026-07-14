# COMPETITION REVIEW PACKAGE

## DesiAuction NEXT · v1.0 · 2026-07-14 · CTO · IP-3 freeze artifact

> Purpose: let another engineering team **consume Competition without reading the
> repository**. Everything here is implemented and regression-pinned at `ip3-frozen`.
> Deep dives: [ARCHITECTURE](ARCHITECTURE.md) · [ADRS](ADRS.md) · [API](API.md) ·
> [THREAT_MODEL](THREAT_MODEL.md) · [DPDP_REVIEW](DPDP_REVIEW.md) ·
> [PERFORMANCE](PERFORMANCE.md) · [RUNBOOKS](RUNBOOKS.md).

## 1 · Domain overview

Competition = everything a tournament knows before its first auction. Organizations own
Competitions (Seasons are a minimal name+year container). Persons participate via
Registrations (person ≠ participation — there is no Player table). Teams are
competition-local identities. Venues hold Grounds; Fixtures put team pairs on grounds at
wall-clock kickoffs. All times are local wall-clock strings (one timezone per
deployment). Everything is local-first: zero external services.

## 2 · Aggregate map

Four write paths, nothing else mutates:
**Competition** (`competitions.ts`: create season/competition/team, lifecycle advance) ·
**Registration** (`registration-aggregate.ts`: every status change, single+bulk, notes,
team grouping) · **Fixture** (`fixture-aggregate.ts`: generate/create/edit/schedule/
publish/reschedule/start/complete/cancel) · **Venue** (`venues.ts`: venue/ground/
availability). Every mutation: capability-gated, decided by pure core, committed in a
transaction with its audit row.

## 3 · State machines (core, illegal transitions unrepresentable)

- Competition: `draft → setup → registration_open ⇄ registration_closed`
  (setup→open guard: name+dates+location). `AuctionReady`+ = declared IP-4 states.
- Registration: `submitted → approved | rejected(reason) | waitlisted → withdrawn`;
  restore = the only exit from rejected/withdrawn, back to `submitted`.
- Fixture: `draft → scheduled → published → in_progress → completed`; `cancel` from any
  pre-terminal state; **completed/cancelled have no exits**. Edit: draft+scheduled.
  Reschedule: scheduled+published only.

## 4 · Entity relationships

```
organizations 1─n seasons
organizations 1─n competitions (season_id nullable)
competitions  1─n teams              unique (competition_id, name)
competitions  1─n registrations      unique (competition_id, person_id) → people (frozen IP-2)
organizations 1─n venues             unique (org_id, name)
venues        1─n grounds            unique (venue_id, name)
competitions  1─n fixtures           unique (competition_id, seq) + (competition_id, fixture_number)
fixtures      n─1 home/away teams, n─0..1 grounds
```

## 5 · Capability requirements

Closed union (core `capabilities.ts`): `competition.create`, `competition.manage`,
`team.manage`, `registration.review`, `venue.manage`, `fixture.manage`.
`org:owner` = all · `org:staff` = team/registration/venue/fixture management.
Enforcement: frozen `hasCapability` at org scope OR competition (`tournament`) scope —
per-competition delegation grants already work. Fail-closed: unknown sets expand to
nothing.

## 6 · Scheduling engine

Pure, deterministic (`packages/core/fixture.ts`): circle-method round robin (1–2 legs,
byes, balanced home/away) + slot assignment (kickoff times × grounds per day; rounds
never share a day → conflict-free by construction). Identical inputs → identical
fixtures, regression-pinned. Fixture numbers `<CODE>-F###` (e.g. `MPL26-F001`) are
derived once and stored — stable forever, human-searchable, never database ids.

## 7 · Conflict engine

One pure shared authority: `detectConflicts(fixtures, window)` → sorted, typed conflicts.
Blocking (aggregate-refused): team double-booking, ground double-booking, invalid
duration/kickoff, outside competition dates. Warning (surfaced): venue overlap,
same-pair-same-day. Cancelled fixtures hold no slot; drafts with slots do. Scope = the
org (grounds are physical). Consume this module — never reimplement scheduling rules.

## 8 · Read models

Server-driven, paginated (≤100/page, stable tiebreaks): fixture dashboard queries,
calendar day/week, competition timeline, upcoming, match-day by ground, organizer
schedule, registration dashboard (search/filter/sort/stats/duplicate flags), audit
timelines. All return plain frozen shapes — no ORM entities cross the boundary.

## 9 · Snapshot model (the downstream contract)

`scheduleSnapshot(db, competition)` → **deep-frozen, deterministic** projection:
`{ competition{id,name,slug,code,status,location,startsOn,endsOn}, teams[], venues[]
(with grounds), fixtures[] (FixtureSnapshots, seq order), stats }`. No generated-at:
identical state ⇒ identical bytes. CSV export = `serializeScheduleCsv(snapshot)` (pure).
**Downstream modules (Auction, Match, Operations) consume snapshots — never mutable
fixture entities.** See ADR-ScheduleSnapshot.

## 10 · API overview

Next server actions (internal RPC; no public REST yet — 0A ruling). One gate everywhere:
session → membership-gated tenant resolution (non-member ≡ 404) → capability → aggregate
→ audit. Full surface + CSV formats: [API.md](API.md).

## 11 · Database schema

Seven org-scoped tables (`org_id` char(26) ULIDs, app-generated): `seasons`,
`competitions`, `teams`, `registrations`, `venues`, `grounds`, `fixtures`. Kickoffs and
competition dates are TEXT wall-clock (lexicographic = chronological, indexed).
Migrations 0005–0007 (drizzle-kit generated + hand-appended RLS), idempotent, forward-only.
Indexes cover the hot paths: `(competition_id, kickoff_at)`, `(ground_id, kickoff_at)`,
`(org_id, kickoff_at)`, registration number/team/person, unique identity constraints (§4).

## 12 · RLS strategy

Every competition table: `ENABLE` + `FORCE ROW LEVEL SECURITY`, one policy with **both**
`USING` and `WITH CHECK` on `org_id = current_setting('app.org_id', true)` — NULL when
unset → fail closed (the RC-4 lesson applied at creation). `registrations` adds
`OR person_id = app.person_id` on read only (a player sees their own row). Proven per
table by non-superuser probe tests (read: cross-tenant + no-context = 0 rows; write:
cross-tenant insert rejected). **Known condition**: the app still connects as superuser
locally; `withTenant()` serving-path wiring is the named pre-deploy item (carried from
IP-2, spans all three phases' tables).

## 13 · Known assumptions

One timezone per deployment (wall-clock TEXT time model) · slugs are the tenancy handle;
non-membership is indistinguishable from non-existence · drafts with slots hold them in
conflict checks · generation is refused while live fixtures exist (stable numbers) ·
team ids are per-competition (no cross-competition team identity — franchise Seasons
were explicitly deferred at M-IP3-1) · audit log is append-only (grant-enforced + tested).

## 14 · Remaining risks

(1) RLS not load-bearing in the serving path until `withTenant()` wiring (pre-deploy,
carried). (2) Conflict pre-check races under concurrent organizer mutations — identity
constraints stay safe; serializable-transaction upgrade is the known hardening.
(3) O(n²) conflict scan headroom to a few thousand fixtures per org (measured 2.3 ms at
520). (4) No git remote/CI — all gates are local runs (IP-0 founder tail).

## 15 · Future extension points (declared, not stubbed)

`AuctionReady`+ competition states (IP-4 guards, invariants 15/16) · auction pool = a
projection over approved registrations · squads = projections of auction purchases
(doc 43, IP-4) · match results/standings/statistics consume fixtures + the same conflict
engine · per-competition delegation grants (`tournament` scope — enforcement already
composes) · richer Seasons (franchise identity) = an explicit founder scope decision ·
public REST `/v1` when the 0A deferral lifts · multi-timezone = revisit the recorded
wall-clock assumption.
