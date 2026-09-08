# SP-1 PHASE 4 — WHAT ADDING A SPORT COSTS · NOTES

## DesiAuction NEXT · 2026-09-07 · Engineering

Measured against the code, not estimated.

---

## 1 · Per sport

| Step | Size |
|---|---|
| One pack file in `packages/core/src/sports/` | ~230 lines — `football.ts` is the template |
| Two lines in `sports/index.ts` | the import, and the `SPORTS` array |
| One `INSERT INTO sports` migration | one line, to make it selectable |

The pack supplies `key`, `label`, `roles` (values, labels, form-spelling
aliases, `required`), `attributes`, `result.scoreFields` with bounds,
`standings` (points, tiebreakers, `summariseSide`), and `terms`.

**Nothing else changes.** No schema — attributes are `jsonb` since 0047. No UI —
the sport picker, registration form, results form, standings columns and admin
catalogue are all pack-driven. No engine. The guardrails cover a new pack the
moment it is registered: `registry.test.ts` iterates `SPORTS`, so alias
ambiguity and label uniqueness are checked automatically.

## 2 · Terminology — wired, and smaller than it looked

`components/sport-terms.tsx` provides the season's words by context; the page
mounts it from the competition it has already resolved, and panels four levels
down ask for it. Plain data only, because the pack carries functions and cannot
cross into a client component.

**The measurement that shaped the work.** 46 user-visible sport nouns live in
season-scoped surfaces. Of those, **6 are `Ground`** — and `ground` is the only
term that differs between the two packs that exist (cricket "Ground", football
"Pitch"). The other 40 are `Player`, `Players`, `Squad` and `Match`, which both
packs spell identically, and which kabaddi, volleyball, hockey and basketball
would also spell identically.

So the six that vary are wired and proven; the forty that do not are left as
literals rather than churned through a dictionary that would return the same
string. When a pack finally disagrees — esports wanting "Roster", tennis wanting
"Tie" — the mechanism is already there and the change is small.

**Platform surfaces stay neutral on purpose.** `/home`, `/admin` and `/account`
list seasons of every sport at once. They have no one sport to speak for, so
they keep the neutral words by design — `useSportTerms()` returns those outside
a provider rather than throwing, because "no single sport here" is a real state.

## 3 · Kabaddi shipped — the estimate, tested

Third pack, 2026-09-08. What it actually cost, against the §1 estimate:

| Predicted | Actual |
|---|---|
| One pack file, ~230 lines | `kabaddi.ts`, **164 lines** |
| Two lines in `sports/index.ts` | two lines |
| One-line `INSERT` migration | `0049_kabaddi.sql`, one statement |
| No schema / UI / engine change | **none** |

**It added nothing to the contract.** Cricket built it; football forced three
additions (terminology, tiebreaker chain, per-field entry/parse); kabaddi needed
no new field at all. That is the claim SP-1 was making, and this is where it
either held or did not.

Three roles — raider, defender, all-rounder — with the defensive positions
(corner, cover, left in, right in) folded in as ALIASES, the same way football
folds CB/LB/RWB into defender. An auction is short of a raider or a defender;
which corner they stand in is the coach's problem on the night.

**No attributes, and that is a finding.** Club kabaddi records no per-player
fact comparable to a batting style or a preferred foot, so inventing one would
put a field on the registration form nobody can fill. It also exercises the
contract's empty case, which neither previous pack did.

**Points are 2/1/0, deliberately not the Pro Kabaddi League's 5/3/1-with-bonus.**
PKL's scheme is real, but it is a professional competition's rule and making it
the default would impose it on every club league that is not PKL. `PointsPolicy`
is an injected value, so a PKL-shaped league is a value on the competition
rather than a fork of the pack.

### Two frictions the third pack exposed, both now fixed

- **The vocabulary guardrail's allowlist named packs one at a time**, so
  `kabaddi.ts` failed the build purely for existing. Naming them individually
  was an artifact of there being one; the allowlist now covers the `sports/`
  DIRECTORY, because that is the actual rule.
- **Three registry tests used `"kabaddi"` as their example of an UNKNOWN sport.**
  They failed for being right. The fixture now uses a placeholder that will
  never be a pack — a test that assumes the roster never grows is a test with a
  shelf life.

Neither would have surfaced without a third pack, which is the argument for
adding one before the estimate is quoted to anybody.

## 4 · Volleyball shipped — the first pack with a different SHAPE

Fourth pack, 2026-09-08. Cricket, football and kabaddi all reduce a match to one
running total per side. Volleyball does not: a match is a best-of-five of SETS,
and the table ranks on set RATIO before it looks at points. So this pack carries
**two** score components and its tiebreaks are ratios rather than differences.

**The contract took it unchanged** — `scoreFields` was already a list and
`tiebreakers` already accepted any function of the totals. Cost was the same as
kabaddi's: a pack file, two registry lines, one `INSERT` (0050).

### The bug this pack could easily have shipped

Volleyball ranks on sets won ÷ sets lost, so **a team that has not lost a set
divides by zero** — and every obvious handling is wrong in a way nobody notices
until the table is:

- returning `null` sorts them **below everyone**, because a null tiebreak sorts
  last by design — the only unbeaten team in the league finishes bottom;
- returning `0` does the same thing more quietly;
- a large sentinel works until two teams are unbeaten and it makes them look
  exactly equal, which they may not be.

`Infinity` is the honest answer and it sorts correctly through the existing
`compareStandings` with no special case: `Infinity - 5` is positive, and two
unbeaten teams are caught by that function's `av === bv` check
(`Infinity === Infinity`) and fall through to point ratio. The one arrangement
that would break it — `Infinity - Infinity`, which is `NaN` and makes a sort
incoherent — is exactly the one that equality check prevents.

Four tests assert this rather than trusting the reasoning: the unbeaten team
sorts top, two unbeaten teams separate on point ratio deterministically, a team
yet to play gets `null` and sorts last, and sets rank before points.

### The first place the contract does NOT stretch

Competitive volleyball awards **3 points for a 3-0 or 3-1 win, 2 for a 3-2 win,
and 1 for LOSING 2-3**. Those depend on the SET SCORE, and `PointsPolicy` is
four flat numbers keyed on the outcome — it cannot express "a win, but only
just". The pack ships the ordinary club scheme (3 / 0, with `tie` unreachable
because volleyball plays until somebody wins) and the limitation is named in
the file.

Making the real scheme expressible means letting a policy read the score as well
as the outcome. That is a contract change, and it waits until a league asks —
the same rule every other deferral here followed.

## 5 · What still blocks specific sports

**Racquet sports** — badminton, table tennis, tennis, pickleball. A team tie is
several **rubbers** (singles, doubles), not one scoreline, and
`fixture_results.score` is `{ home, away }`. Needs `fixtureShape: "single" |
"rubbers"` plus a score shape to match: a Phase-2-sized change, not a pack file.
Everything else about them fits — they run as auction team leagues here.

**Shipped:** cricket, football, kabaddi, volleyball.

**Ready with no blockers:** hockey, basketball, box cricket, esports.

## 6 · Verification of the terminology work

| Gate | Result |
|---|---|
| `pnpm verify` | green |
| `fixture-ops.regression.test.ts` | asserts football's word reaches the surface: `Pitch`, where cricket reads `Ground` |
| Full e2e, precompiled | 100 passed, 29 skipped, 0 failed |

One e2e spec (`platform-administration` at 360px) flaked under the serial run
and passes in isolation; it is a known timing flake and touches nothing here.
