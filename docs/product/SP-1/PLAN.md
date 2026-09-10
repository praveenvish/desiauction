# SP-1 — MULTI-SPORT · PROGRAMME PLAN

## DesiAuction NEXT · 2026-09-05 · Architecture · **Status:** Phases 0–4 underway · cricket + football + kabaddi + volleyball live

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
| **Fits now** | Badminton · table tennis · pickleball | **Shipped 0056**, as ordinary pack files with no code change. This row read "Phase 2, needs `fixtureShape`" for a fortnight; a tie's result is one scoreline per side (rubbers won, games inside them), exactly as volleyball does sets and points. Retracted 2026-09-09. |
| **Fits now** | Battle royale (BGMI · Free Fire) | **Shipped 0058–0059.** The one sport here that genuinely needed a new shape: a lobby of many squads with no home and no away, scored on placement plus kills. `fixtureShape: "lobby"` — see `PHASE-5_NOTES.md`. |
| **Out of scope** | Individual ladders · athletics · chess opens · marathons | No team formation means no auction, which means none of this engine applies. That is a tournament platform, not this one. |

## 5 · Phases

| # | Phase | Cost | Migrations |
|---|-------|------|------------|
| **0** | ✅ **The seam** — registry, cricket pack, guardrail. No behaviour change. | 2 wks | **0** |
| 1 | ✅ **Sport becomes a dimension** — `competitions.sport`, `tournaments.sport`, `sports` catalogue, admin toggle. Backfill all rows to `cricket`. | 1.5 wks | 1 |
| 2 | ✅ **Ship the second sport end to end** — relax `registrations.role` (nullable, enum dropped), add `registrations.attributes jsonb`, `fixture_results.score jsonb`, standings tiebreaker chains, pack-driven import fields, terminology across ~95 components. | 3 wks | 2 |
| 3 | ✅ **Split the person from the player** — `player_sport_profiles`, `/me/[sport]`, per-sport career. | 2 wks | 1 |
| 4 | The long tail — one pack file per further sport. | 2–4 days each | 1 line |

**Phase 4, measured rather than estimated (2026-09-07).** Adding a sport now
costs: one pack file (~230 lines, `football.ts` is the template), two lines in
`sports/index.ts`, and a one-line `INSERT INTO sports` migration — the plan's
"0 migrations" was wrong by that one line. Nothing else changes: no schema
(attributes are jsonb), no UI (pickers, forms, standings columns and the results
form are pack-driven), no engine. The generic guardrails pick a new pack up
automatically.

Two things still block specific sports:

- **Terminology** is now wired (`components/sport-terms.tsx`), but only `ground`
  actually varies between the packs that exist — see `PHASE-4_NOTES.md`.
- **Racquet sports** — this said a team tie runs as several RUBBERS and needs
  `fixtureShape`, a Phase-2-sized change. Wrong, and repeated for a fortnight
  before anybody probed it: badminton, table tennis and pickleball shipped in
  0056 as pack files with no code change. Retracted 2026-09-09.
- **Battle royale** was the claim of this kind that held up. A lobby of squads
  with no home and no away is not reachable from `{ home, away }` however the
  score fields are named, and it took the change this row predicted:
  `fixtureShape: "lobby"`, `fixture_participants`, a fold over placements and a
  fixtures UI (0058–0059, `PHASE-5_NOTES.md`).

**Phase 0 is unconditional.** It has no migrations, no behaviour change, and it
pays for itself by deleting a duplication defect that already shipped (§ the
Phase 0 report).

> **PHASE 1 WAS BUILT AHEAD OF THE GATE, on an explicit instruction (2026-09-05),
> after the gate rationale below was put twice and overruled. Recording it so
> nobody later reads the code as evidence the gate was met: it was not. No demand
> data existed when `competitions.sport` shipped, and none informs it — Phase 1
> is sport-agnostic scaffolding that costs nothing if the answer is "cricket
> only". What the gate still decides is **which pack is written second**, which
> is Phase 2's question and the expensive one. See `PHASE-1_REPORT.md` §6.

> **PHASE 2 SHIPPED FOOTBALL on a founder decision (2026-09-05), not on demand
> data** — the gate's instrument had been live for hours, not weeks. The sport
> was named by the founder rather than read from `demo_requests.sport`. What the
> phase bought regardless: the pack contract is now proven against two sports
> instead of one, so a third is a file rather than a discovery. See
> `PHASE-2_REPORT.md` §1 for what the second implementation actually forced.

**Phase 4 — the long tail — remains GATED on demand, not scheduled.** Seven weeks aimed at demand
nobody has observed is the wrong bet on a product whose own audits say the
remaining gaps are commercial, not engineering.

**The gate is BUILT** (migration 0045, 2026-09-05). `/schedule-demo` now asks
which sport, as a required question with **no preselected answer** — every other
select on that form opens on a sensible default because a half-filled form gets
finished, and this one must not, because a preselected "Cricket" would be
indistinguishable from thousands of people choosing it.

Do not write a second pack before a named organizer has asked for one — *a pack
written without a user is a guess with a type signature*, and the second
implementation is the only thing that proves whether the abstraction is right.

### 5.1 · Reading the instrument

`demo_requests.sport` is nullable and rows predating 0045 are NULL — they were
never asked, and counting them as cricket would answer on their behalf in the
one column that exists to be counted. The operator queue at `/admin/demos`
badges every request with its sport, and says "sport not asked" rather than
guessing.

```sql
-- What has been asked for, most-wanted first.
SELECT sport, count(*) AS asks, max(created_at) AS latest
FROM demo_requests
WHERE sport IS NOT NULL
GROUP BY sport
ORDER BY asks DESC;

-- The tail: 'other' is a count with the answer in the note beside it.
SELECT created_at::date, org_name, note
FROM demo_requests
WHERE sport = 'other'
ORDER BY created_at DESC;
```

**Read it at four weeks.** A sport clearly leading is the trigger for Phases 1
and 2, run against that named organizer. Nothing leading is also an answer, and
Phase 0 will have cost nothing either way.

**The list is not the registry.** `DEMO_SPORTS` offers eleven sports; the
registry can run one. Wiring the form to `SPORTS` would show a single option and
measure nothing, so a unit test holds the two apart deliberately.

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
