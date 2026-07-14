# COMPETITION THREAT MODEL

## DesiAuction NEXT · v1.0 · 2026-07-14 · CTO · **Permanent engineering asset** (IP-3, M-IP3-4)

> Implemented reality only, at `ip3-frozen`. Extends the frozen
> [identity threat model](../identity/THREAT_MODEL.md) — session, OTP, capability and
> tenancy threats live there and are not repeated. Stages follow the directive's flow:
> Competition → Registration → Scheduling → Fixtures → Snapshots → Auction Consumption.

## 1 · Competition (creation & lifecycle)

- **Trust boundary**: authenticated session → org membership → capability
  (`competition.create` / `competition.manage`).
- **Assets**: competition identity, lifecycle status (gates registration intake), teams.
- **Threats**: cross-org creation/advance; lifecycle bypass (opening intake on an
  unconfigured competition); slug enumeration of foreign competitions.
- **Attack vectors**: forged server-action calls with foreign slugs/orgIds; direct DB
  writes if the app layer is bypassed.
- **Mitigations**: membership-gated `resolveCompetition` (non-members ≡ 404); capability
  checks at org OR competition scope (frozen `hasCapability`, fail-closed); core machine
  refuses undeclared edges and unguarded opens; RLS `USING`+`WITH CHECK` on
  competitions/teams/seasons; all mutations audited.
- **Regression tests**: capability enforcement + cross-org refusal, lifecycle guard, full
  walk, team-name uniqueness, RLS read+write proofs (`competition.regression.test.ts`).
- **Residual risks**: RLS not yet load-bearing in the serving path (superuser local
  connection; `withTenant()` = named pre-deploy item, carried from IP-2).

## 2 · Registration (submission, triage, import, export)

- **Trust boundary**: any authenticated person may submit while intake is open;
  triage/import/export require `registration.review`.
- **Assets**: personal data (name, phone via person link), registration status
  (auction-pool eligibility), private rejection reasons, reviewer notes.
- **Threats**: duplicate/forged registrations; triage by non-reviewers; approval without
  a human; rejection-reason leakage to players; bulk actions corrupting state; malicious
  CSV (oversized, duplicate phones, injection); export exfiltration.
- **Attack vectors**: replayed submit calls; crafted bulk id lists crossing competitions;
  CSV rows targeting other orgs' people.
- **Mitigations**: unique (competition, person); status transitions only via the
  Registration aggregate (core machine, reject requires a reason category); bulk plans
  are core-decided (≡ N singles) and skip foreign-competition ids (tenant safety);
  imports validate the WHOLE file in core before any write and commit atomically;
  exports gated by `registration.review` and competition-scoped; rejection
  reason/notes render only on reviewer surfaces; person-scoped RLS read disjunct lets a
  player see only their OWN row.
- **Regression tests**: duplicate block, reason-required, bulk ≡ singles, bulk rollback,
  import atomicity + re-run dedup, export scoping + authorization, audit completeness
  (`registration-ops.regression.test.ts`).
- **Residual risks**: import-created person stubs are unverified until first OTP login
  (accepted: they still pass the human approval gate); no per-file size cap beyond
  request-body limits.

## 3 · Scheduling (generation)

- **Trust boundary**: `fixture.manage` on the competition.
- **Assets**: schedule integrity and determinism; stable fixture numbers.
- **Threats**: non-deterministic or biased schedules; regeneration corrupting stable
  numbers; scheduling onto foreign or unavailable grounds; slot collisions with other
  competitions.
- **Attack vectors**: crafted generator inputs (duplicate teams, foreign ground ids,
  malformed dates/times).
- **Mitigations**: pure generator (no randomness/clock) with fail-closed input
  validation; grounds verified org-owned AND active; generation refused while live
  fixtures exist; candidate set conflict-checked against the whole org before insert;
  `(competition, seq)` unique index makes concurrent generation fail loudly.
- **Regression tests**: determinism (identical competition → identical schedule),
  conflict-free-by-construction, refusal on existing fixtures, unknown-ground refusal.
- **Residual risks**: none known beyond stage-6 consumption.

## 4 · Fixtures (lifecycle & reschedule)

- **Trust boundary**: `fixture.manage`; match-day operations use the same gate.
- **Assets**: the permanent invariants — no simultaneous team/ground, window containment,
  published-move-only-via-reschedule, completed immutability; audit provenance.
- **Threats**: hidden transitions (draft→published, scheduled→completed); silent edits of
  published fixtures; mutation of completed fixtures; conflict-check bypass; partial
  states under failure.
- **Attack vectors**: direct calls to lifecycle actions out of order; patches carrying
  malformed kickoffs/durations; cross-tenant fixture ids.
- **Mitigations**: the Fixture aggregate is the only writer; core machine has no hidden
  edges and terminal states have no exits; edit/reschedule predicates enforce the
  published/completed rules; every mutation conflict-checked (blocking refused) and
  committed with its audit row in one transaction (rollback-proven); fixture ids resolve
  within the caller's competition only; RLS `USING`+`WITH CHECK` on fixtures.
- **Regression tests**: illegal transitions, published protection, completed immutability
  (reschedule/edit/cancel all refused), cancel-releases-slot, mid-transaction rollback,
  audit completeness, RLS read+write proofs, team/ground/window refusals.
- **Residual risks**: conflict checks read state before the write transaction — two
  simultaneous organizer mutations could theoretically both pass the pre-check; identity
  constraints (unique seq/number) stay safe, and organizer-scale concurrency makes the
  interval race acceptable (recorded; a serializable-transaction upgrade is the known
  hardening if multi-organizer concurrency becomes real).

## 5 · Snapshots (read models & exports)

- **Trust boundary**: snapshot construction is server-side only; export delivery requires
  `fixture.manage` / `registration.review`.
- **Assets**: consistency of what downstream consumers see; export contents (fixtures CSV
  carries no personal data; registrations CSV does — names + phones).
- **Threats**: downstream mutation of shared projections; cross-tenant leakage through a
  snapshot; non-reproducible exports.
- **Attack vectors**: a consumer mutating a cached snapshot; crafted competition ids.
- **Mitigations**: snapshots are deep-frozen (`Object.freeze` at every level — mutation
  throws in strict mode); built only from a membership-resolved `CompetitionSummary`;
  deterministic (no ambient time) so identical state serializes identically; the CSV
  export is a pure serialization of the snapshot with no separate query path.
- **Regression tests**: SCHEDULE SNAPSHOT test (determinism, deep immutability,
  reconciliation, self-contained ground references), export tenant-scoping.
- **Residual risks**: none known at this stage.

## 6 · Auction Consumption (future trust boundary — declared, not built)

- **Trust boundary**: IP-4's engine consumes Competition server-side via
  `scheduleSnapshot` / approved-registration projections — never tables, never mutable
  entities.
- **Assets**: the guarantee that what the auction ingests is exactly what the organizer
  published.
- **Threats**: an engine writing back into Competition; consuming mid-mutation state.
- **Existing mitigations**: dependency direction is one-way and boundary-enforced
  (dep-cruiser: nothing in Competition imports Auction — it does not exist); the only
  sanctioned read surface is immutable; aggregates are not exported to the engine app.
- **Regression tests**: boundary check (0 violations / full module graph) runs in every
  sweep.
- **Residual risks**: IP-4 must add its own gate ("competition ready for auction" —
  the declared `AuctionReady` machine states) before ingesting; recorded as an IP-4
  entry requirement, not an IP-3 gap.

## Cross-cutting assumptions

Single timezone per deployment (wall-clock time model) · local-first: no external
services in any Competition path · audit log is append-only (IP-2 AUDIT PROOF) and every
Competition mutation writes to it · the five-capability closed union grows only by
reviewed schema change (IP-2 THREAT_MODEL §7 path).
