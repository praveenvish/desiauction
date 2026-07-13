# M-IP3-1 MILESTONE REPORT · DOMAIN FOUNDATION

## IP-3 Competition Core · 2026-07-14 · CTO · Awaiting founder review

## 1 · What was built

The Competition domain foundation — the canonical model every later module consumes.
No auction, money, or messaging (out of phase). Delivered as a demonstrable vertical
slice, rules-in-`core` / persistence-in-`db` / web-orchestration-only:

- **`packages/core/src/competition.ts`** — two explicit state machines (doc 39): the
  **Competition lifecycle** (`draft → setup → registration_open ⇄ registration_closed`,
  with a guard requiring name+dates+location before intake opens, doc 44) and the
  **Registration lifecycle** (`draft → submitted → approved/rejected/waitlisted →
  withdrawn`, with a mandatory private rejection-reason category, invariant 6). Pure,
  fail-closed, illegal transitions unrepresentable. Plus name/slug/year validation and
  the role + rejection-reason vocabularies.
- **Capability model extension** (additive to frozen `capabilities.ts`) — new
  `competition.create/manage`, `team.manage`, `registration.review` on the closed
  `Capability` union; `org:owner` gains all four, `org:staff` gains review + team.manage.
- **`packages/db` migration 0005** — `seasons`, `competitions`, `teams`, `registrations`
  (org-scoped, ULID ids). RLS `ENABLE`+`FORCE` with **both** `USING` and `WITH CHECK`
  on every table from day one (the RC-4 lesson applied at creation); registrations carry
  a person-scoped read disjunct for the player's own status view.
- **`apps/web/src/server/competition/`** — domain services + server actions (internal
  RPC). Every mutation flows session → tenant → capability → act → audit. Scope
  hierarchy (`org` grant confers competition capability) composes the frozen
  `hasCapability` without modifying it.
- **FLOODLIGHT UI** — `/competitions` (list + create), `/competitions/[slug]`
  (lifecycle gate, teams, triage queue), `/competitions/[slug]/register` (player
  registration). Frozen `ui@0.1.0` only.

## 2 · What was verified (all green, local)

| Gate | Result |
| --- | --- |
| TypeScript | ✓ strict, 7/7 workspaces, zero source suppressions |
| Lint | ✓ 0 errors, 7/7 |
| Unit | ✓ 90 — core **31** (competition machines 14 + capability 8 + money/phone/clock) · ui 52 · engine 5 · contracts 2 |
| Integration (PG17) | ✓ 39 — **competition regression 10** (capability enforcement, lifecycle guard, team-name uniqueness, duplicate registration, triage machine, **RLS READ PROOF** + **RLS WRITE PROOF** on the new tables) · auth 7 · authz 12 · security 8 · engine 2 |
| E2E (real Chrome) | ✓ 40 — new competition journey (create → open → team → register → approve) + registration-refused-before-open + **axe zero** on /competitions; 37 identity/UI unchanged |
| Boundaries | ✓ dep-cruiser 0 violations / 348 modules; `core` pure, `db` leaf, web orchestrates |
| Migrations | ✓ 0000–0005 apply idempotent; RLS enabled+forced+both-policies confirmed on all four new tables |
| Build | ✓ production build clean; three new dynamic routes |

## 3 · Engineering decisions

- **Migration authored via `drizzle-kit generate` + hand-appended RLS.** Repaired the
  0003/0004 snapshot id-chain (RLS-only migrations had duplicated snapshot ids) so the
  generator could diff cleanly, then appended the RLS block by hand (drizzle does not
  model policies). Journal `when` ordering matters: 0005 had to sort after 0004 or the
  migrator skips it — fixed and re-proven idempotent.
- **Scope hierarchy composes frozen core, never edits it.** `requireCompetitionCapability`
  checks the frozen `hasCapability` at both org and competition scope and ORs them —
  realizing the hierarchy the IP-2 capability comment anticipated for IP-3, with zero
  change to the frozen pure function.
- **New tenant tables get RLS read+write from day one.** The RC-4 finding is now a
  standing build rule: every org-scoped table ships `USING` + `WITH CHECK` together,
  pinned by a per-table RLS WRITE PROOF.

## 4 · Domain decisions (flagged for the founder)

- **Terminology: "Competition" ≡ the Canon's "Tournament".** The OPEN IP-3 directive
  names Competition/Season; docs 38–44 name the stage Tournament and defer Season to H2.
  I adopted **Competition** as the canonical entity (all tournament rules carry) and
  brought **Season** forward as a **minimal container only** (org-owned name+year that
  groups competitions), explicitly not cross-season franchise identity — teams still
  belong to exactly one competition (doc 43). **If you intended richer Seasons
  (franchise teams across seasons), that is a scope change to rule on now.**
- **Person ≠ participation (invariant 3).** No "Player" table duplicates the frozen
  `people` identity; a **Registration** is a person's participation, and "player" = an
  approved registration. **Squads are deferred** — doc 43 defines squad membership as a
  projection of auction purchases, which arrive in IP-4; modelling it now would be
  premature.
- **Machines are the pre-auction slice.** `AuctionReady` and beyond are declared future
  states (IP-4 guards, invariant 15/16), not stubbed.

## 5 · Risks

- **RLS still not load-bearing in the serving path** (carried from IP-2): the app
  connects as superuser locally; competition RLS is proven under a non-superuser probe
  but the `withTenant()` wiring remains the named pre-deploy item — now spanning the
  IP-2 and IP-3 tables together.
- **Registration OTP-at-submit (doc 42) is satisfied via the existing session**, not a
  fresh per-submission OTP; the richer per-registration verification + status page +
  triage-at-scale ergonomics are M-IP3-2 scope.
- No git remote yet (IP-0 founder tail) — all gates local; the branch is unpushed.

## 6 · Founder demonstration (open the app, ~4 minutes)

`docker compose up -d db && pnpm dev` → sign in → create an organization → **/competitions**:
create "MPL 2026" with dates + location → **Begin setup → Open registration** (watch the
single lifecycle gate advance) → add team "Malad Mavericks" → copy the registration link
→ in a second browser, sign in as a player and **submit a registration** → back as the
organizer, **approve** them from the triage queue. Every step is the exact e2e journey,
40/40 green — the demo cannot surprise us.

## 7 · Recommended founder decision

**APPROVE M-IP3-1** and authorize **M-IP3-2 (Registration at Scale** — registration-link
tokens, the player status page, triage-queue ergonomics for 200+ applicants, imports).
One decision is genuinely yours: **confirm the Season scope** (minimal container as built,
or richer franchise model) before it hardens into more milestones. IP-3 does not freeze
until M-IP3-4 (Competition APIs + DoD sweep); this milestone adds a tangible, tested,
demonstrable capability with zero regressions to the frozen Identity and FLOODLIGHT
subsystems.
