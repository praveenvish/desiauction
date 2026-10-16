# LS-1: Live scoring, player stats and awards (all sports, cricket first)

Status: **PLAN, nothing built yet.** Written 2026-10-08 from four research passes: a CricHeroes teardown, a multi-sport competitor survey, award and MVP methodology, and a map of our own codebase. Source URLs live in the research notes summarised in §13.

---

## 0. The one-paragraph answer

CricHeroes won on one thing: **the scorer is free, and every ball they tap goes into a player's lifetime profile.** That network is their moat. Their weak points are now public:

- **Fake and duplicate stats.** Players keep several IDs, organisers create duplicates, and merging goes through a helpline.
- **Paywall creep.** Since mid-2025 the points table and career stats sit behind Pro, and reviews are angry about it.
- **Heavy ads.**
- **Cricket only.**

We beat them by doing four things they cannot easily copy:

1. **The match already knows its players.** Our squads come from the auction, our lineups exist, our people are verified. Starting a match takes two taps, not five minutes of typing names and phone numbers.
2. **Trusted stats.** One verified person, one profile, and an audited correction trail. Awards go only to verified players, and the formula is shown on every award.
3. **A better experience, not a paywall surprise.** Pricing is a founder decision: no "free forever" commitment (see BRAINSTORM-2 §7). Whatever we charge, we never take away something a user already had for free.
4. **One engine, every sport.** Cricket goes deep first. The same event log, scorer app, live page, stats and awards then extend to kabaddi, football, badminton and the rest by adding a sport *family*, not a new product.

---

## 1. What we already have (and what we don't)

| Area | Today | Gap |
|---|---|---|
| Sports | 12 sport packs as typed value files (`packages/core/src/sports/`) | No match format (overs, halves, sets), no event vocabulary, no stat schema |
| Fixtures | Lifecycle, round robin, conflict detection, Matches screen + match panel | No knockouts or brackets; no "Playing" season phase |
| Results | One final scoreline per match (`fixture_results.score` jsonb), typed in after the match | No ball-by-ball, no live state |
| Standings | Derived from results; NRR from stored balls | NRR all-out rule needs a check (§5.6) |
| Lineups | `fixture_lineups`: a plain set of who played | No batting order, keeper, captain-of-the-day or substitutes |
| People | Verified people, player profiles, career (appearances, W/L, price) | **No individual numbers at all**: no runs, wickets or goals |
| Real-time | Auction engine: single writer, seq-ordered event log, pure fold, WS snapshot hub, OBS overlay | Auction-specific; no match rooms |
| Grounds | Venues + grounds, org-scoped | Booking deferred to phase 2 (founder, 2026-09-24) |
| Officials | Nothing. A "Scorekeeper" preset is planned in doc 37 | No scorer, umpire or referee |
| Awards | Champion announcement only | No player of the match, MVP or leaderboards |
| Sharing | Auction posters (stadium theme) + OG cards | No match-result card; a scorecard concept image exists (`docs/poster-concepts/C-scorecard.png`) |
| Messaging | Outbox (email/SMS/WhatsApp), web push, in-app inbox, match-day mail | No result or live-score alerts |
| Offline | PWA shell; the SW deliberately caches no data | No offline entry, which a scorer at a ground needs |

The big gap, already written in SP-1: **"no sport here can say who played or how"**. LS-1 closes it.

---

## 2. What we learned

### 2.1 CricHeroes, in short

- **Identity:** keyed on mobile number. A player is "verified" by OTP, and unverified players can't win Player of the Match or score. Duplicates are fixed by phoning support.
- **Scoring:** free, ball by ball. Flow: teams → overs/ball type → Playing XI → toss → openers + bowler → run pad. Undo. Overs can change mid-innings. Settings change bowler or batter. Handover means logging in on another phone and choosing "Resume Scoreboard". Offline was claimed in 2021. After the match, edit → publish.
- **Viewers:** commentary, scorecard, wagon wheel, Manhattan, worm, MVP. Phone streaming is ₹199/match, plus an OBS score ticker (19 themes) and its own streaming box with AI highlights.
- **Awards:**
  - **Automatic and published.** Player of the Match is the top MVP on the winning side if they are in the top 3, otherwise the overall top. A "Fighter of the Match" goes to the best player on the losing side.
  - Organisers can change awards on tournament matches only.
  - The MVP formula: 10 runs = 1 point. Strike-rate bonus is relative to the team. A wicket is worth 12–27 runs depending on match length, weighted by the dismissed batter's position (100/80/60%). Maidens count as wicket-equivalents. A catcher gets +20% of the wicket's value.
- **Officials and grounds:** a directory and classifieds ("Looking for umpire…"), not a marketplace.
- **Money:** about 40% ads, 30% Pro, 20% tournament add-ons (stream, white-label app, sponsor branding, ticker).
- **Hate list:** paywalled stats (2025), ads on every screen, duplicate and fake IDs, slow manual support.

### 2.2 What the best scorers in other sports do

1. **One tap per atomic event**: ball, rally, raid, goal. The scoreline is always *derived*, never typed.
2. **Offer the next likely action.** After a wicket, ask for the new batter. After an over, ask for the bowler, showing only legal ones. Basketball: after a miss, ask for the rebound.
3. **Instant undo, plus editing any past event**, after which the whole log is re-checked and replayed.
4. **One authoritative scoring device** with an explicit "take over" (PlayHQ, GameChanger). Other phones may *suggest*, never commit.
5. **Offline-first is universal.** Events queue on the phone and sync later.
6. **An edit window, then lock.** After the match, the scorer can fix for a while; after that, only the organiser can correct, with an audit trail.
7. **Tiered depth per sport.** GameChanger scores baseball pitch by pitch but scores football at "goals + period + who's on". Ship shallow everywhere, go deep where demand is.
8. **Scorers are free; fans, streams and organisers pay.**
9. **Roster accuracy before the match** is the most common failure (volleyball reviews). This is the thing we already solve.

### 2.3 White space in India

- **Kabaddi:** no real grassroots scoring app exists.
- **BGMI and other battle-royale lobbies:** handled in spreadsheets.
- **Multi-sport club and corporate tournaments:** served by nothing.

CricHeroes is cricket only.

---

## 3. Product principles (binding for LS-1)

1. **Start a match in under 60 seconds.** Teams, squads, lineups, ground and format already exist in the season, so the scorer confirms rather than types.
2. **One thumb, one tap per ball.** The scorer is watching the game, not the phone. Big targets, haptic feedback, no typing while play is live.
3. **The log is the truth.** Every number anyone sees (scorecard, table, career, awards, overlay, poster) is folded from the event log. Nothing is typed twice.
4. **Never lose a ball.** The phone keeps working with no network and syncs later. The server accepts each event exactly once.
5. **One person scores at a time.** Taking over is explicit and visible to everyone.
6. **Every award explains itself.** "46 off 28 = +46, 2 sixes = +4, 2 wickets = +40…" Organiser overrides are shown, never hidden.
7. **Stats belong to the player.** Pricing is open, with no free-forever promise. If something is gated, it is gated from day one and never clawed back. CricHeroes' 2025 claw-back is what made users angry, not the price.
8. **Verified people only** on leaderboards and awards. Unverified names can play and be scored, but appear as "unverified".
9. **A sport is still a pack of values.** Behaviour lives in a small number of *family engines* in core, shared across sports (§4.2).
10. **Gate the data, not the button.** A spectator sees the public live page; a scorer gets the scoring pad; nobody gets phone numbers.

---

## 4. Architecture

### 4.1 The event log

New table `match_events`:

| Column | Notes |
|---|---|
| `fixture_id` | the match |
| `seq` | server total order, unique per fixture |
| `event_id` | ULID chosen by the client; idempotency key, unique |
| `client_seq` | the scorer device's own counter |
| `scorer_lease` | which lease wrote it |
| `type` | e.g. `ball`, `toss`, `innings_start`, `raid`, `rally`, `goal`, `sub`, `period_end` |
| `payload` | jsonb, validated by the family engine |
| `game_clock_ms` | nullable; clock sports only |
| `recorded_at` | |
| `actor_person_id` | |
| `voids_seq` / `amends_seq` | nullable; set on correction events |

Rules:

- **Corrections are events.** `void(seq)` or `amend(seq, payload)`. Nothing is updated in place. Undo is just "void the last".
- **Pure fold.** `replayMatch(family, format, events) → MatchState` lives in `packages/core`. It is the same pattern as `replayAuction`, settlement and finops, which this team already certifies.
- **Projections** are folded from the log and written when the match is *finalised*:
  - `match_player_lines`: one row per person per match, with a stat jsonb shaped by the family (runs, balls, 4s, 6s, wickets, overs, catches…; goals, assists, cards…; raid points…)
  - `fixture_results`: we keep it as today, now *derived* when the match was scored live, so standings code does not change
  - the award picks
- **Hand-typed results stay valid.** A match with no events still takes a hand-typed result. Live scoring is an upgrade, not a requirement. This matters for organisers who score on paper.
- **Lesson from the engine.** Client-chosen IDs must live in their own namespace and never collide with server timer IDs (`desiauction-engine-commandid-namespace`).

### 4.2 Sport families: code once, packs stay data

The SP-1 rule holds: a pack declares values, never functions (`pack-contract.test.ts`). So we add **four family engines** in `packages/core/src/scoring/<family>/`. A pack picks one and supplies knobs:

| Family | Sports | Atomic event | Engine owns |
|---|---|---|---|
| **delivery** | cricket, box cricket, (later baseball/softball) | the ball | innings, overs, strike rotation, extras, dismissals, bowler legality, targets, super over |
| **rally** | badminton, table tennis, pickleball, volleyball, (tennis, squash) | the rally won by side X | score, server, sides, game/set end, deuce/cap, best-of-N, (volleyball rotation later) |
| **timed** | football, hockey, basketball, futsal, handball, kabaddi | goal/point/card/sub on a clock (kabaddi: the raid) | clock and periods, on-field sets, subs, discipline; kabaddi adds mat state, revival queue, all-out |
| **placement** | battle royale, esports lobbies, (athletics heats, chess Swiss) | a round's result table | rounds, placement + kill points, cumulative standings |

A pack gains a `scoring` block, still pure values:

```ts
scoring: {
  family: "delivery",
  tier: 2,                    // 0 result only · 1 scoreline+lineup · 2 full events
  formats: [                  // organiser picks one per season, may override knobs
    { key: "t20", label: "T20", oversPerInnings: 20, ballsPerOver: 6,
      wicketsPerInnings: 10, maxOversPerBowler: 4, freeHitOnNoBall: true },
    { key: "t10", … }, { key: "box", … lastManStands: true, wideReBowl: true },
  ],
  stats: [ /* stat keys + labels the family fold produces, for scorecards */ ],
  awards: "cricket-v1",       // id of a versioned points table (§7)
}
```

Battle royale already has `fixtureShape: "lobby"`, which *is* the placement family at tier 0. LS-1 adds per-player kills.

### 4.3 Transport and real-time

- **Writes:** the scorer's phone posts *batches* of events (1 to n) to the web tier, then on to the engine. The server checks the lease, dedupes on `event_id`, assigns `seq`, validates with the family engine and appends.
  - A rejected event (illegal: an 11th wicket, a bowler bowling two overs in a row) comes back with a reason the pad shows.
- **Reads:** the existing engine WS hub is generalised to **rooms**. A room is `auction:<id>` or `match:<id>`. Snapshot frames are versioned exactly like auctions, and the reconnect, backoff and stale-frame policy is reused.
  - Viewers are receive-only and need no login on public matches.
  - Ticket and origin checks stay as they are.
- **Load:** CricHeroes peaks at about 7,000 simultaneous matches. A match emits roughly 1 event every 30 seconds, so even 1,000 live matches is about 33 writes a second. That is trivial. Fan-out is the cost.
  - The engine is a single machine today. LS-1 P3 must load-test rooms (`perf:scale` exists) before any marketing push.
- **Why not scoring through server actions only:** viewers need a push channel anyway, and the engine already has the single-writer + fold + verify discipline. One real-time system, not two.

### 4.4 Offline and handover

- **Pad state:** the scoring pad keeps its event queue in IndexedDB (`event_id`, `client_seq`, payload, synced flag). It renders from a *local fold* using the same core reducer, shipped to the browser, so the pad works with no signal and agrees with the server byte for byte.
- **Sync:** runs whenever online, with exponential retry. A red "offline, 7 balls waiting" banner shows the state. It never blocks scoring.
- **The scorer lease** (one per match). The holder is stored on the fixture.
  - **Start:** whoever starts scoring holds it.
  - **Take over:**
    - **Clean:** the old device is online, syncs, then releases.
    - **Forced:** the organiser or the new scorer forces it after the old device has been silent for 2+ minutes. The forced path warns: "Phone A has unsynced balls since over 12.3; they will be refused."
  - Events from a dead lease are kept in a quarantine list. The organiser can replay them, never silently merge.
  - **Same login on a new phone:** "Resume" pulls the server log and continues. This is the CricHeroes flow.
- **Spotters:** any other signed-in scorer on the match can *suggest* "that was a wide" or "wrong bowler". The suggestion appears on the scorer's pad as a chip to accept or dismiss. P6, optional.

### 4.5 After the match

- **Statuses:** `in_progress → finished (scorer may edit, 24 h) → final (organiser-only corrections, audited) → [season closed → frozen]`.
- **Finishing** derives the result, writes the projections, picks awards, and sends alerts and share cards.
- **A correction after final** re-folds and re-projects. Standings and careers update. The audit trail records who, what and why.

---

## 5. Cricket in depth (the first family)

### 5.1 Before the ball: the 60-second start

1. Open the match from the Matches screen, the match-day mail or the WhatsApp link, then tap **Start scoring**.
2. The format comes from the season (T20/T10/box/custom), shown as a summary with "change".
3. **Playing XI:** prefilled from `fixture_lineups`. If no lineup was picked, the whole squad shows with checkboxes. Extend lineups with:
   - batting order (drag)
   - captain, wicketkeeper
   - substitutes / impact player (12+ per side is allowed)
4. **Toss:** a coin animation or "who won, bat/bowl". Two taps.
5. **Openers + first bowler:** two pickers. The bowler list is the fielding XI.
6. Officials are optional: umpires (names or people) and the scorer is auto-filled.

Unknown or late players: "Add player" by name plus an optional phone. They become an **unverified guest**, are scored normally, and can be claimed later (§8.2).

### 5.2 The scoring pad

```
┌──────────────────────────────────────────┐
│ MPL Strikers 87/3  (11.4)   CRR 7.46     │  ← always visible, big
│ Target 152 · need 65 off 50 · RRR 7.80   │
│ ★ Arjun 34 (22)    Ravi 12 (9)           │  ← tap name = swap strike
│ ● Karan 2.4-0-19-1   this over: 1 4 • W  │
├──────────────────────────────────────────┤
│   0     1     2     3                    │
│   4     6     5+    …                    │  ← huge run buttons
├──────────────────────────────────────────┤
│  [WD]  [NB]  [BYE]  [LB]   modifiers     │  ← toggle, then tap runs
│  [  WICKET  ]        [ UNDO ]   [ ⋯ ]    │
└──────────────────────────────────────────┘
```

- **Run buttons record the ball in one tap.** Extras are *modifiers*: tap WD, then tap 2, and the result is a wide plus 2 runs. This handles every combination (no-ball + 4 off the bat, no-ball + 2 byes) without a menu tree.
- **Wicket:**
  1. Kind: bowled, caught, LBW, run out, stumped, hit wicket, retired hurt, retired out, obstructing, timed out, hit twice.
  2. Only for the kinds that need them: who (run out at which end), the fielder, and runs completed before the run out.
  3. The illegal combinations are already filtered: on a wide only stumped, run out, hit wicket or obstructing; on a no-ball no bowled, LBW or stumped.
  4. Then **new batter** (the next in batting order is preselected).
- **End of over:** the next-bowler sheet appears automatically. The last bowler and anyone over their quota are disabled, with the reason shown.
- **⋯ menu:** penalty runs (5, either side), change bowler mid-over (injury), change format/overs (rain), declare/end innings, swap ends, substitute, add player, abandon, super over.
- **Free hit:** when the format enables it, the pad says FREE HIT and allows only run out.
- **Box and gully rules** (format knobs): last man stands, wide/no-ball re-bowl or not, runs for wide, "out = −N runs", fixed overs per bowler. Each is one knob. This is the gully market CricHeroes leaves to Stumps and Gully Crix.
- **Every tap** gives haptic feedback, plus a toast with **Undo** for 5 seconds.
- **Auto commentary line** per ball, written from templates in en and hi: "11.4 Karan to Arjun, FOUR, through cover".

### 5.3 What the fold must get right (golden-tested)

| Rule | Detail |
|---|---|
| Balls, not decimal overs | 19.4 overs = 118 balls |
| Wide | Never a ball faced or a ball of the over; all wide runs go to the bowler |
| No-ball | Counts as a ball faced by the batter, not a ball of the over. The 1 run goes to the bowler. Bat runs go to both batter and bowler; byes or leg-byes off it go to neither |
| Byes / leg-byes | Never charged to the bowler |
| Penalty runs | Team extras only; can go to either side, including before or after an innings |
| `non_boundary` | A run four or overthrows are not a boundary, so no boundary bonus |
| Bowler-credited dismissals | Bowled, caught, LBW, stumped, hit wicket |
| Dismissals not credited to the bowler | Run out, obstructing, timed out, retired out, hit twice |
| Retired | Retired hurt is not a dismissal and the batter may resume; retired out counts as a dismissal |
| Two wickets on one ball | Rare, but representable |
| Concussion / impact substitutes | Both players get an appearance |
| Super over | A separate mini-innings pair, excluded from NRR and from career totals by default |
| Revised targets | V1 is a **manually entered revised target** (overs, runs) with a method label. A DLS calculator is a later item: the Standard Edition needs licensed tables, but a par/target helper based on the public method may be enough for amateurs |

**Golden test oracle:** Cricsheet publishes thousands of real matches ball by ball in an open JSON format. In P0 we replay Cricsheet matches through `replayMatch` and assert the scorecards match the published ones exactly. That gives us a free, massive regression suite covering every corner case real cricket has produced. We also **export** in Cricsheet-compatible JSON, extended with `retired out` and `retired not out`, which gives players and leagues a data-portability promise.

### 5.4 The live match page (spectators)

`/c/[slug]/m/[matchNumber]` is public when the season is public, is a WS room, and degrades to polling.

**Header:** the score, situation sentence ("Strikers need 65 off 50"), and a win-probability bar (later).

**Tabs:**

| Tab | Contents |
|---|---|
| Live | Current batters/bowler, last 12 balls as dots, commentary feed, partnership |
| Scorecard | Batting card, bowling card, fall of wickets, extras |
| Charts | Worm (runs by over, both innings), Manhattan (runs per over + wickets), run-rate. Wagon wheel only if the scorer tapped shot direction, an optional tier-3 toggle |
| Squads | Both XIs with roles; links to player profiles |
| Awards | After the match |

**Distribution:**

- OG image updates with the score, so WhatsApp link previews show "87/3 (11.4)".
- A "Follow match" button sends web push on wickets, 50s and the result.
- A season live strip on `/c/[slug]` and the public season page shows "2 matches live now".

### 5.5 Broadcast

- **Score ticker overlay** for OBS/vMix/Prism at `/c/[slug]/m/[n]/overlay`, transparent 1920×1080, reusing the auction overlay pattern. Themes come from the poster theme set (stadium, floodlight, minimal, ink…) in team colours.
- **Big-screen board** at `/c/[slug]/m/[n]/board` for a ground TV or projector.
- **Event stings:** FOUR, SIX, WICKET, 50, 100 and hat-trick play an overlay animation for 4 seconds. This is where the PREMIUM-1 theatre components get reused.
- Phone streaming (an RTMP relay) is **not** in LS-1. It is a paid add-on decision for later (§10). The overlay works with any streaming tool people already use.

### 5.6 Standings impact

- A live-scored match feeds `fixture_results` exactly as a typed result does, so `buildStandings` is unchanged.
- **Check before P2:** `netRate("runs","balls",6)` must use the **full over quota when a side is all out**, and exclude super overs. If the stored `balls` are actual balls faced, all-out NRR is wrong today. Fix by having the fold write NRR balls (full quota on all-out) into the score.
- For a revised target, credit Team 1 with (target − 1) off Team 2's allotted overs.

---

## 6. Other families (after cricket)

| Family | Tier at launch | Scorer pad | What viewers get | Effort |
|---|---|---|---|---|
| **Rally**: badminton, TT, pickleball | 2 | Two giant buttons (point A / point B), auto server, auto game end, undo. Doubles shows the serving court. Volume keys = point | Live score by game, point streaks, match winner | **Small**: 1 engine, 3 sports |
| **Rally**: volleyball | 1, then 2 | Same plus scorer tags (kill/ace/block/error, optional); rotation later | Set scores, top scorer | Small → medium |
| **Timed**: football, hockey, futsal | 1 | Clock with start/stop and halves; GOAL (scorer, assist), CARD, SUB; shoot-out | Score, timeline, goalscorers, cards | Medium |
| **Timed**: basketball | 1, then 2 | 1/2/3 points per player, fouls, team fouls; tier 2 adds the miss → rebound prompt flow | Box score; PIR/EFF later | Medium |
| **Timed (raid)**: kabaddi | 2 | Raid outcome: raider, touch points, bonus, tackled (by whom), empty, do-or-die counter; auto all-out and revival | Raid/tackle points, Super 10, High 5, super raid/tackle | Medium; the **white-space bet** |
| **Placement**: battle royale | 1 | Per round: placement + kills per team (exists), plus kills per player | Lobby table, top fragger | Small |

Every family reuses everything outside the fold: event log, lease, offline queue, rooms, live page shell, overlay shell, stats projection, award engine, alerts and posters.

---

## 7. Awards and leaderboards

### 7.1 Engine

- **`award_tables`** (code, versioned, values only): one per sport and format, e.g. `cricket-v1/t20`. A season **pins** a version when created, so a later formula change never silently re-ranks finished matches.
- **`match_player_scores`** (projection): total plus `lines[]` such as `{code:"six", qty:2, pts:4}`. The lines *are* the explanation.
- **`awards`** (append-only): `scope match|season`, `kind`, `computed_person_id`, `winner_person_id`, `source auto|organiser|fans`, reason, actor, at. An override **never deletes** the computed pick. The public card says "Organiser's choice · system pick: Ravi (58.0)".

### 7.2 Match awards

| Award | Rule |
|---|---|
| **Player of the Match** | Highest score. If the top scorer lost and a winning-side player is in the top 3, the winning-side player gets it (CricHeroes' rule, and well liked). Ties are broken by: winning side → larger single-discipline contribution → organiser |
| **Fighter of the Match** | The best player on the losing side (CricHeroes has this, and players love it) |
| Best batter / best bowler of the match | Shown on the result card; not stored as awards |
| **Fans' Player of the Match** | Optional and separate. Top 3 computed candidates, 1 vote per verified account, 2-hour window. **Never blended** into the computed score |

### 7.3 Cricket points table (`cricket-v1`, amateur)

Anchored on "a wicket ≈ 20–25 runs" (CricHQ, CricHeroes, Dream11 all land here). Context is measured against **this match's own run rate**, so it self-calibrates for tennis-ball, box and leather cricket.

| Event | T20 | T10 | Box/short |
|---|---|---|---|
| Run off bat | 1 | 1 | 1 |
| Four (bonus, not `non_boundary`) / six | +1 / +2 | +1 / +2 | +1 / +2 |
| Milestones | 30: +4, 50: +8, 100: +16 | 25: +4, 50: +10 | 20: +4, 30: +8 |
| Pace vs match: 0.5 × (runs − balls × match runs per ball) | cap ±10, ≥10 balls | cap ±8, ≥6 balls | cap ±6, ≥5 balls |
| Wicket (bowler-credited kinds) | 20 | 20 | 15 |
| Bowled / LBW / hit wicket | +4 | +4 | +4 |
| Top-order or set batter (positions 1–3, or out at ≥20) | +4 | +4 | +3 |
| Haul bonus | 3W +6, 4W +10, 5W +16 | 2W +4, 3W +8 | 2W +4, 3W +8 |
| Dot ball / maiden | +0.5 / +8 | +1 / +12 | +1 / +12 |
| Economy vs match: 0.5 × (balls × match runs per ball − conceded) | cap ±10, ≥12 balls | cap ±8 | cap ±6 |
| Catch / stumping / direct run-out | +8 / +10 / +10 | same | same |
| Assisted run-out (≤2 fielders) | +5 each | same | same |
| Duck (positions 1–7, ≥1 ball) | −2 | −2 | 0 |

**Example explanation shown to users:**

> **Player of the Match: Arjun · 71.4 pts**
> - 46 off 28 +46 · 4 fours +4 · 2 sixes +4 · reached 30 +4 · faster than the match +4.8
> - 2 wickets +40 · one was a top-order batter +4 · 7 dots +3.5 · cheaper than the match +2.0

Other sports' tables come from the research, ready for their phases:

- **Football:** goal 10 (GK/DEF 12), assist 6, clean sheet, cards.
- **Kabaddi:** raid and tackle points, super raid +3, Super 10 +5, High 5 +3.
- **Basketball:** PIR.
- **Battle royale:** placement + kills.
- **Racquet sports:** match winner, and rubbers won in a team tie.

### 7.4 Season awards and leaderboards

| Award | Rule (tiebreak chain) |
|---|---|
| **Season MVP** | Sum of match points; must play ≥50% of the team's matches. "Per match" is shown beside it. Best-N option for uneven groups. Never an average alone |
| **Best batter** (orange cap) | Runs → strike rate (qualified) → average → fewer innings |
| **Best bowler** (purple cap) | Wickets → economy → average → fewer balls |
| Best fielder | Fielding points → direct run-outs |
| Best wicketkeeper | Catches + stumpings as the designated keeper → fewer byes |
| Most sixes, best strike rate, best economy, highest score, best figures | Records, with qualification shown |
| Emerging player | Organiser sets the age or first-season gate, then MVP points |
| Fair play (team) | Optional umpire or captain rating 1–10 per match |

- **Qualification is shown, not hidden.** A greyed row reads "needs 14 more balls to qualify".
- **Defaults:** strike rate ≥60 balls per season; economy ≥10 overs (T20) or ≥5 (T10/box); average ≥3 innings.
- **Leaderboard scopes:**
  - season: live during the season
  - tournament: across editions
  - club
  - city
  - platform
  City and platform scopes are only for **verified** players, and only after enough volume to mean something (gated).

### 7.5 Where awards show up

- **Result poster:** the stadium theme, scorecard concept C, with the PoM photo or jersey.
- **Season awards poster** at the finale, next to the champion card.
- **Player profile:** an award shelf and career numbers.
- Public season page, OG cards.
- **WhatsApp/email:** "You were Player of the Match 🏆" to the player, with the explanation and their card.

---

## 8. Players, identity and stats integrity

### 8.1 Career stats

- Built from `match_player_lines` (projection) by sport.
- **Cricket:**
  - Batting: M, Inn, NO, Runs, HS, Avg, SR, 100/50, 4s, 6s, ducks
  - Bowling: Inn, Overs, Runs, W, BBI, Avg, Econ, SR, 3W/5W
  - Fielding: catches, stumpings, run-outs
  - Splits by format (T20/T10/box) and by ball type (tennis/leather), because mixing them makes averages meaningless
- **Filters:** season, tournament, team, format.
- Shown on `/me` (My profile) and the public player page, plus a "form" strip of the last 5 innings.
- **Free. Always.** (Principle 7)

### 8.2 Integrity: where we beat CricHeroes

- **One person = one profile.** We already have verified people (phone or email + OTP) and `person_id` FKs everywhere.
- **Guests** (players added at the ground by name):
  - stats are stored against a guest record
  - the scorer or organiser can send a **claim invite**
  - the player verifies, the guest folds into their person, and an audit row is written
  - the person can never be claimed twice (unique constraint)
- **Merge request** for duplicates: the player requests it, the organiser of the affected season confirms, and it is audited and reversible. No helpline.
- **Award and leaderboard eligibility:** verified only. Guests show as "unverified" and are excluded from city/platform boards.
- **Suspicion flags** (admin moderation queue; P7):
  - impossible numbers (a 100 in 3 overs)
  - the same scorer scoring their own team with a pattern
  - matches finished in a time shorter than the overs allow
- **Verified scorer badge:** a match scored by an appointed neutral scorer or official carries a "verified scorecard" mark, and only those count for platform-level leaderboards. This is the trust layer CricHeroes lacks.

### 8.3 DPDP and minors

- Career stats for players under 18 follow the existing minor-data posture. No public city or platform leaderboards for minors without guardian consent.
- **Public match pages** show names and numbers only, never phones (gate the data).

---

## 9. Officials (scorer, umpire, referee, commentator)

### 9.1 In LS-1

- **Scorer capability** `fixture.score`. Two grants:
  - per season (scope `tournament`, like the Auctioneer: migration relaxes the 0077 CHECK)
  - per match (a new `fixture` scope, or a `fixture_officials` row)
- **Appointment UI:** clone the Auctioneer appointment (`auctioneers.ts`): invite by phone or email, mail, accept.
- **Who may score:**
  - the organiser and staff (always)
  - appointed scorers
  - **the two team owners**, but only on their own match. This is the gully reality, and a match scored by a team owner is not "verified".
- **Officials on the match:** `fixture_officials (fixture_id, role umpire|referee|scorer|commentator, person_id?, display_name)`. They appear on the scorecard and in the official's profile ("matches officiated").
- Roles nav (RN-1): a **Scorer home** is "matches I'm scoring today", one tap into the pad.

### 9.2 Later (product phase 2, alongside ground booking)

- An officials directory per city, built from **real match history** on our platform: "Umpired 42 matches · 4.7★ from captains".
- Ratings come from captains after the match, as one question.
- Then booking and payment. Payments go through the same decision as ground booking (Razorpay Route), a founder call.

---

## 10. Money (options; no free commitment)

| Likely free tier (acquisition) | Likely paid (founder pricing) |
|---|---|
| Scoring, offline, handover | Branded overlay themes + sponsor logo slot in the ticker |
| Live page, scorecard, charts, alerts | White-label season app/site (custom domain) |
| Player career + awards | Premium posters / highlight reels |
| Season leaderboards, standings | Phone streaming relay (if ever; capital-heavy) |
| Basic overlay (1–2 themes) | Organiser Pro: multi-season analytics, export, priority support |

No ads inside the scoring pad, ever. This is a stated differentiator against CricHeroes' biggest complaint.

---

## 11. Phases

Each phase ships end to end (DB → core → UI → e2e) and is a separate PR or PR stack against main. Effort is for one engineer plus Claude, matching the pace of previous programmes.

| Phase | Scope | Exit test |
|---|---|---|
| **P0: Foundations** (1.5 wk) | `match_events` + lease columns; `scoring` block in pack types; `packages/core/src/scoring/delivery` fold; **Cricsheet golden suite** (≥500 real matches replayed, scorecards equal); Cricsheet export | Golden suite green; pack-contract still forbids functions in packs |
| **P1: Cricket scorer (online)** (2.5 wk) | 60-second start (lineup extension: order, keeper, captain, subs); scoring pad; wicket flow; over/bowler legality; undo/void/amend; finish → derived result → standings; edit window → final; `fixture.score` grant for organiser/staff/owners | e2e: score a full T10 match from lineups to the table; illegal events refused with reasons |
| **P2: Offline + handover** (1.5 wk) | IndexedDB queue, local fold, sync, lease take-over (clean + forced), quarantine, "Resume" on a new device; NRR all-out fix | Playwright with network offline mid-over → reconnect → identical server log; forced handover test |
| **P3: Live for viewers** (2 wk) | Engine rooms (`match:<id>`), public live page, scorecard, worm/Manhattan, live OG image, follow + web push, season live strip, **OBS overlay + board**, load test with `perf:scale` (target 1,000 live matches, 50k viewers) | Spectator sees a ball within 2 s; overlay renders in OBS; load test passes |
| **P4: Stats + careers** (1.5 wk) | `match_player_lines` projection, career by format/ball type, season leaderboards with qualification, player profile sections | Career numbers equal a hand-checked season |
| **P5: Awards** (1.5 wk) | `award_tables` cricket-v1, scores with lines, PoM + Fighter, organiser override with audit, season awards at the finale, result + awards posters, player award mails/WhatsApp | Explanation lines sum to the score; override keeps the computed pick |
| **P6: Officials + integrity** (1.5 wk) | Appointed scorers per season/match, `fixture_officials`, verified-scorecard mark, guest → claim → merge, spotter suggestions | Guest stats fold into a person exactly once |
| **P7: Rally family** (1.5 wk) | Badminton, TT, pickleball at tier 2; volleyball at tier 1 | Score a best-of-3 badminton match offline on a phone |
| **P8: Timed family + kabaddi** (3 wk) | Football/hockey/basketball tier 1 with clock; **kabaddi tier 2** raid engine | Full kabaddi match with an all-out and a super tackle |
| **P9: Placement + polish** (1 wk) | Battle royale per-player kills + top fragger; fans' vote; suspicion flags in admin moderation | Lobby MVP correct |

**Total:** about 17 weeks for everything. **Cricket is truly live and better than CricHeroes on trust after P1–P5, about 10 weeks.** Other sports follow at 1.5–3 weeks each because the platform is shared.

Gates (SP-1 lesson):

- P7–P9 run in the order the demand gate shows (`demo_requests.sport`), not this table's order.
- Kabaddi is placed first among the "timed" sports because it is unserved.

---

## 12. Decisions the founder needs to make

1. **Who may score by default?** Recommendation: organiser + staff + appointed scorers + both team owners, with owner-scored matches unverified.
2. **Player of the Match rule:** CricHeroes' rule (a winning-side player if in the top 3, else the overall top) plus Fighter of the Match? Recommendation: yes, both.
3. **Should organisers be able to override PoM on any match?** Recommendation: yes, but the computed pick is always shown alongside.
4. **Is the guest model OK** (score unknown players by name, claim later)? The alternative is to require a phone for everyone, which is slower at the ground and causes more duplicates.
5. **Streaming:** overlay only (recommended), or build a phone-streaming relay later?
6. **Pricing:** the founder said on 2026-10-08 there is no "free" commitment. Still open: which tier gates what (options in BRAINSTORM-2 §7).
7. **Which second sport after cricket:** kabaddi (white space) or badminton/TT/pickleball (cheapest, 3 sports in 1.5 weeks)? Recommendation: rally first, because it is cheap and fast to "multi-sport live", then kabaddi.
8. **Revised targets:** manual entry in V1 and DLS calculation later? Recommendation: yes.
9. **Platform/city leaderboards:** launch with season and tournament boards only, and add city/platform once ~500 verified-scored matches exist in a city? Recommendation: yes.

---

## 13. Research sources (summary)

- **CricHeroes:**
  - FAQ (identity, verification, handover, awards automatic, change only on tournament matches)
  - blog post "Most Valuable Player (MVP) by CricHeroes" (formula v1)
  - organiser handbook (directory: 4k scorers, 3.5k umpires)
  - score-ticker page
  - Capture box
  - The Core (Jan 2023 revenue mix, prices, 7k concurrent matches)
  - App Store reviews (2025 paywall of the points table and career stats; duplicate and fake IDs)
- **Multi-sport scoring:**
  - GameChanger: pitch flow, offline, handover, tiered sport depth, fans pay
  - PlayHQ: primary-device take-over, scoreboard webhooks
  - Play-Cricket Scorer / Scorer Pro: free official scoring
  - FIBA LiveStats: predictive next-event flow; box score derived
  - SoloStats: outcome-only tier
  - TeamSnap Live: crowd scoring with a 2-hour lock
  - VolleyStation: roster accuracy is the complaint
  - Sofascore/Torneo: amateur competitions in a big app
  - Kabaddi scoreboard apps: none serious
  - BGMI points table
- **Award methodology:**
  - IPL MVP table and the Wharton critique (count-only tables mis-rank)
  - Dream11 bands
  - CricHQ/PCA recreational MVP (25 runs = 1 wicket, relative to team rate)
  - ESPNcricinfo Smart Stats, CricViz Impact, ICC rankings
  - Orange/Purple cap tiebreaks
  - FIFA Golden Boot tiebreak (goals → assists → fewer minutes)
  - EuroLeague PIR and MVP from the winning team
  - PKL raid and tackle definitions
  - BWF best-10 ranking
  - Cricsheet JSON v1.3 (delivery schema, `non_boundary`, replacements, super over, targets)
  - MCC Laws (wide, no-ball, retired, timed out, 5 penalty runs)
  - ICC NRR (all-out = full quota, DLS credit rules)
- **Codebase map:** see §1. Key files:
  - `packages/core/src/sports/*`, `standings.ts`, `fixture.ts`, `capabilities.ts`
  - `apps/web/src/server/competition/{results,lineups,venues}.ts`
  - `apps/engine/src/{engine-core,server,single-writer}.ts`
  - `packages/core/src/{auction,poster,share-card}.ts`
