# COMPETITION ARCHITECTURE DECISION RECORDS

## DesiAuction NEXT · v1.0 · 2026-07-14 · CTO · **Permanent engineering asset** (IP-3, M-IP3-4)

> Five ADRs, all **Accepted** and implemented at `ip3-frozen`. Each records the decision
> as built — no speculation. Format: Context → Decision → Consequences → Evidence.

---

## ADR-CompetitionAggregate — all Competition mutations pass through one audited path

**Context.** Competition state (lifecycle status, teams, seasons) gates everything
downstream: registration intake opens only from a ready competition (doc 44), auctions
(IP-4) will start only from a closed pool. Scattered writes would let a route bypass a
guard and corrupt the machine.

**Decision.** Competition mutations exist only in `competitions.ts`, and every lifecycle
change flows through `advanceCompetition`, whose decision comes from core's pure
`competitionTransition` machine (typed edges, setup→open guard on name+dates+location).
Server actions gate each call (session → tenant → capability → act) and every mutation
writes an audit row. Registration and Fixture mutations are delegated to their own
aggregates (below) — the Competition aggregate owns *what exists*; the others own their
lifecycles.

**Consequences.** Illegal lifecycle jumps are unrepresentable, not just rejected; UI can
only render the single legal next step. Adding a lifecycle edge is a reviewed core
change, never an ad-hoc UPDATE.

**Evidence.** `competition.regression.test.ts` (guard blocks opening without
dates/location; full walk; cross-org capability refusals); 14 core machine unit tests.

---

## ADR-FixtureAggregate — the fixture lifecycle is centralized in one module

**Context.** Fixtures carry permanent invariants (no simultaneous team/ground, dates
inside the window, published moves only via reschedule, completed immutable). Any second
write path would eventually violate one silently — the RC-4 lesson (a second, unguarded
path is where escalations live) applied to scheduling.

**Decision.** `fixture-aggregate.ts` is the ONLY module that writes fixture rows. It owns
generate, create, edit, schedule, publish, reschedule, start, complete, cancel. Every
operation: (1) loads current state, (2) asks core's `fixtureTransition` /
edit-reschedule predicates for legality, (3) runs the conflict engine over the org's
fixtures and refuses blocking conflicts, (4) commits the mutation and its audit row in
one transaction. `start` is included although the directive's op list omitted it: the
canonical machine requires the published→in_progress edge and nothing else may mutate
fixtures — so the aggregate owns every edge. Bulk operations (schedule-all, publish-all)
iterate the single operation: bulk ≡ N singles, per-fixture audit, no shortcut.

**Consequences.** Invariants are machine-enforced at one choke point; a mid-transaction
failure leaves no partial state (regression-proven); generation is refused while live
fixtures exist so stable numbers can never be reallocated.

**Evidence.** `fixture-ops.regression.test.ts`: illegal transitions, published
protection, completed immutability, rollback safety, audit completeness — 25 tests.

---

## ADR-ConflictEngine — scheduling conflicts are deterministic, structural, and shared

**Context.** "Conflict" must mean the same thing to the fixtures dashboard, the
aggregate's refusal logic, CSV import, future Auction scheduling and Match Operations. A
heuristic or duplicated implementation would drift per consumer, and a non-deterministic
one could not be regression-pinned.

**Decision.** One pure function, `detectConflicts(fixtures, window)` in `packages/core`:
interval and identity arithmetic only — no heuristics, no clock, no storage. Conflicts
carry a closed type union with a fixed severity map: **blocking** = the directive's
permanent invariants (team/ground double-booking, malformed kickoff/duration, outside
competition dates); **warning** = structurally suspicious but legal (same-venue overlap,
same-pair same-day). Output is sorted by (type, fixture ids) — the same input set in any
order yields the identical conflict list. The aggregate refuses blocking conflicts
involving the candidate; warnings render in the dashboard. Interval/pair-key/date values
are precomputed once per fixture (O(n) parses before the O(n²) pair scan) — a measured
M-IP3-4 optimization (127 ms → 2.3 ms at 520 fixtures) with zero behavior change.

**Consequences.** Conflict behavior is a testable contract; consumers cannot disagree;
future engines import the module instead of reimplementing scheduling rules.

**Evidence.** 9 conflict-engine unit tests (each type, severity split, cancelled-releases,
order-independence); aggregate refusal tests (team/ground/window) in the regression
suite; performance numbers in [PERFORMANCE](PERFORMANCE.md).

---

## ADR-ScheduleSnapshot — downstream systems consume immutable snapshots

**Context.** Calendar, exports, and the future Auction and Match engines need a
competition's schedule. Letting them query mutable fixture rows would couple them to the
write model, leak lifecycle concerns, and make "what the auction saw" unreproducible.

**Decision.** One canonical read model: `scheduleSnapshot(db, competition)` →
deep-frozen projection (competition identity + code + window, teams, referenced
venues/grounds, all `FixtureSnapshot`s in seq order, stats). Deterministic by
construction: every list carries a total order and there is no generated-at field — the
same database state always yields the same value, byte for byte when serialized. The CSV
export is `serializeScheduleCsv(snapshot)`, a pure function; no export path reads rows.
Mutable entities stay private to the aggregate.

**Consequences.** Downstream modules cannot mutate or observe intermediate states; a
snapshot can be handed to the Auction engine as a stable input; export determinism is a
tested fact. Cost: one extra projection query per export/consumption — measured at
4.4 ms for 520 fixtures.

**Evidence.** "SCHEDULE SNAPSHOT" regression test (determinism, deep-frozen at every
level, stats/fixture reconciliation, ground references resolve inside the snapshot,
code = number prefix); export test serializes from the snapshot.

---

## ADR-RegistrationModel — Registration remains independent from Person

**Context.** Local tournaments re-use the same people across competitions and years.
Duplicating identity per competition ("Player" tables) fragments the person, breaks
frozen IP-2 identity, and violates invariant 3 (person ≠ participation, doc 38).

**Decision.** No Player entity. A **Registration** is a Person's participation in exactly
one Competition: form data (role, price band), lifecycle status, review provenance —
unique on (competition, person). "Player" = an approved registration. The frozen `people`
table remains the single identity anchor (phone, C-24); CSV import creates unverified
person *stubs* by phone that flow through the same human approval gate as self-service
registrations. Registrations carry a person-scoped RLS read disjunct so a player reads
their own status across orgs; writes stay tenant-locked.

**Consequences.** One person, many participations, zero identity duplication; the future
auction pool is a projection over approved registrations; squads stay deferred to IP-4
(doc 43: squad = projection of auction purchases).

**Evidence.** Duplicate-registration block (unique index + regression test), import
re-run skips already-registered people, person-scoped read policy in migration 0005.
