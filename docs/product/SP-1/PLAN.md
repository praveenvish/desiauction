# SP-1 — MULTI-SPORT · PROGRAMME PLAN

## DesiAuction NEXT · 2026-09-05 · Architecture · **Status:** Phase 0 COMPLETE · Phases 1–4 GATED

Taking the platform beyond cricket. Scope is **sports only** — auction
categories outside sport (asset, commodity, charity) are deliberately deferred
and §6 records why.

---

## 1 · What the core actually is

Stripped of vocabulary, this platform does one thing:

> A contested allocation of scarce named participants to budget-constrained
> bidders, conducted live under a gavel, with an auditable money trail
> afterwards.

Nothing in that sentence is cricket, and nothing in it is even sport. That is
why the engine came out sport-neutral without anyone aiming at it: the domain
modelled was auctions, and cricket was only ever spoken at the edges.

A sport contributes exactly three things on top of that core, and these three
are the entire scope of this programme:

1. **A vocabulary for a participant** — roles, attributes.
2. **A shape for a result** — what a scoreline holds, what is plausible, how a
   league table breaks ties.
3. **Terminology** — player or athlete, match or tie, ground or court or mat.

## 2 · What was already clean (measured, not assumed)

| Area | Finding |
|------|---------|
| `packages/auction` | `lots` key on `registration_id`. Role is never denormalized onto a lot, bid or paddle. **Zero** cricket concepts. |
| `packages/settlement`, `packages/financial-operations` | Money, obligations, journals, issuance. No sport nouns. |
| `tournaments · competitions · franchises · teams · fixtures · venues · grounds` | Not one sport-specific column. |
| `core/eligibility.ts` | Entry categories `open / men / women / mixed` — already sport-neutral. |
| `core/standings.ts` | `PointsPolicy` is already an **injected input**, not a constant. |
| `fixture_results.outcome` | `home_win / away_win / tie / no_result / abandoned` — true in every team sport. |
| `org_import_mappings.mapping` | JSONB keyed by field NAME, so new sport fields need no migration on it. |

## 3 · The decision: packs, not admin-defined sports

A sport is **not data. It is a contract with validators.** Eleven wickets is
impossible; 47–0 in football is suspicious; a pickleball game ends at 11. Those
rules cannot be typed into an admin form without building a rules DSL — a
programming language with no type checker and no debugger, operated by a
non-engineer at 11pm before an auction.

Two designs were considered and rejected:

- **Free-form attributes in the database.** Maximum flexibility; loses type
  safety, stops the eligibility engine reasoning, stops the import mapper
  validating, and makes guardrail tests impossible to write.
- **A rules engine in the admin UI.** See above.

**Adopted:** each sport is a typed pack file in `packages/core/src/sports/`.
Admin controls which packs are **live** (a `sports` catalogue table with an
enabled flag), never what a pack **contains**. Admin writes a flag, not a
definition — which is also the smallest possible widening of the read-only
`/admin` posture, and one the audit log can carry.

## 4 · Scope boundary

> The platform serves competitions where individuals register, owners bid to
> form squads, and squads then play fixtures.

| Verdict | Sports | Why |
|---------|--------|-----|
| **Fits now** | Cricket · box cricket · football · kabaddi · hockey · volleyball · basketball · esports | Team leagues, squad formation, one score per fixture. A pack each. |
| **Fits, Phase 2** | Badminton · table tennis · tennis · pickleball | Run as auction team leagues here, so they belong — but a team *tie* is several rubbers, not one scoreline. Needs `fixtureShape: "single" \| "rubbers"`. Build when a club asks. |
| **Out of scope** | Individual ladders · athletics · chess opens · marathons | No team formation means no auction, which means none of this engine applies. That is a tournament platform, not this one. |

## 5 · Phases

| # | Phase | Cost | Migrations |
|---|-------|------|------------|
| **0** | **The seam** — registry, cricket pack, guardrail. No behaviour change. | 2 wks | **0** |
| 1 | Sport becomes a dimension — `competitions.sport`, `tournaments.sport`, `sports` catalogue, admin toggle. Backfill all rows to `cricket`. | 1.5 wks | 1 |
| 2 | **Ship the second sport end to end** — relax `registrations.role` (nullable, enum dropped), add `registrations.attributes jsonb`, `fixture_results.score jsonb`, standings tiebreaker chains, pack-driven import fields, terminology across ~95 components. | 3 wks | 2 |
| 3 | Split the person from the player — `player_sport_profiles`, `/me/[sport]`, per-sport career. | 2 wks | 1 |
| 4 | The long tail — one pack file per further sport. | 2–4 days each | 0 |

**Phase 0 is unconditional.** It has no migrations, no behaviour change, and it
pays for itself by deleting a duplication defect that already shipped (§ the
Phase 0 report).

**Phases 1–4 are GATED on demand, not scheduled.** Seven weeks aimed at demand
nobody has observed is the wrong bet on a product whose own audits say the
remaining gaps are commercial, not engineering.

**The gate costs one day:** put a sport picker on `/schedule-demo` (the
`demo_requests` table already exists) and on the pricing and landing pages, then
read it at four weeks. Do not write a second pack before a named organizer has
asked for one — *a pack written without a user is a guess with a type
signature*, and the second implementation is the only thing that proves whether
the abstraction is right.

## 6 · Why sport, and not other auction categories

The purse is a **budget, not a wallet**. No rupee moves at the lot level; a bid
is an allocation claim. The moment a real asset is auctioned, every bid becomes
a financial commitment and the product inherits KYC, escrow, payment capture,
title transfer, dispute resolution and fraud. That is a payments-and-trust
company wearing this UI, and the engine's hardest-won properties — invariant 18,
the single-writer lease, gavel recovery — buy nothing there.

## 7 · Risks carried

- **Schema-free rollback ends at Phase 1.** PX-2…PX-11 shipped zero migrations.
  This programme is four. Sequence them one per phase and rehearse each rollback.
- **Admin becomes a writer** for the first time. Amend the read-only runtime
  proof deliberately, to permit the flag write and nothing more.
- **`packages/ui` can never read a pack** — the `no-ui-to-core` dependency rule
  forbids it. Sport-aware copy must reach UI components as props. This is a
  Phase 2 design constraint, discovered in Phase 0.
- **Copy is the sleeper cost.** "Player" appears in 95 of 240 components. Budget
  it honestly inside Phase 2; it is what makes a football organizer believe the
  product is for them rather than a cricket tool with the words swapped.
- **The abstraction may be wrong.** It usually is on the first pass. That risk is
  contained entirely by refusing to write a second pack before a real user.
