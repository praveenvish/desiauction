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

## 5 · Packs are now DATA (2026-09-08)

Four packs in, every `compute` any of them needed turned out to be one of four
shapes — a difference, a ratio, a rate per N, or a plain total — and all four
packs had independently written the same `termsOf` helper. Both are now shared
(`tiebreakers.ts`, `vocabulary.ts`), and the result is that **every pack
contains zero functions**:

| Pack | code lines | functions |
|---|---|---|
| cricket | 187 → **157** | 8 → **0** |
| football | 143 → **119** | 6 → **0** |
| kabaddi | 85 → **66** | 5 → **0** |
| volleyball | 107 → **80** | 7 → **0** |

That is what makes `ADDING_A_SPORT.md` honest: a fifth sport is a file of
values somebody can copy and edit without being a TypeScript programmer, and
`pnpm verify` will tell them if they got it wrong.

**The point is not the line count.** It is that the divide-by-zero volleyball
exposed — the one that sorts an unbeaten team to the bottom of the table — now
lives in `ratio()` and is inherited. No fifth pack can re-derive it wrongly,
because no fifth pack derives it at all.

The escape hatch stays: `TiebreakerSpec` is still an interface, so a sport whose
ranking is genuinely none of the four writes its own. Needing one is a fact
about that sport rather than a failure of the library.

## 6 · What still blocks specific sports

**Racquet sports — RETRACTED. They were never blocked.**

This section said badminton, table tennis, tennis and pickleball needed
`fixtureShape: "single" | "rubbers"` because "a team tie is several rubbers, not
one scoreline". The premise is true and the conclusion did not follow, and it
went unchecked for a fortnight while three of those sports sat on the demand
form marked unbuildable.

A tie's RESULT is one scoreline per side — rubbers won, and games won inside
them — which is the arrangement volleyball has had since Phase 4 with sets and
points. `ScoreRecord` is `Record<string, number>`, the result form is generated
from `scoreFields`, and `buildStandings` folds whatever the pack names. Badminton,
table tennis and pickleball shipped in 0056 as ordinary pack files with **no code
change at all**.

What is genuinely unavailable is recording WHO played the third rubber and how
it finished. That is a scorecard with line-ups, and no sport here has one —
cricket cannot say who batted either. Racquet sports are no more limited than
the six that shipped before them, which is what this note should have said.

**Still genuinely blocked: BATTLE ROYALE** (BGMI, Free Fire). `FixtureResultInput`
is `homeTeamId` / `awayTeamId` — strictly two-sided — and a lobby is twenty-five
squads scored on placement plus kills. No arrangement of score fields fixes
that; it needs an N-sided fixture, which is a real change to the fixtures table,
the result writer, the standings fold and the fixtures UI.

**Shipped:** cricket, football, kabaddi, volleyball, hockey, basketball, box
cricket, esports, badminton, table tennis, pickleball — eleven.

## 7 · Verification of the terminology work

| Gate | Result |
|---|---|
| `pnpm verify` | green |
| `fixture-ops.regression.test.ts` | asserts football's word reaches the surface: `Pitch`, where cricket reads `Ground` |
| Full e2e, precompiled | 101 passed, 29 skipped, 0 failed |

**Retraction.** This section said one spec (`platform-administration` at 360px)
was "a known timing flake" that "touches nothing here". Both halves were wrong,
and calling it timing is what stopped it being looked at.

It was DATA-DEPENDENT. Measured with a probe rather than guessed at, the
overflowing element was a single `SPAN.badge`, 355px wide inside a 360px
viewport, reading *"oldest queued job has waited under a minute"* — a chip
holding a SENTENCE, kept on one line by `white-space: nowrap`, which only
appears once the health console has a queued job to describe. An empty queue
renders a short chip and the page fits; a seeded one overflows by 56px. That is
why it passed alone and failed in the suite, and "flake" is the word that
explains the symptom while hiding the cause.

Fixed in `817dc58` by letting an admin chip wrap (`.admin-chips > * {
white-space: normal }`, scoped to the admin surface rather than changing the
`Badge` primitive for every caller). The chip still renders, now on two lines at
238px, and the page's scrollWidth is back to 360.

## 8 · The last hardcoded cricket, and the promises now held to

### The career door named the wrong sport

Fixed in `704f464`. Two surfaces still said cricket regardless of what somebody
had registered for, and this is the one a PLAYER would have hit first:

- `/home`'s registrations rail offered "My cricket →" pointing at `/me/cricket`
  for everyone. A football player's career door led to an empty cricket page
  presented, with a straight face, as their record.
- `nav.ts` carried `/me/cricket` as a STATIC entry in `OUTSIDE_RAIL` — correct
  while the platform ran one sport. Phase 3 made the route `/me/[sport]`, and
  every other sport then fell past that lookup to the generic fallback and lost
  its identity-bar title entirely.

`careerTitle()` now derives the heading from the PATH, which is why it can stay
in a pure module: the sport is already in the URL, so the shell needs no query
to know which page it is framing. An unknown segment returns null rather than
handing a confident title to a sport we have no pack for. `/home` takes it from
the most recent registration — which meant `myRegistrations` had to start
selecting `competitions.sport`, having carried the season's name and slug while
dropping the column that says what the season IS.

**The test was the reason this survived four phases.** The e2e assertion was
`toBeVisible()`, which the broken link passed exactly as happily as the fixed
one. It now asserts text and href, so the cricket fixture proves cricket
*because of* its registration rather than by default.

### `ADDING_A_SPORT.md` is now enforced, not just asserted

That document tells the next person a sport costs one file of values plus one
line of SQL. Both halves were true and neither was checked by anything, which is
the state a claim is in just before it stops being true.
`sports/pack-contract.test.ts` holds them:

| Promise | What now fails the build |
|---|---|
| A pack is DATA | any pack file declaring an arrow function or a `function` |
| Every registered pack is pickable | a pack in `SPORTS` with no `INSERT INTO "sports"`, or seeded `enabled = false` |
| No sport without a pack | a seeded row whose key no pack claims |
| One name per sport | a migration label that differs from the pack's |
| A stable picker order | two sports sharing a `sort_order` |

The second row is the one worth having. Adding a pack is three steps and the
type system covers only the first two: **miss the migration and `pnpm verify`
still says green while the sport does not exist in the product**, because the
picker reads the `sports` TABLE. Silent, green, and discovered only by the
person it was built for.

**The guardrail was mutation-tested rather than trusted**, and the first version
failed that. Commenting a seed out left it still counted — the scan read raw SQL,
so the exact mutation it exists to catch was the one it could not see. Migrations
here are heavily commented by design, so that was not a hypothetical. Four
mutations now bite: an inline `compute:` in a pack, a commented-out seed, a
deleted migration, and a drifted label.

Two definitional choices worth keeping:

- **A pack is identified by `: SportPack = {`, not by a filename allowlist.**
  An allowlist is what `sport-vocabulary.test.ts` used to carry, and it failed
  the build the day kabaddi arrived purely for existing. The `{` is
  load-bearing: without it the matcher also caught `index.ts`, whose
  `DEFAULT_SPORT: SportPack = CRICKET` names a pack rather than declaring one.
- **Comments are stripped before scanning, on both sides.** `volleyball.ts`
  explains that "`tiebreakers` already takes any function of the totals" — a
  sentence about the contract, in a file containing no function. A scan reading
  raw text would fail that pack for describing itself accurately, and the fix
  somebody would reach for is deleting the explanation.
