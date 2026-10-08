# LS-1 · 02 · Commit sequence (C00 → C46)

## How to use this file

- Execute the commits strictly in order.
- Each entry has:
  - **Subject** (the exact commit subject);
  - **Depends**;
  - **Files** (create / modify);
  - **Spec** (what to build, referencing `01-contracts.md` IDs);
  - **Tests** (must exist and pass);
  - **Gate** (from `00-README.md` §4);
  - **Acceptance** (IDs the validator checks).
- A ★ milestone end requires **G-full minus e2e** (`pnpm verify`, full `test:integration`, G-roles), plus the e2e specs written so far. Write a milestone entry in `EXEC-LOG.md`.

Paths are relative to the repo root:
- `core` = `packages/core/src`;
- `web` = `apps/web/src`;
- `db` = `packages/db`.

---

## Milestone 0: kickoff

### C00
**Subject:** `chore(ls1): start the live scoring execution log`

**Files:** create `docs/product/LS-1/exec/EXEC-LOG.md` with:
- a header;
- the starting `main` sha;
- the output of `select id, created_at from drizzle.__drizzle_migrations order by created_at desc limit 5`;
- a note confirming migration numbering 0112+ is free (T1).

**Gate:** `pnpm format:check`.

**Acceptance:**
- A-C00-01: the log exists with the main sha and the migration check.
- A-C00-02: draft PR opened with the template from `04-validation.md` §0.

---

## Milestone 1: the scoring domain (pure core) ★

All files go in `core/scoring/**`. No DB, no web.

### C01
**Subject:** `feat(core): scoring contracts, formats and conditions`

**Files:**
- Create:
  - `core/scoring/types.ts` (E-1, E-2 payload types, E-3, E-4, Phase, NextAction, PublicLiveState, PlayerLine, AwardLine);
  - `core/scoring/formats.ts` (F-1 `FormatSpec` + `FORMAT_PRESETS` + `formatByKey`);
  - `core/scoring/conditions.ts` (F-2 + `defaultConditions` + `conditionsLine(c): string`, e.g. "Night · white leather · turf");
  - `core/scoring/season-rules.ts` (F-3 + `parseSeasonScoringRules` + `NEW_SEASON_SCORING_RULES`);
  - `core/scoring/messages.ts` (E-4 English messages);
  - `core/scoring/index.ts` (barrel).
- Modify:
  - `core/sports/types.ts` (optional `scoring` block per F-1);
  - `core/sports/cricket.ts` and `core/sports/box-cricket.ts` (add `scoring` values, presets referenced by **value import** of the preset constants, no arrows);
  - `packages/core/package.json` exports: add `"./scoring": "./src/scoring/index.ts"`.

**Spec:** exactly F-1, F-2 and F-3. `conditionsLine` order: time · ball (colour + type) · pitch, omitting unknowns. Strings:
- day → "Day", day_night → "Day–night", night → "Night";
- "{colour} leather" / "Tennis" / "Tape" / "Rubber";
- pitch lower-case.

**Tests:**
- `core/scoring/formats.test.ts`:
  - every preset is internally consistent: `wicketsPerInnings` ≤ `playersPerSide`;
  - `deathFromOver` ≤ `oversPerInnings`;
  - keys are unique.
- `conditions.test.ts`: `defaultConditions` cases from F-2; `conditionsLine` snapshots.
- `season-rules.test.ts`: defaults and legacy parsing.
- `pack-contract.test.ts` still green.

**Gate:** G-core, G-static.

**Acceptance:**
- A-C01-01: `@desiauction/core/scoring` resolves.
- A-C01-02: cricket and box_cricket packs carry `scoring` values with no arrows.
- A-C01-03: the presets match F-1 numbers exactly.
- A-C01-04: `conditionsLine({timeOfDay:'night', ball:{type:'leather', colour:'white'}, pitch:'turf'})` === "Night · white leather · turf".

### C02
**Subject:** `feat(core): delivery fold for balls, extras, strike and overs`

**Files:** create `core/scoring/delivery/{state.ts, apply.ts, validate.ts, replay.ts}` and `core/scoring/delivery/rules.test.ts`.

**Spec:**
- S-1 entry points (`replayMatch`, `applyEvent`), S-2 state.
- Rules R-01..R-07 and R-28 (phase).
- Validators for `match_started`, `lineup_confirmed`, `toss`, `innings_started`, `ball` (non-wicket parts) and `strike_swapped`.
- `replayMatch` already handles seq sort and attempt filtering.

**Tests (named `R-0x …`):**
- dot, single, three, four (boundary), six;
- wide (1 and 1+4), no-ball (+4 off the bat; +2 byes), byes, leg-byes;
- strike rotation on odd and even runs;
- an over completes after 6 legal balls, with wides not counting;
- strike swaps at the over end;
- `ball` rejected when the bowler is null after an over (`no_open_innings` or `bowler` required → `bad_payload`);
- `runsBat` 8 rejected;
- `boundary: 4` with `runsBat` 3 rejected (`boundary_mismatch`).

**Gate:** G-core.

**Acceptance:** A-C02-01..A-C02-05. Each of R-01..R-07 has a passing named test, and the fold is deterministic: replaying twice gives a deep-equal state.

### C03
**Subject:** `feat(core): delivery fold for wickets, retirements and new batters`

**Spec:** R-10..R-14, the `new_batter`, `retire` and `resume_batting` validators, and the wicket parts of `ball`, including `runsCompleted` for run outs and `fielderIds` validation (must be in the fielding XI).

**Tests:**
- every `WicketKind`;
- wicket on wide (stumped allowed, caught rejected);
- no-ball (caught rejected, run out allowed);
- free hit (bowled rejected);
- lbw with `format.lbw=false` rejected;
- ball after wicket without `new_batter` rejected;
- retired hurt resumes;
- retired out counts as a wicket without bowler credit;
- two batters out on one ball is **not** possible in v1: reject a second wicket in the same payload (the type allows one).

**Gate:** G-core.

**Acceptance:** A-C03-01..04.

### C04
**Subject:** `feat(core): delivery fold for bowlers, quotas and free hits`

**Spec:** R-08, R-09, `bowler_set` (incl. mid-over: balls already bowled stay with the previous bowler), the free-hit flag after a no-ball when `freeHitOnNoBall` (cleared after the next legal ball; persists through wides), `penalty_runs` (R-05) and `style_set` (R-30).

**Tests:**
- consecutive over refused (except the first over);
- quota refused at max;
- mid-over change splits figures correctly;
- free hit persists across a wide and clears after a legal ball;
- penalty runs not charged to the bowler.

**Gate:** G-core.

**Acceptance:** A-C04-01..04.

### C05
**Subject:** `feat(core): innings ends, targets, revisions and super over`

**Spec:**
- R-15..R-21.
- The `innings_closed` validator.
- `revise`, applying R-17.
- `super_over_started`.
- `lastManStands`: wickets = playersPerSide closes the innings, and a lone batter can bat with no non-striker (non-striker null; strike never swaps).

**Tests:**
- all out at 10;
- overs complete;
- chase complete mid-over (closes immediately);
- target after a penalty;
- revise to 15 overs with target 120;
- tie → super over offered → super over → winner;
- super-over tie with `boundary_count`;
- last man stands;
- `tennis_gully` retire prompt surfaces via nextActions (in C07, so here only the state flag `retirePromptDue`).

**Gate:** G-core.

**Acceptance:** A-C05-01..06.

### C06
**Subject:** `feat(core): interruptions, outcomes, restart, void and amend`

**Spec:** R-24..R-27, R-40..R-42, R-50 (`replayMatch` throws `ReplayError`), `substitute` (R-23), `player_added`, `conditions_changed` (R-29) and `walkover`/`abandon`/`finish`.

**Tests:**
- interrupt blocks balls;
- resume allows them;
- restart ignores the old attempt;
- void of the 3rd ball of an over re-folds strike and overs;
- void that breaks a later wicket is rejected (`amend_breaks_later_events`);
- amend 1 → 4 boundary updates the totals;
- amend type mismatch rejected;
- substitute out cannot bowl;
- finish only after a derived result.

**Gate:** G-core.

**Acceptance:** A-C06-01..06.

### C07
**Subject:** `feat(core): next actions, derived result and public live state`

**Files:** `delivery/next-actions.ts`, `delivery/result.ts`, `delivery/public-state.ts`, `delivery/nrr.ts`.

**Spec:**
- S-4 (all NextAction kinds, suggestions per S-4 rules);
- N-1, N-2 (`scoreForResult(state, rules) → {home, away}` incl. `nrr_balls`);
- S-5 `publicLiveState` (situation strings exactly: "{team} need {r} off {b} balls" / "{team} {runs}/{wkts} ({overs})" / "Play stopped: {reason}" / "Innings break" / result text);
- the `ballsLeft`, `requiredRate` (2 dp) and `currentRate` (2 dp) formatting.

**Tests:**
- next actions at every phase;
- the bowler suggestion picks the least recent;
- the batter suggestion follows the order;
- the result margin wording for runs, wickets, tie, super over, walkover and no result;
- `nrr_balls` for all out with and without `allOutUsesQuota`;
- `publicLiveState` JSON size < 6 KB for a full T20 fixture built in the test.

**Gate:** G-core.

**Acceptance:** A-C07-01..06.

### C08
**Subject:** `feat(core): player lines, commentary and field zones`

**Files:** `delivery/lines.ts`, `delivery/commentary.ts`, `scoring/zones.ts` (`zoneAngle`, `zoneOfAngle`, `ZONE_LABELS` en/hi, `mirrorForHand`).

**Spec:** S-6 (super overs excluded), C-6 templates en + hi, E-3 zone geometry.

**Tests:**
- lines for batting, bowling and fielding (catch, stumping, direct and assisted run out);
- maiden detection;
- dots;
- commentary snapshots for 12 ball shapes in en and hi;
- zone mirror round-trip;
- `zoneOfAngle(zoneAngle(z, hand), hand) === z` for all 8 zones × 2 hands.

**Gate:** G-core.

**Acceptance:** A-C08-01..04.

### C09
**Subject:** `test(core): cricsheet oracle suite and export`

**Files:**
- Create:
  - `core/scoring/delivery/cricsheet.ts` (pure, two functions):
    - `fromCricsheet(json): {events: MatchEvent[]; expected: CricsheetExpected}`, which synthesises registration ids from the Cricsheet `registry.people` ids;
    - `toCricsheet(state, names): object` (v1.3.0 shape, `meta.data_version '1.3.0'`).
  - `core/scoring/delivery/cricsheet.test.ts`.
  - `core/scoring/delivery/__fixtures__/cricsheet/*.json`: **60 files** chosen by the curation script below, committed.
  - `core/scoring/delivery/__fixtures__/cricsheet/NOTICE.md`: "Ball-by-ball data from Cricsheet (cricsheet.org), licensed under the Open Data Commons Attribution License (ODC-BY 1.0). Files unmodified." plus the license URL.
  - `scripts/cricsheet-curate.mjs` (repo root).
  - `scripts/cricsheet-oracle.mjs` (nightly full run).
- Modify `.github/workflows/nightly-verify.yml`: add a step `node scripts/cricsheet-oracle.mjs` that downloads a **pinned** `https://cricsheet.org/downloads/t20s_json.zip` plus `ipl_json.zip`, verifies the SHA-256 constants in the script, and runs the oracle over every match. Allowed: ≤ 0.5% skipped with logged reasons (e.g. data_version quirks), 0 failures.

**`cricsheet-curate.mjs`.** It takes a local zip path, scans the matches and copies 60 of them (deterministic: sort by match id, then take the first matching each criterion until the quota):

| Criterion | Count |
|---|---|
| has a super over | 4 |
| `outcome.method` D/L | 4 |
| contains `penalty` extras | 3 |
| contains `retired hurt` | 3 |
| contains a wicket on a no-ball (run out) | 2 |
| contains a stumping off a wide | 2 |
| all out within overs | 6 |
| chased with balls to spare | 6 |
| tie without super over (no_result or tie) | 2 |
| female matches | 6 |
| IPL | 10 |
| any remaining T20Is | 12 |

**Oracle assertions per match:**
1. Each innings' total runs, wickets and legal balls equal a reference tally computed **independently** in the test from raw deliveries (the reference counts `runs.total`, `extras.wides/noballs` and wickets).
2. Before every delivery, the fold's `strikerId`, `nonStrikerId` and `bowlerId` equal the delivery's `batter`, `non_striker` and `bowler` (strike-rotation oracle).
3. Legal balls per over = `info.balls_per_over`, except the last over of an innings.
4. `deriveResult` winner/margin equals `info.outcome` (skip the method-based margin text for D/L; assert the winner only).
5. Super-over innings flagged.
6. `toCricsheet(replay)` → `fromCricsheet` → the same state (round trip).

**Mapping notes for `fromCricsheet`:**
- Insert `bowler_set` events when the bowler changes.
- Insert `new_batter` events when a new batter appears.
- A Cricsheet `retired hurt` wicket maps to the `retire` event.
- `penalty_runs` comes from `extras.penalty` or `info.penalty_runs`.
- A D/L `target` maps to `revise`.

**Gate:** G-core. Also run `node scripts/cricsheet-oracle.mjs --zip <local t20s_json.zip>` once locally and paste the summary into EXEC-LOG.

**Acceptance:**
- A-C09-01: 60 fixtures committed with NOTICE.
- A-C09-02: all 6 assertion classes pass on all 60.
- A-C09-03: nightly step wired with pinned SHA-256s.
- A-C09-04: local full run: 0 failures, skips ≤ 0.5%, summary in the log.

### C10
**Subject:** `feat(core): season rules for net run rate`

**Files:** `core/standings.ts`, `core/sports/tiebreakers.ts` (`netRateWithFallback`), `core/sports/cricket.ts`, `core/sports/box-cricket.ts`, tests `core/standings.test.ts` (extend).

**Spec:** N-3. Defaults stay the legacy behaviour when the flags are absent.

**Tests:**
- all out uses quota only with the flag;
- no-result excluded only with the flag;
- legacy results with no `nrr_balls` fall back to `balls`;
- the existing standings tests stay green unchanged.

**Gate:** G-core, G-static.

**Acceptance:** A-C10-01..03.

### C11
**Subject:** `feat(core): cricket-v1 award points and match awards`

**Files:** `core/scoring/awards/{cricket-v1.ts, pick.ts, season.ts, index.ts}` plus tests.

**Spec:** A-1..A-5. `scoreMatch(lines, state, formatKey) → Map<registrationId, {points, lines: AwardLine[]}>`, rounded to 1 dp.

**Tests:**
- The mockup example reproduces exactly: a player with 58* (37), 6×4, 3×6, 2 wickets (both **caught**, so no bowled/LBW bonus; one dismissed batter at position 2, so one top-order bonus), 6 dots, conceded 27 off 18 legal balls in a match with match runs per ball = 312/230, gets **127.6**. Expected lines:

  | Line | Points |
  |---|---|
  | runs | +58 |
  | fours | +6 |
  | sixes | +6 (shown together as "6 fours, 3 sixes +12") |
  | milestone_50 | +8 |
  | pace_vs_match | +3.9 |
  | wickets | +40 |
  | top_order_bonus | +4 |
  | dots | +3 |
  | economy_vs_match | −1.3 |

  Batting 81.9 + bowling 45.7.
- The PoM winning-side swap.
- Fighter null on tie.
- Deterministic tiebreak.
- Qualification thresholds.

**Gate:** G-core.

**Acceptance:** A-C11-01..04.

### C12
**Subject:** `feat(core): trust level computation`

**Files:** `core/scoring/trust.ts` plus a test.

**Spec:** T-1, T-2. `computeTrust({authority, kind, confirmations, viewerPeak, finishedAt, now, signals}) → {level, reasons}`. `detectPace(events)` classifies `pace_impossible` vs `backfilled` using the client timestamps within received batches (`receivedAt` groups).

**Tests:** each branch of T-1, and pace detection for a live batch vs a synced backfill.

**Gate:** G-core, then **★ milestone 1** (log it).

**Acceptance:** A-C12-01..03.

---

## Milestone 2: data ★

### C13
**Subject:** `feat(db): match tables for live scoring`

**Files:**
- Create `db/migrations/0112_ls1_match_core.sql` (D-1, D-2, D-3 + revokes); modify `db/migrations/meta/_journal.json`.
- Modify `db/src/schema.ts` (`matches`, `matchEvents`, `matchLiveState`), `ops/db/create-app-role.sql` (append-only + engine/runner revoke lines), `apps/web/scripts/verify-grants.ts` (`APPEND_ONLY` += `match_events`) and `web/server/test-support/purge-org.ts` (delete order: `matchLiveState`, `matchEvents`, `matches` before `fixtures`).

**Tests:** `web/server/scoring/schema.regression.test.ts`:
- insert/select under `withTenantDb`;
- cross-org select returns 0;
- **UPDATE on `match_events` as the app role fails** (use `APP_DATABASE_URL` when set, skip with a logged reason otherwise: CI sets it in the integration job).

**Gate:** G-db, G-static, G-int (the new file), G-roles.

**Acceptance:**
- A-C13-01: the journal passes the checker.
- A-C13-02: RLS FORCE plus `_tenant` policies on all 3 tables.
- A-C13-03: `match_events` append-only for all 4 roles (grants:verify green).
- A-C13-04: engine/runner have no access.
- A-C13-05: purge-org updated.

### C14
**Subject:** `feat(db): team managers, officials, scorer grant and result source`

**Files:**
- Create `0113_ls1_people_on_match.sql` (D-4, D-5) and `0114_ls1_scorer_grant_and_result_source.sql` (D-6, D-7); modify the journal.
- Modify `db/src/schema.ts`, `core/capabilities.ts` (add `"fixture.score"` to `Capability`, `"fixture:scorer"` to `CapabilitySet`, SETS: owner and staff gain `fixture.score`, `fixture:scorer: ["fixture.score"]`; **not** in `ORG_CAPABILITY_SETS`), `core/capabilities.test.ts`, and purge-org.
- `web/server/competition/create.ts` (or wherever competitions are created; find by grep `insert(competitions)`): set `scoringRules: NEW_SEASON_SCORING_RULES` on new competitions.

**Tests:**
- capabilities;
- `web/server/scoring/managers.regression.test.ts`: the person arm reads own rows only;
- the grants CHECK accepts `fixture:scorer` on tournament scope and still rejects `org:staff` there;
- a new competition has the default scoring rules.

**Gate:** G-db, G-core, G-static, G-int, G-roles.

**Acceptance:** A-C14-01..06.

### C15
**Subject:** `feat(db): move tournament carries match tables`

**Files:** create `0115_ls1_move_tournament_tables.sql` (D-8 first list); modify the journal and `web/posture/move-tournament.posture.test.ts`.

**Gate:** G-db, G-roles (posture), then **★ milestone 2**.

**Acceptance:** A-C15-01: the moved season's match rows change org; the function signature is unchanged.

---

## Milestone 3: scoring backend ★

New server folder: `web/server/scoring/`. Every write goes through `withTenantDb`.

### C16
**Subject:** `feat(web): scoring authority and team managers from auction owners`

**Files:** `web/server/scoring/authority.ts` (AUTH-1 `mayScore`, `authorityKind`), `web/server/scoring/managers.ts` (`syncAuctionOwnersToManagers(db, competitionId, actorId)`). Modify `web/server/roles/roles.ts`: add `scores: ScoringSeason[]`, derived from fixture:scorer grants, scorer officials and team_managers. Read-only (the shell offers `/score`).

**Spec:** `syncAuctionOwnersToManagers` inserts a `team_managers` row (role `manager`, source `auction_owner`) for every accepted `auction_owner_invites`/`paddle_grants` owner, using the same join as `rolesOf` `owns`. It is idempotent (`ON CONFLICT DO NOTHING` on the partial unique). Call it:
1. from the auction completion path, found by grep for where the auction status becomes `completed` in web server code (add one call after commit; if that path is the engine, call it instead at the first `/score` load for that competition, lazily);
2. lazily in API-2.

**Tests:** `authority.regression.test.ts` covers each AUTH-1 arm, a revoked grant and a revoked manager.

**Gate:** G-static, G-int.

**Acceptance:** A-C16-01..04.

### C17
**Subject:** `feat(web): start a scored match`

**Files:** `web/app/api/score/[fixtureId]/start/route.ts`, `web/server/scoring/start.ts`, `web/server/scoring/share-token.ts` (32-char base64url from `crypto.randomBytes(24)`).

**Spec:** API-2 in full. Audit `match.started`.

**Tests:** `start.regression.test.ts`:
- happy path creates the match, events 1..3, lineups and an `in_progress` fixture;
- a non-approved registration is refused;
- a draft fixture is refused;
- a second start from the same person or device is idempotent;
- a second start by another person is refused (claim held).

**Gate:** G-static, G-int.

**Acceptance:** A-C17-01..05.

### C18
**Subject:** `feat(web): append scoring events`

**Files:** `web/app/api/score/[fixtureId]/events/route.ts`, `web/server/scoring/append.ts`, `web/server/scoring/live-state.ts` (names book from registrations/people, initials/minor rules P-6), `web/server/scoring/rate.ts`.

**Spec:** API-1 in full, R-50, P-6 in the names book, and the live-state ring buffer (`history`, last 30 states) for P-3.

**Tests:** `append.regression.test.ts`:
- 120 balls in batches of 1, 7 and 50 give the same final state as one replay;
- a duplicate `event_id` returns `duplicate` and seq is unchanged;
- an illegal event returns `rejected` with the E-4 message, and later events in the batch are skipped;
- a non-holder is refused (`forbidden`);
- the rate limit;
- void and amend within the window work;
- after `final`, only the organiser can correct;
- `match_live_state.seq` equals `matches.last_seq`.

**Gate:** G-static, G-int.

**Acceptance:** A-C18-01..08.

### C19
**Subject:** `feat(web): resume, claim and handover`

**Files:** `api/score/[fixtureId]/events/route.ts` (GET), `api/score/[fixtureId]/claim/route.ts`, `api/score/[fixtureId]/handover-token/route.ts`, `api/score/handover/redeem/route.ts`, `web/server/scoring/claim.ts`, `web/server/scoring/handover.ts`, and `web/env.ts` (`SCORING_HANDOVER_SECRET`: optional in dev, **required when serving**, ≥ 32 chars; add the production refine and the preflight check in `scripts/preflight-production.mjs`, id `SCORING_HANDOVER_SECRET-set`; add a build-time placeholder like the others in the web Dockerfile if build evaluates env).

**Spec:** API-3, API-4, API-5. Token = `base64url(fixtureId.attempt.expiry.HMAC)`; single use, enforced via an `audit_log` lookup of `match.claim.handover_redeemed` with the same token hash.

**Tests:**
- resume returns events since seq;
- clean claim;
- force refused before 120 s of silence;
- force allowed for the organiser at once;
- token expiry and reuse refused.

**Gate:** G-static, G-int.

**Acceptance:** A-C19-01..05.

### C20
**Subject:** `feat(web): guest players and styles from the scorer`

**Files:** `api/score/[fixtureId]/players/route.ts`, `web/server/scoring/guests.ts`, `web/server/scoring/styles.ts`.

**Spec:** API-6 (reuse the existing club-only person creation path if one exists; grep `clubOrgId:` inserts; otherwise insert directly with `clubOrgId = orgId`, no phone or email), API-7.

**Tests:**
- a guest becomes an approved registration on the team;
- `style_set` fills a null column only;
- an existing value is untouched;
- the audit is written.

**Gate:** G-static, G-int.

**Acceptance:** A-C20-01..03.

### C21
**Subject:** `feat(web): finalize scored matches and guard typed results`

**Files:** `web/server/scoring/finalize.ts` (FIN-1 steps 1-3, 7-8; later commits add steps 4-6), `web/server/competition/results.ts` (N-4 reason `scored_match` plus the UI message in `fixture-actions.ts` reason map), `web/server/competition/standings*` (pass `allOutUsesQuota`/`excludeNoResultFromNrr` from `parseSeasonScoringRules(competition.scoringRules)` into `StandingsRules`).

**Tests:** `finalize.regression.test.ts`:
- a scored T10 finishes, `fixture_results.source='scored'` and `nrr_balls` is right;
- the standings table orders by the new NRR;
- a typed result is refused on a scored match;
- re-finalize after an amend updates the result.

**Gate:** G-static, G-int.

**Acceptance:** A-C21-01..04.

### C22
**Subject:** `feat(web): scoring sweep for edit windows and quiet matches`

**Files:** `web/server/scoring/sweep.ts`, `web/app/api/jobs/messages/route.ts` (add `sweepScoring()` before `drainOutbox`), the notification `match.quiet` per M (catalogue + inbox label + `SecurityAction` + template where needed), and `web/server/auth/security-actions.ts`, `web/lib/inbox-events.ts`.

**Spec:** API-8.

**Tests:**
- `sweep.regression.test.ts`: finished → final after the window; stalled after 6 h; quiet notice deduped;
- `notification-guard.test.ts` stays green.

**Gate:** G-static, G-int, then **★ milestone 3**.

**Acceptance:** A-C22-01..04.

---

## Milestone 4: the scorer's app ★

UI reference: mockups pages **Scorer** and **Both themes**. Every screen ships in both themes (INV-12) with the test ids in UI-4.

### C23
**Subject:** `feat(web): scorer home and match setup`

**Files:** `web/app/score/layout.tsx` (minimal layout; theme bootstrap; fonts; no console shell), `web/app/score/page.tsx` (URL-1), `web/app/score/[fixtureId]/setup/page.tsx` + `setup-flow.tsx` (client), `web/server/scoring/home.ts` (today's matches for the person via `mayScore`, plus readiness facts: both XIs, offline-ready flag client-side, umpires count), and the shell nav entry: add "Score" to `components/shell/nav.ts` for people with `roles.scores.length > 0`, with a test update in `nav.test.ts`.

**Spec:**
- **URL-1:** a list of hero cards. The first card is the next match, with conditions chips (`conditionsLine`), readiness ticks and a gold primary "Start scoring". Later matches are compact cards showing their one problem and one action. A Quick match tile appears only after C40 (hidden behind a `false` constant until then).
- **URL-2**, three steps, in order:
  1. Conditions (F-2 tiles, prefilled by `defaultConditions`, season ball from F-3).
  2. XIs: tabs per team, prefilled from `fixture_lineups` else the whole approved squad; drag to order (keyboard accessible: up/down buttons per row); C/WK pickers; substitutes; "+ Add player" (API-6).
  3. Toss and openers (winner, decision, striker, non-striker, opening bowler from the fielding XI).
- The final button calls API-2, then appends `toss`, `innings_started` via API-1, and routes to `/score/[fixtureId]`.

**Tests:** `setup-model.test.ts` (prefill logic). E2e comes in C28.

**Gate:** G-static, G-int (home.regression.test.ts).

**Acceptance:**
- A-C23-01: matches mockups 1-4 in both themes (validator compares screenshots).
- A-C23-02: setup is completable keyboard-only.
- A-C23-03: conditions are prefilled per F-2.
- A-C23-04: the nav entry appears only for scorers.

### C24
**Subject:** `feat(web): scoring pad with local fold and sync queue`

**Files:**
- `web/app/score/[fixtureId]/page.tsx` (server: gate with `mayScore`, load events via the same function as API-3, render `<Pad>`);
- `pad.tsx` (client);
- `use-match.ts` (local state: events plus a pending queue; folds with `replayMatch`);
- `queue.ts` (IndexedDB via `idb-keyval`: key `ls1:queue:<fixtureId>`; items `{event, status}`; also `ls1:device` for a stable deviceId);
- `sync.ts` (send loop: batch ≤ 50, exponential backoff 1 s → 30 s, on `online`/`visibilitychange`/`pagehide` with `fetch keepalive`);
- `strings.ts` (UI-5);
- `pad.css` (tokens only);
- add `idb-keyval` to web dependencies.

**Spec:**
- Mockup "Scoring pad". Score bug with the balls-left ring (reuse the auction countdown ring component if exported by `@desiauction/ui`; otherwise an SVG ring in `pad.tsx`).
- Batters with photos/identity placeholder. Bowler with a style tag. This-over chips.
- Extras as **modifiers** (tap then runs).
- Run grid 0-6 + "7+" (opens a stepper 7..10).
- WICKET, Undo, ⋯.
- **A tap is applied locally in < 50 ms** (no awaits before setState).
- Undo appends a `void` of the last own event (or drops it from the queue if unsynced).
- Toast "{label} saved" with Undo for 5 s.
- `pad-sync` shows "All balls sent" or "{n} waiting". The offline banner appears when `navigator.onLine` is false or the last send failed.
- Server rejections roll back that event locally and show the E-4 message in a sheet.
- Language from `people.language`.

**Tests:** `use-match.test.ts` (queue → fold → rollback on reject), `sync.test.ts` (batching, backoff, keepalive called on `pagehide` using a fake `fetch`).

**Gate:** G-static, G-int, `pnpm check:bundle` (budget per URL layout rule).

**Acceptance:**
- A-C24-01: local apply < 50 ms (measured in e2e via `performance.now()` around the click, recorded in the log).
- A-C24-02: offline taps queue and sync later.
- A-C24-03: a server reject rolls back with the message.
- A-C24-04: route JS within budget.
- A-C24-05: both themes.

### C25
**Subject:** `feat(web): pad sheets for wickets, bowlers, batters, styles and shot map`

**Files:** `web/app/score/[fixtureId]/sheets/{wicket-sheet.tsx, bowler-sheet.tsx, batter-sheet.tsx, style-ask.tsx, shot-sheet.tsx, field.tsx}`.

**Spec:**
- **Driven by `nextActions`:**
  - `pick_bowler` opens the bowler sheet (blocked rows disabled with the reason text, suggestion first, the optional matchup hint line from C42 hidden until then);
  - `pick_new_batter` opens the batter sheet;
  - `ask_style` opens the style ask (8 bowling styles as arm toggle × 4 types, mockup "New bowler", or a batting hand R/L).
- **Shot sheet** (mockup "Shot map"):
  - shown after a scoring shot per season `shotMap` ('every' | 'boundaries' | 'off');
  - 8 zone buttons on the field, mirrored for LHB with the note;
  - Skip;
  - **auto-close after 5 s** with a draining bar (reduced motion: no animation, still closes);
  - the ball is saved **before** the sheet opens; the zone arrives as an `amend` of that ball adding `shot`;
  - **zone labels are buttons ≥ 44 px**.
- **Wicket sheet** (mockup "Wicket"):
  - kinds filtered by R-11/R-12;
  - the "More…" row reveals hit twice, obstructing and timed out, plus retire hurt and retire out, which send `retire`;
  - fielder chips from the fielding XI;
  - an optional pin on a mini field (tap → `where`);
  - the next batter preselected;
  - Confirm sends `ball` with the wicket and `new_batter` in one batch.

**Tests:** `field.test.ts` (tap to zone/where mapping incl. mirror); component tests for blocked-bowler rendering (vitest + testing-library if already used in web; otherwise logic-only tests).

**Gate:** G-static, G-int.

**Acceptance:** A-C25-01..06:
- every sheet matches its mockup in both themes;
- the shot sheet auto-closes;
- the mirror is correct;
- illegal wicket kinds are absent;
- the ball is saved before the shot;
- targets are ≥ 44 px.

### C26
**Subject:** `feat(web): pad menu for interruptions, corrections and finishing`

**Files:** `sheets/menu-sheet.tsx`, `sheets/edit-ball-sheet.tsx`, `sheets/finish-sheet.tsx`, `sheets/revise-sheet.tsx`.

**Spec:**
- Menu (mockup "Match options"):
  - shot map setting (local override for this match);
  - Theme (Auto / Floodlight / Daylight, stored in localStorage `ls1:theme`);
  - penalty runs;
  - substitute;
  - pause (interrupt) / resume;
  - shorten (revise: overs + optional target + method);
  - "Ball, pitch or lights changed" (`conditions_changed`);
  - no result (`abandon no_result`, with a confirmation dialog explaining "Runs stay on records, marked no result");
  - restart (confirmation; reason required);
  - void the match: organiser only, reason required.

  **Organiser-only rule.** Hide organiser-only items for non-organisers rather than disabling them.
- **Edit any ball:** tapping a ball chip or a commentary row opens the edit sheet with the same controls as the pad, and sends `amend`. A void option is included. Server rejections show `amend_breaks_later_events`.
- **Finish sheet** (mockup "Target reached"): appears automatically on `finish` next action, with:
  - the result;
  - PoM preview (after C35; until then hidden);
  - gold "Finish and share";
  - "Not over · back";
  - "Next match" (to the next fixture the person may score today).

**Tests:** `menu-model.test.ts` (which items are visible per authority).

**Gate:** G-static, G-int.

**Acceptance:** A-C26-01..05.

### C27
**Subject:** `feat(web): offline shell, in-app browser gate, install and handover`

**Files:**
- `web/app/score/shell/page.tsx` (static, no data, no cookies needed: `export const dynamic = 'force-static'`, renders the pad chrome and hydrates from IndexedDB using the fixture id from `location.hash`);
- `apps/web/public/sw.js`:
  - add a **documented exception block**: precache `/score/shell` into `da-shell-<rev>` and serve it for navigations to `/score/*` **only when offline**;
  - bump `OFFLINE_REVISION` and update `src/lib/pwa.test.ts` digest;
  - keep every other rule;
- `web/lib/pwa.ts` (export `requestPersistentStorage()`);
- `web/app/score/in-app-gate.tsx` (detects WhatsApp/Instagram/Facebook in-app browsers by UA tokens `WhatsApp`, `Instagram`, `FBAN`, `FBAV`; shows mockup "Opened inside WhatsApp" before setup; viewers are never gated);
- `web/app/score/handover/[token]/page.tsx`;
- `sheets/handover-sheet.tsx` (QR via `qrcode`, dependency added);
- `web/app/score/[fixtureId]/prepare.ts` ("Get ready for match day": fetch and store events plus names for today's matches; pre-cache the shell).

**Spec:**
- Sign-out must clear `ls1:*` IndexedDB keys. Hook into the existing sign-out client path (grep `signOut` client component), plus a test.
- The SW exception comment must name this plan.

**Tests:**
- `pwa.test.ts` digest;
- `sw-score.test.ts` (unit-test the routing predicate extracted as a pure function in `public/sw-score-route.js` imported by `sw.js` via `importScripts`, or duplicated with a test that keeps both in sync; choose `importScripts`);
- in-app UA detection table test.

**Gate:** G-static, G-int.

**Acceptance:** A-C27-01..05:
- a cold offline open of `/score/<id>` shows the shell and queued balls;
- no page other than `/score/shell` is ever cached;
- the in-app gate shows for the scorer only;
- handover works;
- sign-out wipes the queue.

### C28
**Subject:** `test(e2e): scorer journeys`

**Files:** `apps/web/e2e/scoring.spec.ts`, `apps/web/e2e/scoring-offline.spec.ts`, `apps/web/e2e/scoring-fixtures.ts` (DB seed helper: an org with a T10 season, two teams of 11 approved players with styles, a published fixture today with a lineup; uses the `createDb` pattern from `player-fixtures.ts`).

**Journeys:**
1. **Full T10 match** (the pad by test ids):
   - toss;
   - 20 overs with scripted balls incl. wide+runs, no-ball+4, leg bye, a wicket caught with a fielder and pin, a run out, a bowler-consecutive refusal, a shot map on boundaries, an undo, and an edit-ball amend;
   - target reached → finish;
   - assert `fixture_results` and the standings table row via the UI;
   - assert the live page updates (C30 later extends this spec).
2. **Offline:** go offline mid-over (`context.setOffline(true)`), record 5 balls, check `pad-sync data-pending=5`, go online, wait for sync, and check the server `last_seq` matches.
3. **Handover:** device A starts, opens handover, device B (second context, another scorer) redeems, scores the next ball, and device A's next tap is refused with the claim message.
4. **Both themes:** run journey 1's first over again with `data-theme=floodlight`, plus an axe check on the pad and sheets.

**Gate:** G-e2e (these specs), then **★ milestone 4** (full e2e suite).

**Acceptance:** A-C28-01..04.

---

## Milestone 5: watching live ★

### C29
**Subject:** `feat(web): public live API and share-token gate`

**Files:** `web/app/api/live/[fixtureId]/route.ts` (API-9), `web/app/api/live/[fixtureId]/view/route.ts` (API-10), `web/server/scoring/public.ts` (gate P-1, delay P-3), `ops/posture-allowlist.json` (`by-design` entry for `server/scoring/public.ts`).

**Tests:** `public.regression.test.ts`:
- a private season without a token gives 404;
- a public season gives 200;
- the token works for private;
- the ETag gives 304;
- the delay returns an older state for self_scored and the live state for verified;
- no phone, email or DOB in the payload (deep scan of keys);
- a minor shows initials.

**Gate:** G-static, G-int, G-roles (posture).

**Acceptance:** A-C29-01..06.

### C30
**Subject:** `feat(web): public live page and in-between states`

**Files:**
- `web/app/c/[slug]/m/[fixtureNumber]/page.tsx` + `live-view.tsx` (client poller);
- `web/app/m/[shareToken]/page.tsx` (same view, noindex);
- `web/server/scoring/public-page.ts` (SSR read model: first paint from `match_live_state` plus static facts: squads, conditions, kickoff);
- a link from the public season page's matches list to `/m/…` when a match row exists.

**Spec:**
- Mockups "Live", "Scorecard", "Live on a laptop", "In-between moments".
- Poll interval:
  - 2 s while the tab is visible and the phase is live;
  - 15 s otherwise;
  - stop when final;
  - `If-None-Match`;
  - backoff on errors to 30 s.
- "Updated {n} s ago". `live-stale` appears after 60 s with no new seq: "Last ball {m} min ago · the scorer has no signal" (scorer-offline state).
- The reconnecting banner shows after 2 consecutive failed polls.
- Before start: countdown, XIs, "Remind me at the toss" (web push follow; uses the existing push subscribe flow; if no push permission, falls back to email notify with consent).
- Result state in place, with no reload when the phase becomes finished.
- **No `loading.tsx`** (T2).
- Tabs are client-side with hash state.

**Tests:** `live-view.test.ts` (poll scheduling, stale and reconnect timers with fake timers).

**Gate:** G-static, G-int.

**Acceptance:** A-C30-01..06:
- first paint has the score without JS;
- polling cadence;
- stale and reconnect states;
- result in place;
- both themes;
- noindex on share pages.

### C31
**Subject:** `feat(web): wagon wheel, worm and manhattan`

**Files:** `web/components/scoring/{wagon-wheel.tsx, worm-chart.tsx, manhattan-chart.tsx, field-svg.tsx}`, chart tokens `--chart-s1`/`--chart-s2` added to the UI token source (both themes, values UI-3), and regenerated `packages/ui/src/generated/*` (CI checks `git diff --exit-code packages/ui/src/generated`).

**Spec:**
- Mockup "Wagon wheel + worm + Manhattan".
- Charts are SVG with hover/focus readouts and a "See it as a table" link.
- The wagon wheel shows the current batters (pills) and "All".
- Legend present.
- 1–3 / four / six colours per Kit.
- Keyboard focusable overs.

**Tests:** chart model functions (pure `*-model.ts`).

**Gate:** G-static, G-int.

**Acceptance:** A-C31-01..04.

### C32
**Subject:** `feat(web): live score link previews and follow`

**Files:** `web/app/c/[slug]/m/[fixtureNumber]/opengraph-image.tsx` + `twitter-image.tsx` (through `imageResponse`, mockup "WhatsApp preview with live score", `revalidate = 15`), and the view ping from `live-view.tsx` (API-10, once per minute while visible).

**Tests:** an OG route renders a PNG (existing OG test pattern); the view ping is throttled.

**Gate:** G-static, G-int.

**Acceptance:** A-C32-01..03.

### C33
**Subject:** `feat(web): organiser match-day board`

**Files:** `web/app/seasons/[slug]/fixtures/today/page.tsx`, `today-board.tsx`, `web/server/scoring/today.ts`, and `nav.ts` (`claims` for `/fixtures/today` under Schedule plus the title regex "Match day").

**Spec:**
- Mockup "Match-day board".
- Problems first:
  - quiet > 15 min;
  - no XI 60 min before;
  - no scorer;
  - unconfirmed > 24 h.
- One action per row.
- Live rows show the score, a progress bar and need.
- Figures strip: watching today, posters shared (after C36; until then hide the tile), sponsor (after C43).
- Wide tables scroll horizontally on a phone.

**Tests:** `today.regression.test.ts` (problem detection).

**Gate:** G-static, G-int.

**Acceptance:** A-C33-01..04.

### C34
**Subject:** `test(e2e): viewer journeys and live load script`

**Files:**
- `e2e/scoring.spec.ts` (extend): a second browser context opens `/c/<slug>/m/<n>` before the first ball, sees the countdown, sees each ball within **3 s** of the scorer's tap (polling), sees the result in place, and the OG image returns 200.
- `e2e/live-states.spec.ts`: stale state (stop scoring 61 s using `page.clock`), reconnect banner (route 500 twice with `serviceWorkers: 'block'`).
- `scripts/live-load.mjs`: N virtual viewers polling with ETags against a target URL. Outputs p50/p95 latency and 304 ratio. Run against the local precompiled server with N=500 and log the result. **Target: p95 < 300 ms, 304 ratio > 80%.**

**Gate:** G-e2e, then **★ milestone 5**.

**Acceptance:** A-C34-01..03.

---

## Milestone 6: results, awards, careers ★

### C35
**Subject:** `feat(db): player lines and awards from finalized matches`

**Files:**
- Create `0116_ls1_lines_and_awards.sql` (D-9); modify the journal and schema.
- `verify-grants.ts` (`APPEND_ONLY` += `match_awards`), `create-app-role.sql`, purge-org, possibly `verify-rls.ts` (D-9 note).
- `web/server/scoring/finalize.ts` (steps 4-5).
- `web/server/scoring/awards.ts` (`overrideAward(db, {fixtureId|competitionId, kind, registrationId, reason, actorId})`, organiser only, `fixture.manage`, audit `match.award.overridden`).

**Tests:** finalize writes lines (sums equal the scorecard) and awards (auto); an override appends a row and shows the organiser's choice while keeping the computed pick; non-organisers are refused.

**Gate:** G-db, G-static, G-int, G-roles.

**Acceptance:** A-C35-01..05.

### C36
**Subject:** `feat(web): result page, result poster and award notices`

**Files:**
- `web/app/c/[slug]/m/[fixtureNumber]/result-panel.tsx` (shown when finished);
- `core/poster.ts`: add `"result"` to `POSTER_KINDS` and `buildResultPoster(input): ResultPoster`. Input: teams, scores, margin, PoM {name, photo|placeholder, figures}, wagon shots of PoM, competition name, branding.
- `web/server/competition/posters.ts` (`resultPosterSource`);
- `web/app/seasons/[slug]/posters/result/[fixtureId]/route.tsx`;
- `poster-studio` entry;
- notifications `match.result`, `match.award` (M) incl. templates, labels and the `da_match_award` WhatsApp template list entry;
- sends from FIN-1 via `afterNotify`/outbox with dedupe keys `match.result:<fixtureId>:<personId>` and `match.award:<fixtureId>:<kind>`.

**Spec:** mockups "Result + Player of the Match" and "Result poster" (wagon wheel behind, theme `stadium` default, all `POSTER_THEMES` supported). Share buttons: poster download/share and the WhatsApp link (the live page URL).

**Tests:** `poster.test.ts` (`buildResultPoster`), `posters.regression.test.ts` (route gate), `notification-guard.test.ts` green.

**Gate:** G-static, G-int, G-core.

**Acceptance:** A-C36-01..05.

### C37
**Subject:** `feat(web): cricket careers from scored matches`

**Files:**
- Create `0117_ls1_previous_career.sql` (D-10); journal, schema, `verify-grants.ts` (`APP_WRITES_PERSON`), create-app-role revoke.
- `web/server/player/career-stats.ts` (aggregate `match_player_lines` by format group and by `conditions.ball.type`; T-3 labels per match; qualification flags).
- Extend `/me` "My profile" and `/c/[slug]/p/[number]` with a Cricket stats section.
- `web/server/player/previous-career.ts` + form (self-reported block, labelled, never on boards).

**Spec:** mockup "Player career" (v1 page, adapted to the v2 kit) for figures, last 5 innings, awards shelf and recent matches with trust labels.

**Tests:** aggregation regression (two formats, a tennis and a leather match, a super over excluded), the previous-career person scoping (another person cannot write).

**Gate:** G-db, G-static, G-int, G-roles, then **★ milestone 6**.

**Acceptance:** A-C37-01..05.

---

## Milestone 7: trust and integrity ★

### C38
**Subject:** `feat(db): trust levels, confirmations and moderation`

**Files:**
- Create `0118_ls1_trust.sql` (D-11); journal, schema, purge-org.
- `web/server/scoring/trust.ts` (gathers facts, calls core `computeTrust`, writes `matches.trust_level/trust_reasons` at finalize and on confirmation).
- `web/app/match/confirm/[token]/page.tsx` (URL-13, mockup "Other captain confirms"; token = HMAC like API-5 with `SCORING_HANDOVER_SECRET`, purpose `confirm`, 7-day TTL; the page requires sign-in and checks `team_managers` for the opposing team).
- The `match.confirm_request` notification (M).
- Admin moderation: add a "Flagged matches" section to the existing moderation surface (find `app/admin/moderation`), listing `trust_level='flagged'` with reasons and actions **Verify** / **Keep flagged** / **Exclude from boards**. Writes go through `server/platform-ops` (depcruise rule) and the `inOrg` pattern (memory: platform desk writes use `inOrg`). Audits are recorded.
- Leaderboard/award queries filter T-3 (used from C42).

**Tests:**
- trust transitions;
- the confirmation page refuses non-managers;
- dispute sets `flagged` with reason `disputed`;
- moderation verify;
- depcruise green.

**Gate:** G-db, G-static, G-int, G-roles.

**Acceptance:** A-C38-01..06.

### C39
**Subject:** `feat(web): guest claims and minors on public pages`

**Files:**
- `web/server/scoring/guest-claim.ts`: the organiser or scorer sends a claim invite for a guest registration, using the existing `attachPhoneToClubOnly` path after normalising the phone with the existing helpers. Notification: reuse existing invite/claim kinds if present, else add `player.claim_invite` per M rules.
- Public read models (C29/C30/C36/C37): enforce P-6 in one helper `publicName(person, registration, matchDate)` used everywhere.

**Tests:**
- a claim moves stats (lines and ball_facts reference the registration, unchanged);
- a minor shows initials on the live page, poster and OG;
- an adult shows full names.

**Gate:** G-static, G-int, then **★ milestone 7**.

**Acceptance:** A-C39-01..04.

---

## Milestone 8: modes beyond the auction ★

### C40
**Subject:** `feat(db): quick matches on personal clubs`

**Files:**
- Create `0119_ls1_personal_org.sql` (D-12); journal, schema.
- `web/server/scoring/quick-match.ts` (get or create the person's personal org (`kind='personal'`, name "{Name}'s matches", slug `p-<ulid-lower>`); one hidden "Friendlies {year}" competition per sport (visibility private, `team_formation='organizer'` once C41 lands; until then the default), teams by name (reuse by name within the personal org = persistent teams), registrations from names (guests) or the person's previous players.
- `web/app/score/new/page.tsx` (URL-5, mockup "Quick match", house-rule preset picker = format presets).
- Filters: `organizations.kind='personal'` is excluded from `/orgs` listings, the admin directory counts (shown separately as "Personal"), public directories and `rolesOf` organiser detection (personal org owners are not "organizers" in navigation).
- Watch links use `/m/[shareToken]`.
- Flip the Quick match tile constant from C23 to true.

**Tests:**
- quick match creation is idempotent per person;
- personal orgs are hidden from listings and admin counts;
- rolesOf does not mark organizer;
- the share page works;
- trust for personal org matches never reaches `verified` (T-1).

**Gate:** G-db, G-static, G-int, G-roles, G-e2e (new spec `e2e/quick-match.spec.ts`: create → score 2 overs → finish → share link opens in a signed-out context).

**Acceptance:** A-C40-01..06.

### C41
**Subject:** `feat(db): seasons without an auction and team entry`

**Files:**
- Create `0120_ls1_team_formation.sql` (D-13); journal, schema, purge-org.
- Season creation UI: a question "How will teams be formed? Auction · I'll assign · Teams sign up".
- `components/shell/nav.ts` (hide the Auction tab and its claims when `team_formation ≠ 'auction'`).
- `app/tournaments/season-stage.ts` (for non-auction seasons: `registration_closed` → `season`, never `auction`; tests updated).
- Readiness and next-step copy: grep for auction-only steps in `season-stage.ts nextStep/needsYou` and the readiness center, and branch on `team_formation`.
- `web/app/join/[entryCode]/page.tsx` (URL-17: captain signs in, names the team, adds up to 30 players by name and optional phone; submits a `team_entries` row).
- `web/server/competition/team-entries.ts` (organiser approve → creates the team, registrations (approved; guests for players without phone), a `team_managers` captain row; reject with reason).
- Organiser review list on the Teams tab.

**Tests:**
- stage logic for all three formations;
- nav hides auction;
- entry approve creates the team + registrations + manager;
- the entry code is unique and 6 chars;
- an e2e `e2e/team-entry.spec.ts`: organiser creates a `team_entry` season, captain joins with the code, organiser approves, a fixture is generated and scored 1 over.

**Gate:** G-db, G-static, G-int, G-roles, G-e2e (new spec plus `fixtures.spec.ts`, `multi-sport.spec.ts` regression), then **★ milestone 8**.

**Acceptance:** A-C41-01..06.

---

## Milestone 9: insights, broadcast, scale ★

### C42
**Subject:** `feat(db): ball facts, player insights and season awards`

**Files:**
- Create `0121_ls1_ball_facts.sql` (D-14) and `0122_ls1_move_tournament_tables_2.sql` (D-8 second list); journal, schema, purge-org, posture test.
- `web/server/scoring/finalize.ts` (step 6).
- `web/server/insights/{batter.ts, bowler.ts, sample.ts}`. Queries are GROUP BY on `ball_facts` filtered by T-3, with the 60-ball small-sample rule. Each returns `{ sample: { balls, matches }, ... }`.
- Pages URL-14 (mockups "Batter insights", "Bowler insights"), URL-16 (mockup "Season awards": award cards, leaderboards with tabs and a conditions filter, qualification rows, a "How MVP points work" panel from A-1).
- Season award computation (A-5) on demand plus at season finale (`season-finale.ts` hook).
- The bowler-sheet matchup hint line (C25) enabled: "{batter} scores slowest against {style}: {rate} an over in {n} matches", shown only when the sample is ≥ 60 balls.

**Tests:**
- insight aggregates against a hand-built 3-match fixture;
- the small-sample flag;
- leaderboard qualification and tiebreaks;
- minors' insights not public.

**Gate:** G-db, G-static, G-int, G-roles.

**Acceptance:** A-C42-01..07.

### C43
**Subject:** `feat(web): captain brief, stream overlay and big-screen board`

**Files:**
- `web/server/entitlements.ts`: `can(entity, feature)` with features `captain_brief`, `overlay_sponsor`. **v1: `captain_brief` = `competitions.tier IN ('pro','association')`**; everything else true. One place, so pricing later is config.
- URL-15 page (mockup "Know your opponent"). When not entitled, show a locked preview with "Available on Pro seasons" and no data.
- URL-11 overlay (mockup "Stream overlay": transparent background, polls API-9 every 2 s, SIX/FOUR/WICKET stings 4 s transform-only, STAT card between overs from C42 insights, sponsor slot from new `competitions.scoring_rules.sponsor = {name, logoKey}`; the season settings form gets a sponsor field).
- `.../board` route: the same data at big-screen scale.

**Tests:** entitlement gate; overlay model (sting selection from the last event).

**Gate:** G-static, G-int.

**Acceptance:** A-C43-01..05.

### C44
**Subject:** `feat(live): websocket fan-out for live matches`

**Files:**
- New app `apps/live/`: `package.json` (name `@desiauction/live`; scripts build/dev/lint/typecheck/test/env:check copied from the engine pattern), `src/{index.ts, env.ts, server.ts, hub.ts, ticket.ts}`, `Dockerfile` (copy the engine pattern), `README.md`.
- `.github/workflows/ci.yml` (`images` matrix entry `live`), `.github/workflows/deploy-host.yml` (build loop + `prune_old_releases` + `wait_ready live 4100 180`), `ops/deploy/docker-compose.production.yml` (service `live`, replicas 1 for now but stateless, `LIVE_MEM` 384m, `LIVE_CPUS` 0.5, public alias `${COMPOSE_PROJECT_NAME}-live`), `ops/deploy/site.caddy` (`handle /live/*` inside the public domain block → `__STACK__-live:4100`, so no new DNS), `ops/deploy/init-env.sh` (`live.env`), `scripts/preflight-production.mjs` (live env checks), the migrator env mount.
- Web: `live-view.tsx` uses the WS when `NEXT_PUBLIC_LIVE_WS_PATH` is set (`/live/ws`), else keeps polling. **Polling stays as the fallback.**

**Spec:**
- The service holds **one** Postgres connection as `desiauction_system` (read-only role), with `sql.listen('match_live', …)`. The connection disables statement_timeout for that session.
- Web API-1 issues `pg_notify('match_live', fixtureId || ':' || seq)` in the append transaction.
- On notify, the hub reads `match_live_state` by primary key (system role) and broadcasts to room subscribers. Delay rules P-3 are applied in the hub exactly like API-9 (shared pure function from core `scoring/delay.ts`; move it there in this commit).
- Rooms are keyed by fixtureId.
- Subscribe message: `{ t: 'sub', fixtureId, gate: { s?: slug, t?: token } }`. The hub validates the gate with the same query as P-1.
- Heartbeat 20 s. Per-IP cap 20 sockets. maxPayload 1 KB. Origins from `LIVE_ALLOWED_ORIGINS`.
- `/healthz` and `/readyz`.

**Tests:** hub unit tests (gate, delay, broadcast); an integration test with a real `pg_notify` against the local DB.

**Gate:** G-static, `pnpm --filter @desiauction/live test`, G-int, images build (`docker buildx build -f apps/live/Dockerfile .`).

**Acceptance:** A-C44-01..06.

---

## Milestone 10: launch ★

### C45
**Subject:** `feat(web): play store app link and launch polish`

**Files:**
- `web/app/.well-known/assetlinks.json/route.ts`:
  - serves JSON from env `TWA_SHA256_FINGERPRINTS` (comma list) and `TWA_PACKAGE_NAME` (default `in.desiauction.app`);
  - 404 when unset;
  - `Content-Type: application/json`;
  - exclude `.well-known` in `middleware.ts` matcher;
  - preflight warning when unset in production.
- `docs/product/LS-1/TWA.md`: Bubblewrap steps, Play signing key, assetlinks.
- Terms paragraph P-5.
- Install prompt on `/score` after the first finished match.
- Copy review pass against UI-6.
- Remove any leftover feature constants.

**Tests:** route test; middleware test.

**Gate:** G-static, G-int.

**Acceptance:** A-C45-01..04.

### C46
**Subject:** `chore(ls1): full verification sweep`

**Files:** `EXEC-LOG.md` (final summary: counts per gate, the load-script numbers, the oracle summary, screenshots list), `docs/product/LS-1/FINAL.md` (append an "As built" section listing any logged deviations).

**Spec:**
- Run **G-full**.
- Capture screenshots of every mockup-mapped screen in both themes, at 390×844 and 1440×1000 where applicable, via a new `e2e/ls1-screens.spec.ts` that writes to `apps/web/e2e-artifacts/ls1/` (git-ignored). List them in the log.
- Mark the PR ready for review.

**Gate:** G-full.

**Acceptance:** A-C46-01..04.
