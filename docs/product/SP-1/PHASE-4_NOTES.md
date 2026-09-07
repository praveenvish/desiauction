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

## 3 · What still blocks specific sports

**Racquet sports** — badminton, table tennis, tennis, pickleball. A team tie is
several **rubbers** (singles, doubles), not one scoreline, and
`fixture_results.score` is `{ home, away }`. Needs `fixtureShape: "single" |
"rubbers"` plus a score shape to match: a Phase-2-sized change, not a pack file.
Everything else about them fits — they run as auction team leagues here.

**Ready with no blockers:** kabaddi, volleyball, hockey, basketball, box
cricket, esports.

## 4 · Verification of the terminology work

| Gate | Result |
|---|---|
| `pnpm verify` | green |
| `fixture-ops.regression.test.ts` | asserts football's word reaches the surface: `Pitch`, where cricket reads `Ground` |
| Full e2e, precompiled | 100 passed, 29 skipped, 0 failed |

One e2e spec (`platform-administration` at 360px) flaked under the serial run
and passes in isolation; it is a known timing flake and touches nothing here.
