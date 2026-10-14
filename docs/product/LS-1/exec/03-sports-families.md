# LS-1 · 03 · Other sports (Milestones 11-12, commits C47 → C56)

Start only after C46 is green. The same branch, gates and rules apply (`00-README.md`).

The order is fixed:
1. **rally** (badminton, table tennis, pickleball, volleyball);
2. **raid** (kabaddi);
3. **timed** (football, hockey, futsal, basketball);
4. **placement** (battle royale per-player kills).

Everything outside the fold is **reused** from cricket:
- the event log, append API, claim, offline queue;
- the live API and page shell, finalize, trust, awards plumbing.

A sport is added by:
- a pack `scoring` block (values only);
- a family engine in `core/scoring/<family>/`;
- a pad component and live-page panels registered by family key.

---

## Milestone 11: one engine shape for every sport ★

### C47
**Subject:** `feat(core): family engine registry`

**Files:**
- `core/scoring/family.ts` defines the interface every family engine implements:
  ```ts
  export interface FamilyEngine<S, P = unknown> {
    family: 'delivery'|'rally'|'raid'|'timed'|'placement';
    initialState(): S;
    apply(state: S, event: MatchEvent): ApplyResult<S>;
    nextActions(state: S): FamilyAction[];
    deriveResult(state: S): DerivedResult | null;
    scoreForResult(state: S, rules: SeasonScoringRules): { home: Record<string, number>; away: Record<string, number> };  // keys = pack scoreFields
    playerLines(state: S): Map<string, PlayerLine>;
    publicLiveState(state: S, names: NameBook): PublicLiveState;   // shared outer shape; family panel data in `panel`
  }
  ```
- `core/scoring/registry.ts`: `engineFor(family)`.
- Refactor `replayMatch` so it takes the engine: `replayMatch(engine, events)`, with `replayDelivery = (e) => replayMatch(deliveryEngine, e)` kept for existing call sites.
- `PublicLiveState` gains `family` and `panel: unknown` (family-specific, typed per family).

**Web:**
- API-1/2/3, FIN-1 and the live read model resolve the engine from `sportPackFor(competition.sport).scoring.family`.
- A sport without `scoring` refuses API-2 with "Live scoring for {sport} is coming soon. Enter the result after the match." This is the existing hand-typed path.

**Tests:**
- every cricket test passes unchanged;
- a registry test asserts that every pack with `scoring` resolves an engine.

**Gate:** G-core, G-static, G-int.

**Acceptance:** A-C47-01..03.

### C48
**Subject:** `feat(core): rally family for badminton, table tennis, pickleball and volleyball`

**Files:**
- `core/scoring/rally/{state.ts, apply.ts, next-actions.ts, result.ts, lines.ts, public-state.ts, formats.ts}` plus `rules.test.ts`.
- Pack `scoring` blocks in `badminton.ts`, `table-tennis.ts`, `pickleball.ts` and `volleyball.ts`.

**Format knobs (`RallyFormat`):**
```ts
{ key; label; rubbers: 1|3|5; gamesToWin: number /* best of = 2n-1 */; pointsToWin: number; winBy: number; cap: number|null;
  decidingPointsToWin?: number; serve: 'winner_serves'|'two_each'|'side_out'; changeServeAtDeuce: 1|2 }
```

**Presets:**

| Key | Values |
|---|---|
| `badminton_bo3` | 1 rubber, gamesToWin 2, 21, winBy 2, cap 30, winner_serves |
| `badminton_tie_5` | 5 rubbers, else as `badminton_bo3` |
| `tt_bo5` | 1 rubber, gamesToWin 3, 11, winBy 2, cap null, two_each, changeServeAtDeuce 1 |
| `tt_tie_5` | 5 rubbers |
| `pickleball_bo3` | gamesToWin 2, 11, winBy 2, side_out (point only to the serving side) |
| `pickleball_rally_bo3` | as `pickleball_bo3`, serve `winner_serves` |
| `volleyball_bo5` | 1 rubber, gamesToWin 3, 25, winBy 2, decidingPointsToWin 15, winner_serves |

**Events:**

| `type` | Payload |
|---|---|
| `rubber_started` | `{ rubberNo; homePlayers: string[]; awayPlayers: string[]; firstServer: 'home'\|'away' }` |
| `rally` | `{ winner: 'home'\|'away'; endedBy?: 'ace'\|'winner'\|'error'\|'kill'\|'block'\|'fault'; playerId?: string }` |
| `game_conceded` | `{ side }` |
| `rubber_conceded` | `{ side }` |
| `timeout` | `{ side }` |
| `substitute` | `{ side; inId; outId }` (volleyball only) |

The shared events still apply: `match_started`, `void`, `amend`, `restart`, `abandon`, `walkover`, `finish`, `interrupt`/`resume`.

**Rules (tests named `RR-xx`):**
- RR-01: Rally scoring adds a point to the winner. With `side_out`, a point is added only when the server's side wins; otherwise serve passes.
- RR-02: A game ends at `pointsToWin` with a lead ≥ `winBy`, or at `cap`. The deciding game uses `decidingPointsToWin` when set.
- RR-03: A rubber ends at `gamesToWin`. The fixture ends when one side has won ⌈rubbers/2⌉ rubbers.
- RR-04: Server rules:
  - `winner_serves`: the rally winner serves next;
  - `two_each`: the server changes every 2 points, and every point once both sides reach `pointsToWin − 1`;
  - `side_out`: serve passes on a lost rally.
- RR-05: A rally after a game or rubber ends is rejected until the next `rubber_started` (`innings_over` reason reused, message "This game is complete.").
- RR-06: `scoreForResult` writes the pack fields:
  - badminton, TT and pickleball: `rubbers` and `games` (games won across all rubbers);
  - volleyball: `sets` (= games won) and `points` (total).

**Tests:**
- deuce to cap 30;
- TT serve changes at 10-10;
- pickleball side-out;
- volleyball fifth set to 15;
- a 5-rubber tie decided 3-1 stops early (remaining rubbers not required).

**Gate:** G-core.

**Acceptance:** A-C48-01..05.

### C49
**Subject:** `feat(web): rally scoring pad and live page`

**Files:**
- `web/app/score/[fixtureId]/families/rally-pad.tsx`;
- `web/components/scoring/rally-panel.tsx`;
- setup: `setup-flow.tsx` branches by family. The rally setup is: format → rubbers (players per side per rubber from the XI, which is the squad here) → first server.

**Pad:**
- two giant buttons labelled with the side names and current points;
- the server indicator;
- the game/rubber strip;
- Undo;
- an optional "how it ended" chip row (`endedBy`, hidden behind a menu toggle "Track how points end");
- **volume keys:** a keydown `AudioVolumeUp`/`AudioVolumeDown` maps to home/away when the toggle "Use volume buttons" is on (Android Chrome only; show the toggle only when supported).

**Live panel:** game scores per rubber, current server, point streak, and the match result in place.

**Gate:** G-static, G-int, G-e2e (`e2e/scoring-rally.spec.ts`: a badminton best-of-3 to completion, plus a TT tie of 5 stopped at 3-0).

**Acceptance:** A-C49-01..04.

### C50
**Subject:** `feat(core): raid family for kabaddi`

**Files:** `core/scoring/raid/**` plus `rules.test.ts`; the `kabaddi.ts` pack `scoring` block.

**`RaidFormat`:**
```ts
{ key; label; halves: 2; halfMinutes: number; playersOnMat: 7; superTackleAtOrBelow: 3; bonusLineMinDefenders: 6; allOutPoints: 2; doOrDieAfterEmpty: 2; raidSeconds: 30 }
```

Presets: `pkl_40` (2 × 20 min), `kabaddi_30` (2 × 15).

**Events:**

| `type` | Payload |
|---|---|
| `half_started` | `{ half: 1\|2 }` |
| `half_ended` | `{}` |
| `clock` | `{ running: boolean }` |
| `raid` | `{ raiderId; touchedIds: string[]; bonus: boolean; tackled: boolean; tacklerIds: string[]; lineOut?: string[] }` |
| `technical_point` | `{ teamId; reason }` |
| `green_card`, `yellow_card`, `red_card` | `{ playerId }` (suspensions remove from the mat for 2 min, 0 min or for the match) |

**Rules (tests `KR-xx`):**
- KR-01: A successful raid scores touch points = `touchedIds.length` + 1 if `bonus`. Bonus is valid only when the defenders on the mat are ≥ `bonusLineMinDefenders`.
- KR-02: A tackled raid scores 1 point for the defence, or 2 when the defenders on the mat ≤ `superTackleAtOrBelow` (a super tackle). The raider is out.
- KR-03: Outs leave the mat. Each point scored by a team revives its own outs FIFO, one per point.
- KR-04: All-out happens when a team's mat count reaches 0. The opponent gets +2, and the all-out team fully revives.
- KR-05: Do-or-die: after `doOrDieAfterEmpty` consecutive empty raids by a team, the next raid by that team must score, or the raider is out (1 point to the defence).
- KR-06: Raids alternate teams. The first raid of each half goes to the team that did not raid first in the previous half.
- KR-07: Player lines: raid points, tackle points, successful raids, empty raids, super raids (≥ 3 points in one raid), super tackles, Super 10 (≥ 10 raid points), High 5 (≥ 5 tackle points).
- KR-08: The result field is `points`.

**Gate:** G-core.

**Acceptance:** A-C50-01..05.

### C51
**Subject:** `feat(web): kabaddi scoring pad, live page and awards`

**Files:**
- `families/raid-pad.tsx`: the current raider picker; tap defenders touched; Bonus toggle (disabled with the reason when < 6 on the mat); "Tackled" with tackler picks; "Empty raid"; a mat view of both teams' 7 dots (out = hollow, revival animation transform-only); do-or-die badge; raid timer 30 s; half clock.
- `components/scoring/raid-panel.tsx`.
- Awards: `core/scoring/awards/kabaddi-v1.ts`, using the FINAL/PLAN kabaddi table: raid point +1, tackle point +1, super tackle +1 bonus, super raid +3, Super 10 +5, High 5 +3, do-or-die success +1, tackled −0.5. Season awards are best raider, best defender and MVP.

**Gate:** G-static, G-int, G-e2e (`e2e/scoring-kabaddi.spec.ts`: a half with an all-out and a super tackle).

**Acceptance:** A-C51-01..04.

---

## Milestone 12: timed and placement ★

### C52
**Subject:** `feat(core): timed family for football, hockey, futsal and basketball`

**Files:** `core/scoring/timed/**` plus tests; pack `scoring` blocks for football, hockey and basketball, and futsal if a pack exists (if no futsal pack exists, do not add one).

**`TimedFormat`:**
```ts
{ key; label; periods: number; periodMinutes: number; clock: 'running'|'stopped'; shootout: boolean; scoreUnits: number[] }
```
`scoreUnits` is `[1]` for goals and `[1, 2, 3]` for basketball.

**Events:**

| `type` | Payload |
|---|---|
| `period_started` / `period_ended` | `{ period }` |
| `clock` | `{ running: boolean }` |
| `score` | `{ teamId; points: number; scorerId?; assistId?; ownGoal?; penalty? }` |
| `card` | `{ playerId; colour: 'yellow'\|'red'\|'green' }` |
| `sub` | `{ teamId; inId; outId }` |
| `foul` | `{ playerId; teamId }` (basketball) |
| `shootout_attempt` | `{ teamId; playerId; scored: boolean }` |

**Rules (`TR-xx`):**
- Score only while a period is open.
- `points` must be in `scoreUnits`.
- A red card removes the player (no sub).
- The shootout runs only when the score is tied after the last period and `shootout` is true. It is best of 5, then sudden death.
- The result field is `goals` or `points` per pack.
- Game time per event is derived from clock events (`gameClockMs` on `PublicLiveState.panel`).

**Gate:** G-core.

**Acceptance:** A-C52-01..04.

### C53
**Subject:** `feat(web): timed scoring pad, live page and awards`

**Files:**
- `families/timed-pad.tsx`: big clock with start/stop; period control; "+ Goal" (scorer, assist optional); a card; a sub; basketball shows a 1/2/3 points pad per team and a foul button.
- `components/scoring/timed-panel.tsx`: timeline of goals/cards with minutes.
- Awards: `football-v1` (goal 10 / GK·DEF 12, assist 6, clean sheet GK 8 / DEF 4, penalty save 8, penalty miss −4, own goal −4, yellow −1, red −5) and `basketball-lite-v1` (points + 0 (no rebounds tracked) − fouls × 1; MVP = top, with the winning-side rule as in cricket).

**Gate:** G-static, G-int, G-e2e (`e2e/scoring-football.spec.ts`: two halves, goals, a red card, a draw → shootout).

**Acceptance:** A-C53-01..04.

### C54
**Subject:** `feat(web): lobby rounds with per-player kills`

**Files:** extend the existing lobby fixtures (`fixture_participants`, `recordLobbyResult`):
- event `lobby_round { round; rows: { teamId; placement; kills; playerKills: Record<registrationId, number> }[] }`;
- `core/scoring/placement/**` folds rounds to a live lobby table using the pack's `LobbyPoints`;
- finalize writes `fixture_participants` (placement and score) exactly as `recordLobbyResult` does today, with source scored;
- live page panel shows the lobby table;
- award `top_fragger` = most kills, tiebreak by better team placement.

**Gate:** G-core, G-static, G-int, G-e2e (`e2e/battle-royale.spec.ts` regression plus a new scored-lobby test).

**Acceptance:** A-C54-01..03.

### C55
**Subject:** `test(e2e): every sport family end to end`

`e2e/scoring-families.spec.ts`: one compact journey per family in both themes, axe on each pad.

**Gate:** G-e2e.

**Acceptance:** A-C55-01.

### C56
**Subject:** `chore(ls1): verification sweep for all sports`

G-full, plus the EXEC-LOG summary, plus the FINAL.md "As built: sports".

**Gate:** G-full.

**Acceptance:** A-C56-01.
