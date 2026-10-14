# LS-1 · 05 · Architect review and fix list

**Reviewed:** `feat/ls1-live-scoring` @ `680d3c64` (2026-10-14).

**Reviewer:** Claude (architect). Method: `04-validation.md` §3, plus four independent read-only reviews and gate re-runs.

**Verdict: DO NOT MERGE YET.**

**Status (2026-10-14):**
- The founder accepted every recommendation in §3 (R1–R7).
- **F01 is done** (`0e5ecedf`). The architect is now executing F02–F13 on this branch.
- ⚠️ A local-only merge commit `7a190185` ("Merge verified UI checkpoint 680d3c64 into main") exists on the **local** `main` (worktree `main-ui-merge`). **Never push it.** It carries the UI-refinement programme (storage-gated auction bids, 27 MB `BASELINE.json`) and is based on a stale `main`. When LS-1 merges, reset local `main` to `origin/main`.

The live-scoring work (`55c97aef`) is high quality and close to mergeable. The branch also carries a separate unreleased programme (UI-REFINEMENT) that changes live-auction bidding, and the review found five launch-blocking security/integrity issues plus three cricket-law bugs. Fix them in the order below, on the same branch (rules from `00-README.md` still apply), then the architect re-validates.

---

## 1. What was re-verified (independently, on a fresh database)

| Check | Result |
|---|---|
| Migration journal (124 entries) | ✅ |
| All 13 new migrations on an empty DB | ✅ |
| `format:check`, `depcruise` (2711 modules), `check:posture` (86 by-design, 0 debt/defect), `check:motion` | ✅ |
| Core tests | ✅ 60 files / 1207 tests; typecheck clean |
| Web integration | ✅ 338 files / **3473 tests passed**, but the run exited 1 on a vitest worker RPC timeout ("Timeout calling onTaskUpdate"). Load-related; watch it in CI |
| Live / engine / finops-runner integration | ✅ 4 / 75 / 5 |
| `grants:verify` | ✅ 593 expectations, 94 tables, 4 roles |
| `rls:verify` | ✅ |
| `posture:verify` | ✅ 16 files / 82 tests |
| **Cricsheet spot-check on 125 unseen real T20 matches**: innings, every batter line, every bowler line, winner; incl. a super over, 2 D/L chases, women's, no-result | ✅ **125/125 exact** |
| Award example 127.6 | ✅ (hand re-derived) |
| Engine / finops / runner / core-auction untouched | ✅ |
| Trial merge with current `main` (`21aa3c96`) | ⚠️ one trivial conflict in `packages/ui/src/identity/team-shield.test.ts` (both sides fixed the same SVG bug); no migration clash |

Not re-run by the architect: the full precompiled browser suite and the load script. Both are required again after the fixes (F-GATE).

---

## 2. Fix commits (execute in order; one commit each; gates per `00-README.md`)

### Part A: branch hygiene (first)

#### F01 `chore(ls1): move the UI refinement programme to its own branch` (done: `0e5ecedf`)

The UI-REFINEMENT commits (`ae9c27f6`…`680d3c64`) are a separate programme. Its own docs say "no PR is authorised", and it is not ready to ship with LS-1:
- every live-auction bid now needs IndexedDB, so blocked storage means no bids;
- an `unknown` outcome locks a bidder out until manual review;
- `UI_TREATMENT` rolls back CSS only;
- it commits a 27 MB `BASELINE.json`.

Steps:
1. `git branch feat/ui-refinement 680d3c64`. This preserves the refinement work untouched for its own review.
2. Reset `feat/ls1-live-scoring` to `55c97aef` (`git reset --hard 55c97aef` on the LS-1 branch only, after step 1 is confirmed with `git log -1 feat/ui-refinement`).
3. Bring back **only these LS-1 fixes** from the refinement commits, by path, as conventional commits:
   - `apps/web/src/server/scoring/prepare.ts` (the `hasRaid` fix) + `raid-finalize.regression.test.ts` + `sweep.regression.test.ts` (from `ae9c27f6`);
   - `apps/web/scripts/verify-rls.ts` + `apps/web/src/server/scoring/finalize.regression.test.ts` (from `d8e72a9a`; **without** its `financial-work.tsx` line);
   - `apps/web/src/server/admin/live-views.ts` + test (from `bbbb5fa4`) and `server/admin/demo-views.ts` + test (from `2604bbf4`) **only if** they apply cleanly to `55c97aef`; otherwise leave them on the refinement branch.
4. Gate: G-static + the named regression files.

Log the decision in EXEC-LOG. The refinement branch must later rebase onto merged LS-1, delete `BASELINE.json` from its history and get its own review. Out of scope here.

#### F02 `chore(ls1): merge main`

Merge `origin/main`. Resolve `team-shield.test.ts` by keeping main's version plus any LS-1-only assertion. Re-run G-static.

### Part B: security and integrity (launch blockers)

#### F03 `fix(web): keep scored results behind the betting delay everywhere`

Today `/c/[slug]` (`resultsOf`, `standingsOf`, `season-play.ts`), standings, sitemap `lastmod`, season OG/posters and `revalidateScoredMatch` publish the final result as soon as Finish is tapped. This bypasses P-3.

Fix:
1. Add `fixture_results.public_at timestamptz` (new migration `0125_ls1_result_release.sql`, idx 124, when 1794499200000 — re-check T1). Set it in `writeScoredResult` to:
   - `now()` when trust is `verified` or `publicDelaySeconds = 0`;
   - otherwise `finished_at + delay`.
   - Typed results: `now()`.
2. Every **public** reader of `fixture_results` filters `public_at <= now()`. Grep every `fixtureResults` read under `server/competition/public*`, `season-play.ts`, `standings*`, sitemap, OG, posters.
3. The organiser console is unaffected.
4. Schedule a `revalidatePath` at release time from `sweepScoring`.

Tests (regression):
- a self-scored public match's result is invisible on `/c/[slug]` data and standings until `public_at`;
- verified is immediate;
- sitemap `lastmod` respects it.

#### F04 `fix(web): count real viewers, not requests`

`POST /api/live/[fixtureId]/view` counts raw requests. 15 pings from one person lift a self-scored match to `confirmed`.

Fix:
1. SSR mints a signed view token: HMAC over (fixtureId, random nonce, minute), using `SCORING_HANDOVER_SECRET` with purpose `view.1`.
2. The ping must carry it. Count **distinct** (hashed client IP + nonce) per minute.
3. Ignore sessions that hold AUTH-1 authority on the match.
4. Rate-limit 2 pings per minute per token.
5. When `apps/live` is enabled, use its distinct socket count (by IP hash) instead.

Tests:
- 15 pings from one client give a peak of 1;
- 15 distinct clients give 15;
- the scorer's own pings are not counted.

#### F05 `fix(live): one read per room and lean live-state reads`

- **apps/live:** read once per (fixture, proof) per tick and fan out; add a global socket cap (`LIVE_MAX_SOCKETS`, default 5000).
- **Storage:** move the 30-entry delay `history` out of `match_live_state.state` into its own column `history jsonb` (migration `0126`), so hot reads select only the released entry.
- **`/api/live`:** add a 1 s in-process cache keyed by (fixtureId, proof, view).
- Re-run `scripts/live-load.mjs` (500 viewers) **and** a new mode with 5 rooms × 300 sockets on apps/live. Log p95.

#### F06 `fix(deploy): generate the scoring token secret`

Add `SCORING_HANDOVER_SECRET=$(secret 32)` to the `web.env` heredoc in `ops/deploy/init-env.sh`, plus a note in `docs/ops` that existing hosts must add it before deploying. Without it the first deploy crash-loops (env refine).

#### F07 `fix(live): a least-privilege database role for the live service`

`apps/live` is internet-facing but connects as `desiauction_system`, which can read every table and write grants.

Fix — create `desiauction_live`:
- NOBYPASSRLS;
- `LOGIN`;
- SELECT only through a new `SECURITY DEFINER` function `live_release(fixture_id, slug, token)` that applies P-1 and returns the released entry;
- LISTEN needs no table rights.

Wire it through `create-app-role.sql` (password variable `live_password`), `verify-grants.ts` (live can execute the function, select nothing), `init-env.sh` (`live.env`), `migrator/run.sh`, preflight and CI (`ci-live`).

#### F08 `fix(web): check eligibility for every scoring event`

In `append.ts`, the team/registration eligibility checks are skipped for the delivery family (`!isDeliveryState(next)`, ~lines 365/373).
- Apply them to every family.
- Require every attempt's `match_started` to match the fixture's teams and the frozen `matches.format`.

Test: a cricket `player_added` with a registration from another season is rejected.

#### F09 `fix(web): tighten guest claims, post-finish corrections and policies`

1. A guest claim to a phone that already has an account becomes an **invite the account holder accepts**. Do not attach silently.
2. After `finish`, `amend`/`void` are allowed only from the original scorer or an organiser. A force-claim is refused after finish.
3. `addScoringGuest`: authority (d) may add guests only to its own team.
4. Split the `team_managers_tenant` person arm into SELECT-only (migration, same pattern as `team_entries_captain_read`).
5. Revoke `team_managers` and `fixture_officials` from engine/runner (migration + recipe + `verify-grants.ts` list).
6. `app/score/new/actions.ts`: return fixed messages, never `error.message`.
7. apps/live: skip the per-IP cap for clients with no trustworthy address, as `client-address.ts` documents.

### Part C: cricket-law fixes (core)

#### F10 `fix(core): penalty runs to the batting-first side raise the target`

In `transition.ts` `penalty_runs`, when the awarded innings is complete and the next innings is the chase with `targetMethod === null`:
- set `target = innings.runs + 1`;
- re-run `closeIfComplete`.

Same for a super-over pair.

Regression (from the review): 1-over match, home 6, +5 to home mid-chase, away 7 → home wins by 4.

#### F11 `fix(core): net run rate when a side runs out of batters and in revised chases`

1. **No batters left.** `nrr.ts`: treat `closed === "no_more_batters"` like `all_out` for the quota (not for a successful chase).
2. **Amend contract N-2 to ICC.** In a revised-target match:
   - a **winning** chase uses its actual balls;
   - an all-out chase uses its revised quota;
   - the side batting first is credited with **(target − 1) runs off the chasing side's allotted balls**, written as new score fields `nrr_runs` (and `nrr_balls`) on that side. Standings use `nrr_runs ?? runs` via `netRateWithFallback`.

Update `01-contracts.md` N-2.

Test against Cricsheet 1547900 (Belfast credited 146/90).

#### F12 `fix(core): smaller law gaps`

- (a) A run out on a wide accepts `runsCompleted` up to `wides − wideRuns`.
- (b) R-08: every bowler who bowled any ball of the previous over (incl. a mid-over replacement) is blocked for the next over (Law 17.8). Amend the contract.
- (c) A free hit also allows `hit_twice` (ICC).
- (d) A leg-bye/bye legal ball counts as a bowler dot (state the rule in A-2).
- (e) `revise` may target the next innings during the innings break (DLS entered before the chase starts).

Tests for each.

### Part D: contracts catch-up

#### F13 `docs(ls1): bring the contracts up to date with what was built`

`01-contracts.md` must describe the code. Add the amendments that live only in EXEC-LOG:
- C29–C41;
- D-9 / D-13 SELECT-only person arms;
- migrations 0123–0126 in the D table;
- `match_voided`;
- seeded `style_set`;
- the C09 importer fields;
- delay-404;
- toss reminder;
- WhatsApp-only award;
- claim channels;
- franchise reuse;
- `/join` dispatch;
- the new award kinds;
- the force-takeover flow.

No code.

### F-GATE (after F13)

Run G-full on a fresh database, including:
- the full precompiled browser suite;
- both `live-load` modes;
- **X-20: a timed "60-second start"** (seeded season, from `/score` to first ball; record a Playwright trace). This was never measured.

Log the results in EXEC-LOG. Then hand back for re-validation.

---

## 3. Founder decisions needed (before or during the fixes)

| # | Topic | As built | Original decision | Recommendation (all accepted 2026-10-14) |
|---|---|---|---|---|
| R1 | Trust for leaderboards (D5) | Auto-"confirmed" needs **all of**: live-scored, 15+ distinct viewers, 48 h, no dispute | "Any one" signal | Accept the stricter rule **only after F04** (real viewers). My contract text T-1 was ambiguous; the stricter reading is the safer one against fake stats. Revisit after the first city if boards look empty |
| R2 | Minors (D11) | Known minors **never** show full name or photo, even with guardian consent | "Until guardian consent" | Keep the stricter rule for launch (DPDP-safe, no consent UI needed). Add a consent flow later if academies ask |
| R3 | Oracle bar | Exclusions allowed up to 1.0% (you said "keep going"). 14,986 strike changes inferred during import | 0.5% | Accept. The independent 125/125 unseen-match check is stronger evidence than the ceiling |
| R4 | Notification channels | Award notices WhatsApp-only (Meta template not yet approved); guest-claim invites in-app/email only | SMS/WhatsApp | Add the `da_match_award` template to the Meta approval queue now. Accept in-app/email claims for launch |
| R5 | Scope gaps outside cricket | Rally: no player awards. Hockey: unscored. Football: no penalty save/miss. Non-cricket: no season awards. Lobby: top fragger only | "All sports" | Accept for launch. Cricket is the wedge; these are logged as honest limits in FINAL "As built" |
| R6 | Smaller reductions | "Follow" = toss reminder + view only; previous career private; match-day board has no poster/sponsor tiles; offline setup/toss need a connection; Play Store listing not published (needs your Play account) | As planned | Accept for launch, except: restore the sponsor tile when the sponsor feature is used (small). The **Play listing is your action**: Bubblewrap steps are in `TWA.md` |
| R7 | UI-REFINEMENT | On this branch | Not part of LS-1 | Split per F01. Before it ever ships, decide whether bids may depend on browser storage; my advice is **no** |
