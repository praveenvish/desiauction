# SP-1 PHASE 2 — THE SECOND SPORT · IMPLEMENTATION REPORT

## DesiAuction NEXT · 2026-09-05 · Engineering · **Status:** COMPLETE

Migration **0047**. Football is live. The platform runs two sports through one
engine, one writer and one league table, with no branch on sport anywhere in
the machine.

---

## 1 · The verdict on the Phase 0 abstraction

Phase 0 designed the `SportPack` contract against cricket alone — the cheapest
way to design something that fits exactly one thing. Phase 2 is the test, and
the honest result is **three additions, no rewrites**:

| The contract had to grow | Why football forced it |
|---|---|
| `terms` — a terminology dictionary | Cricket plays on a **Ground**, football on a **Pitch**. Phase 0 refused to declare this because nothing consumed one; a second sport is what made "ground" a *wrong* word rather than a neutral one. |
| `standings.tiebreakers` — an ordered chain | Net run rate was hard-wired into `compareStandings`. Football breaks ties on **goal difference** then **goals for**, and neither is a rate. The league table stopped knowing what a sport is. |
| `standings.summariseSide` + `ScoreFieldSpec.entry` / `.parse` | Cricket reads "180/20.0" and is *typed* as overs while *stored* as balls; football reads "12" and is typed as it is stored. Presentation and entry are per-sport in a way Phase 0 could not have guessed correctly. |

**What did not have to change is the more useful finding.** Roles, aliases,
attributes, score fields, bounds, the auction, the purse, paddles, settlement,
finops and every lifecycle took football unmodified. `PointsPolicy` needed
nothing at all — it was already an injected value, the one piece of foresight
this programme inherited rather than built.

## 2 · What was built

| Piece | Where |
|---|---|
| `football.ts` — 4 positions, ~50 aliases, preferred foot, goals, 3/1/0, GD → GF | `packages/core/src/sports/football.ts` |
| Sport-agnostic league table — accumulates the pack's components, applies its tiebreak chain | `packages/core/src/standings.ts` |
| `registrations.role` opened — no enum, nullable | migration 0047 |
| `registrations.attributes jsonb` — where every future sport's detail lives | migration 0047 |
| `fixture_results.score jsonb` — replacing six cricket integers | migration 0047 |
| Pack-driven results form, standings table, record action | `results-card.tsx`, `standings/page.tsx`, `fixture-actions.ts` |

## 3 · The engine was not as clean as Phase 0 claimed

Phase 0's report said the auction engine contained "zero cricket concepts."
That was true of *vocabulary* and false of *structure*: `placeBid` enforces
**per-role squad quotas**, so while it never knew what the roles were, it did
assume every registration **has** one. Opening the column broke it, and the
compiler caught it.

Fixed honestly: no role means no role quota — the count is zero and the ceiling
absent, so that one rule stands down and every other rule in the gauntlet is
untouched. It does **not** mean "unlimited of an unknown role"; there is no role
to be unlimited about.

## 4 · Decisions worth recording

**A shootout is not a goal.** Penalties decide who progresses; folding them into
`goals` would put them into goal difference and quietly corrupt the table. The
existing `method` column carries "penalties", exactly as it carries "DLS".

**Four positions, not eleven.** A team sheet distinguishes a left-back from a
right-back; an auction does not. The specific positions are *aliases* that
collapse to four groups, so an organizer importing "CB", "LB", "RWB" gets
defenders and retypes nothing — the same way cricket folds "leg spinner" into
bowler.

**The pack cannot cross into a client component.** It carries functions. So the
results form receives plain `{ key, label, help }` specs and the **server**
parses what the scorer typed — which is also where cricket's "18.3 → 111 balls"
belongs.

**`player_profiles.default_role` stays cricket-only.** Not an oversight: a
person-level default role assumes a person plays one sport, which is precisely
the assumption **Phase 3** removes. `database-vocabulary.test.ts` now asserts
that boundary rather than leaving it to be discovered.

## 5 · Migration 0047 · rollback

Expand-and-contract in one step, because a column nothing writes disagrees with
the truth beside it the first time somebody amends a scorecard. The scores are
preserved in `score`; to reverse:

```sql
ALTER TABLE "fixture_results"
  ADD COLUMN "home_runs" integer, ADD COLUMN "home_wickets" integer,
  ADD COLUMN "home_balls" integer, ADD COLUMN "away_runs" integer,
  ADD COLUMN "away_wickets" integer, ADD COLUMN "away_balls" integer;
UPDATE "fixture_results" SET
  "home_runs"    = ("score"->'home'->>'runs')::int,
  "home_wickets" = ("score"->'home'->>'wickets')::int,
  "home_balls"   = ("score"->'home'->>'balls')::int,
  "away_runs"    = ("score"->'away'->>'runs')::int,
  "away_wickets" = ("score"->'away'->>'wickets')::int,
  "away_balls"   = ("score"->'away'->>'balls')::int;
ALTER TABLE "fixture_results" DROP COLUMN "score";
DELETE FROM "sports" WHERE "key" = 'football';   -- fails if a season uses it, correctly
ALTER TABLE "competitions" ALTER COLUMN "sport" SET DEFAULT 'cricket';
ALTER TABLE "tournaments"  ALTER COLUMN "sport" SET DEFAULT 'cricket';
ALTER TABLE "registrations" ALTER COLUMN "role" SET NOT NULL;  -- only if none are null
```

Revert **code first, then schema**. Deleting the football row fails while any
season references it, which is the foreign key doing its job.

## 6 · Verification

| Gate | Result |
|---|---|
| `pnpm verify` | **green** (lint, typecheck ×11, unit, format, depcruise, motion) |
| `packages/core` unit | **478 passed** |
| `pnpm test:integration` | **929 passed** (72 engine + 857 web) |
| Full e2e, precompiled | **100 passed, 29 skipped, 0 failed** |

**Football proven, not assumed.** `fixture-ops.regression.test.ts` runs a real
football season end to end: a 300-goal score is **rejected** by football's
bounds (300 runs would be fine in cricket), a 3–1 win is recorded through the
same writer, and the table returns **3 points, goal difference 2, and no net run
rate at all**.

The cricket standings suite was migrated rather than rewritten — all ten of its
assertions still pass against the generalised engine, which is the evidence the
refactor preserved behaviour.

One e2e spec (`conduct-ceremony`) flaked under the serial run and passes in
isolation; it is a gavel-timer journey and touches no part of this phase.

## 7 · Still cricket-shaped, deliberately

- **`player_profiles.default_role`** — Phase 3 (§4).
- **Terminology is declared but barely consumed.** `terms` exists and both packs
  fill it in; the ~95 components that say "player" still say it literally.
  Wiring them is mechanical, large, and worth doing when a football organizer is
  actually reading those screens.
- **No third pack.** The interface is now proven against two sports, which is
  the point at which adding a third is a file rather than a discovery.
