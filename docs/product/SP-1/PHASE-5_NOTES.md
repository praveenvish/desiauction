# SP-1 PHASE 5 — THE FIRST SPORT WITH NO OPPONENT · NOTES

## DesiAuction NEXT · 2026-09-10 · Engineering

Measured against the code, not estimated.

---

## 1 · What was actually blocked

Phase 4 closed with one sport named as genuinely unavailable, and the note was
right about the reason:

> **Still genuinely blocked: BATTLE ROYALE** (BGMI, Free Fire). `FixtureResultInput`
> is `homeTeamId` / `awayTeamId` — strictly two-sided — and a lobby is twenty-five
> squads scored on placement plus kills.

Unlike the racquet-sport claim beside it, this one survived being probed. Every
fixture the product had ever scheduled carried two team ids and a `NOT NULL` on
both; `fixture_results.score` is `{ home, away }`; `buildStandings` folded one
side against the other. No arrangement of `scoreFields` reaches an N-sided
match, because the shape is in the schema rather than in the data.

## 2 · The shape, not the file

`fixtureShape: "duel" | "lobby"` on `SportPack`, defaulting to `duel`. Eleven
packs inherit the default and none of them changed.

| Piece | Where |
|---|---|
| `fixture_participants` — squads, placement, per-squad score | migration 0058 |
| `fixtures.home_team_id` / `away_team_id` nullable + `fixtures_sides_check` | 0058 |
| `LobbyPlacement` / `LobbyResultInput`, `foldLobby` | `packages/core/src/standings.ts` |
| `createLobbyFixture`, `recordLobbyResult`, `lobbyParticipantsOf` | `apps/web/src/server/competition/` |
| Lobby row, squad checklist, placement form | `fixtures-panel.tsx`, `results-card.tsx` |
| `battle_royale` pack + seed | `sports/battle-royale.ts`, 0059 |

`fixtures_sides_check` — `(home_team_id IS NULL) = (away_team_id IS NULL)` — is
the piece worth naming. Dropping two `NOT NULL`s to admit lobbies would have
admitted a HALF-DUEL to every other sport as well: a fixture with a home team
and no away one, which nothing in the codebase was written to survive. The
constraint says a fixture has two sides or none, and the regression suite proves
it refuses the third case.

## 3 · Two real defects the widening exposed

Both in `fixture.ts`, both silent, both found by making the columns nullable
rather than by reading the code:

- `sharesTeam` compared `a.homeTeamId === b.homeTeamId`. With nulls in play,
  **two unrelated lobbies share a team** — `null === null` — so the conflict
  engine would have refused to schedule a second lobby anywhere, ever.
- `pairKey` sorted the two ids into a fixture's identity. Two lobbies produce
  the same key (`"~"`), so the duplicate-fixture guard would have called every
  lobby after the first a repeat of the first.

Neither is reachable from a duel sport, so neither would have appeared until a
BGMI organizer scheduled their second lobby.

## 4 · A lobby has no result row

`recordLobbyResult` writes **no** `fixture_results` row. There is nothing
truthful to put in `{ home, away }`, and a placeholder row would have been read
as a result by four different surfaces.

That decision propagates, and each place had to be told:

- **The standings fold** reads placements off the participants for played
  lobbies, skipping squads with a null placement — a scheduled-but-unscored
  lobby would otherwise award every squad the points for finishing nowhere.
- **The results worklist** cannot ask "is there a row?"; a lobby is scored when
  every squad in it is placed. Without that it would have nagged forever.
- **`won`** is placement 1 and nothing else. `lost`, `tied` and `conceded` stay
  at zero on purpose: second place was not beaten by anybody in particular, and
  a fabricated loss would make the table read like a league it is not.

## 5 · The scoring

BGMI esports points, which Free Fire and most Indian circuits copy:

```
placement: [10, 6, 5, 4, 3, 2, 1, 1, 0, 0]   perScore: { kills: 1 }
```

A squad that finishes fourth with six kills takes ten, and so does the one that
won with nothing. The two explicit zeroes are redundant to the fold — a
placement past the end of the array already scores nothing — and are kept so an
organizer checking the file against their ruleset does not have to infer an
absence.

## 6 · What Phase 5 also fixed on the way past

The demand form on `/schedule-demo` offered `table-tennis`. That key was renamed
`table_tennis` in 0057 — in `DEMO_SPORTS` and in the database CHECK, but not in
the form — and the server **refuses** an unrecognised sport rather than folding
it to "other", deliberately, because it is the one answer on the page that gets
counted. So choosing Table tennis had been failing since 0057. `box_cricket`
was a valid answer nobody could give.

The type system cannot see into JSX option values and every unit test passed a
value it made up, so nothing could see it. There is now a guardrail that reads
the form's sport select and asserts its values are exactly `DEMO_SPORTS`.

## 7 · Verification

| Gate | Result |
|---|---|
| `pnpm verify` | green |
| `packages/core` | 598 passed |
| `apps/web` integration | 899 passed |
| `fixture-ops.regression.test.ts` | 40 passed — includes the half-duel refusal, the placement CHECK, and CASCADE |
| Full e2e, precompiled | 104 passed, 29 skipped, 0 failed |
| `battle-royale.spec.ts` | one lobby, four squads, placements typed in a browser, table adds up |

Every guardrail added here was mutation-tested: the seed check fails when 0059's
INSERT is commented out, and the demand-form check fails when `table_tennis` is
reverted to `table-tennis`.

**Shipped:** cricket, football, kabaddi, volleyball, hockey, basketball, box
cricket, esports, badminton, table tennis, pickleball, battle royale — twelve.

## 8 · What is still not a pack file

Nothing that has been asked for. The two claims Phase 4 carried are both closed:
racquet sports were never blocked (retracted 2026-09-09, shipped in 0056), and
battle royale is the subject of this note.

What remains genuinely unavailable is unchanged and is not a sport problem:
recording **who** played — who batted, who took the third rubber, which four
players were in the squad that placed second. That is a scorecard with line-ups,
and no sport here has one.
