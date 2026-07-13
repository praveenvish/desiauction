# IP-3 — COMPETITION CORE · DETAILED DESIGN

## DesiAuction NEXT · v1.0 · 2026-07-14 · CTO · Active phase artifact

> Governed by Blueprint §IP-3, Canon C-3/C-8/C-9/C-13/C-23/C-24, and the ratified
> domain docs [38-domain-model](../38-domain-model.md), [39-state-machines](../39-state-machines.md),
> [42-registration-rules](../42-registration-rules.md), [43-team-rules](../43-team-rules.md),
> [44-tournament-rules](../44-tournament-rules.md). Consumes **frozen** `ip2-frozen`
> (Identity & Tenancy) and `ui@0.1.0` (FLOODLIGHT); neither is redesigned. Detailed
> design exists for IP-3 only.

## 1 · Executive summary

IP-3 builds the **Competition domain** — the canonical model of who competes, in what,
and under whose organization — that every later module consumes and none redesigns.
Auction (IP-4) consumes Competition; Money (IP-6) consumes Auction; Operations consume
all. The dependency direction is one-way and permanent (C-9 spine). This phase owns the
domain model and its lifecycle machines; it does **not** own the auction experience,
money, or messaging. Rules live in `packages/core` (pure, machine-tested), persistence
in `packages/db` (org-scoped rows, RLS read+write from day one), and `apps/web` is
orchestration only — every mutation flows through the frozen Identity chain
(session → tenant → capability → act → audit) and renders in frozen FLOODLIGHT.

## 2 · Terminology reconciliation (a domain decision, flagged for the founder)

The OPEN IP-3 directive names **Seasons** and **Competitions**; the ratified Canon docs
name the stage **Tournament** and defer the **Season lens** to H2 (doc 38: "V1 refuses
premature abstraction"). Reconciliation, recorded so a future team is not confused:

- **Competition ≡ the Canon's Tournament** (doc 38's "the product's stage"). IP-3 adopts
  the directive's term **Competition** as the canonical entity name across the code and
  future docs; docs 38–44's "Tournament" refers to the same entity. All tournament rules
  (identity, lifecycle, readiness gates, teams, registration, dignity) carry unchanged.
- **Season** is brought forward from H2 as a **minimal container only** (org-owned, a
  name + year that groups competitions). It is explicitly **not** franchise-identity-
  across-seasons (teams still belong to exactly one competition, doc 43). This satisfies
  the directive's "Seasons" objective without the premature abstraction doc 38 warns
  against. Season is nullable on a competition — standalone competitions are first-class.

If the founder intended a richer Season model (cross-season franchise teams), that is a
scope change to rule on before it hardens; the minimal container is the conservative,
Canon-consistent reading.

## 3 · Architecture decisions

- **D1 · Rules in `core`, persistence in `db`, web orchestrates.** Every lifecycle is an
  explicit state machine in `packages/core` (doc 39): typed states, typed transitions
  with guards, fail-closed, exhaustively unit-tested. Illegal transitions are
  unrepresentable, not merely rejected. Web server actions validate input, call core for
  the decision, call db for persistence, and write audit — no business rule lives in a
  route (directive: "No business rules inside routes").
- **D2 · Competition rows are org-scoped and RLS-locked from day one.** Every new table
  carries `org_id` (C-13, invariant 1) and gets `ENABLE`+`FORCE ROW LEVEL SECURITY` with
  **both** a read policy (`USING`) and a write policy (`WITH CHECK`) — applying the RC-4
  lesson (a `USING`-only policy is a write-side self-escalation hole) at creation rather
  than retrofitting it. Registrations additionally carry a person-scoped read disjunct
  (a player reads their own status page, doc 42), mirroring `grants`.
- **D3 · Authorization extends the frozen capability model additively.** New capability
  strings (`competition.create`, `competition.manage`, `team.manage`,
  `registration.review`) join the closed `Capability` union in `core/capabilities.ts` —
  the sanctioned "reviewed schema change" growth path (IP-2 THREAT_MODEL §7), not a
  redesign. `org:owner` gains all four; `org:staff` gains `registration.review` +
  `team.manage` (staff run triage). The frozen pure `hasCapability` is **not modified**.
- **D4 · Scope hierarchy lives in the enforcement layer, composing frozen core.** The
  IP-2 capability comment anticipated "org grants implying tournament access — arrive
  with tournaments in IP-3, as an explicit rule." Realized as a web helper
  `requireCompetitionCapability` that resolves competition → `orgId` and calls the frozen
  `hasCapability` at **both** the competition scope (`tournament` scope-type) and the
  parent org scope, OR-ing them. In M-IP3-1 grants are issued at org scope (owners/staff
  run all their org's competitions); per-competition delegation grants (`tournament`
  scope) already work through the same helper when issued later.
- **D5 · Person ≠ participation (doc 38, invariant 3).** No "Player" table duplicates the
  frozen `people` identity. A **Registration** is a Person's participation in one
  Competition (form data, role, lifecycle). "Player" = an approved registration. Squad
  membership is deferred: doc 43 defines it as a projection of auction purchases +
  pre-assignments, which do not exist until IP-4 — modelling a squad table now would be
  premature.
- **D6 · Machines are the pre-auction slice only.** IP-3 M-IP3-1 implements the
  Competition lifecycle up to registration (`Draft → Setup → RegistrationOpen ⇄
  RegistrationClosed`) and the full Registration machine
  (`Draft → Submitted → Verified → Approved/Rejected/Waitlisted → Withdrawn`, doc 39).
  `AuctionReady` and beyond are IP-4 guards (invariant 15/16) and are left as declared
  future states, not stubbed.
- **D7 · Contracts unchanged this milestone.** `packages/contracts` is web↔engine wire
  shapes (zod-only by dep rule — cannot import core). The engine consumes Competition at
  IP-4; public REST `/v1` stays deferred (0A ruling). M-IP3-1 "Competition APIs" are Next
  server actions (internal RPC, C-14). Input validation is co-located in web.

## 4 · Schema (packages/db, migration 0005_competition)

`seasons(id ulid pk, org_id, name, year int, created_by, created_at)` — minimal container.
`competitions(id, org_id, season_id null, name, slug unique, status, visibility, location null, starts_on null, ends_on null, created_by, created_at)` — status default `draft`, visibility default `private` (doc 44).
`teams(id, org_id, competition_id, name, short_name null, primary_color null, created_by, created_at)` — unique `(competition_id, name)` (doc 43: name unique within competition).
`registrations(id, org_id, competition_id, person_id, role, status, base_price_band null, rejection_reason null, rejection_note null, reviewed_by null, reviewed_at null, created_at)` — unique `(competition_id, person_id)` (doc 42: one registration per person per competition).
RLS: all four `ENABLE`+`FORCE`; read `USING (org_id = app.org_id)` (registrations add `OR person_id = app.person_id`); write `WITH CHECK (org_id = app.org_id)`.

## 5 · Verification strategy

Unit (`core`): both state machines (every legal + representative illegal transition;
guard functions), capability expansion (owner ⊇ staff still holds; new caps fail-closed),
name/slug validation, rejection-reason completeness. Integration (`web` vs real PG):
create-season/competition/team + register + triage through the capability chain; the
duplicate-registration block; rejection requires a reason (invariant 6); **RLS READ
PROOF** and **RLS WRITE PROOF** for the four new tables under a non-superuser probe;
audit rows written. E2E (real Chrome): the founder journey — create a competition, add a
team, register a player, approve them — on FLOODLIGHT screens, axe zero, 360px.

## 6 · Milestones

| ID | Name | Scope |
|----|------|-------|
| M-IP3-1 | **Domain Foundation** | Season + Competition + Team + Registration schema; core machines + rules; capability extension; web services + a demonstrable FLOODLIGHT slice (create competition → team → register → triage); full gates | **this milestone** |
| M-IP3-2 | Registration at Scale | Registration links (tokens), player status page, triage queue ergonomics (doc 42: 20-min job), imports/staging | planned |
| M-IP3-3 | Fixtures & Venues | Venues, grounds, fixtures, match lifecycle, results, standings, statistics (doc 38 H2 lens brought into scope by the directive) | planned |
| M-IP3-4 | Competition APIs & Freeze | shared contracts for engine consumption (IP-4 input), DoD sweep → freeze | planned |

## 7 · Definition of Done (phase)

All §5 suites green including RLS read+write proofs on every new table · both machines
property-covered · the founder can open the app and run a competition end-to-end through
registration · guardrails green (boundaries incl. new tables org-scoped, token purity) ·
migrations idempotent · dependency direction verified one-way (nothing in Competition
imports Auction/Money — they do not exist) · GATES entry · tag `ip3-frozen`.

*IP-3_DESIGN.md v1.0 · CTO · 2026-07-14. Build starts at M-IP3-1 immediately; founder
veto is async per the Delegation Charter. Competition is a permanent subsystem: future
phases consume it, they do not redesign it.*
