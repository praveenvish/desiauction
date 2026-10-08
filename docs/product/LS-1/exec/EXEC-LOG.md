# LS-1 execution log

## 2026-10-08 · C00 · Kickoff

- Branch: `feat/ls1-live-scoring` (existing plan branch, synchronized with origin).
- Starting `origin/main`: `5bf49973175084ae0a314311d7bd8791b0131fd7`.
- Plan head before execution: `3a4eada9b0755b506b5b360a82393daf16edac23`.
- Read `00-README.md`, `01-contracts.md`, `02-commits.md`, `03-sports-families.md` and `04-validation.md` in full before implementation.

Migration check against the local development database configured in the primary checkout's `.env.local`:

```sql
select id, created_at from drizzle.__drizzle_migrations order by created_at desc limit 5;
```

```text
 id  |  created_at
-----+---------------
 112 | 1793289600000
 111 | 1793203200000
 110 | 1793116800000
 109 | 1793030400000
 108 | 1792944000000
(5 rows)
```

The migration journal ends at `0111_team_badge`, idx `110`, when `1793289600000`. No migration numbered 0112 or later exists. The next migration is free: `0112_ls1_match_core.sql`, idx `111`, when `1793376000000` (previous when + 86400000). Database migration ids are not migration filename numbers.

Gate: `pnpm format:check` passed (exit 0; all matched files use Prettier code style). Locked dependencies were installed in this worktree before the successful run; no tracked dependency files changed.

## 2026-10-08 · C00 · BLOCKED

What the plan says: `00-README.md` §2 rules 5–6 (lines 41–49) require pushing after every commit and opening one draft PR after C00; `02-commits.md` C00 (lines 36–38) requires A-C00-02, the draft PR with the validation template.

What the repo has: C00 is committed locally as `7a2b8193` on `feat/ls1-live-scoring`, and its format gate passed. The mandatory `git push -u origin feat/ls1-live-scoring` exited 128 with `failed to get: -128` and `fatal: could not read Password for 'https://praveenvish@github.com': Device not configured`. The remote is configured as `https://praveenvish@github.com/praveenvish/desiauction.git` in the shared Git configuration. Git credential lookup also reported no usable GitHub credential. `gh` is not installed. C00 has not been pushed, the draft PR has not been opened, and A-C00-02 is incomplete.

Smallest change that would satisfy the plan's intent: restore authenticated GitHub push and PR access for this repository, then have the architect explicitly resolve this blocker. Resume by pushing the existing local commits and opening or updating the single draft PR with the required checklist before C01. No code or plan changes are needed.

Execution stopped under `00-README.md` §6. No C01 or later work has started. The continuation monitor must stay quiet and must not resume implementation while this BLOCKED entry remains unresolved by the architect.

## 2026-10-08 · C00 · RESOLVED by user instruction

The user instructed: "no need to raise PR keep going and add commit at last i'll merge and create sing pr". This explicitly supersedes the per-step commit, push and draft PR requirements. Defer further implementation commits until the end; PR creation and merging belong to the user. C00's existing local commits remain intact. Continue the implementation entries strictly in order, with each entry's gates passing before starting the next. Keep acceptance progress here instead of in a PR body. The C00 authentication blocker no longer prevents implementation; A-C00-02 is deferred to the user under this instruction.

## 2026-10-08 · C01 · BLOCKED

What the plan says: `02-commits.md` lines 49–76 requires the new scoring contracts in `packages/core/src/scoring/types.ts`, including E-2 and S-5, and a passing G-core. `01-contracts.md` line 409 explicitly requires `style_set.battingHand?: 'right'|'left'`; S-5 also requires these hand values on public batters.

What the repo has: `packages/core/src/sports/sport-vocabulary.test.ts` lines 162–171 classifies two bare style tokens in one file as a copied style vocabulary, and lines 212–219 rejects them outside the sport packs. G-core's test command exited 1: 797 tests passed, 1 failed, across 47 files. The only failure is this pre-existing guard, with offenders `packages/core/src/scoring/types.ts — "right"` and `packages/core/src/scoring/types.ts — "left"`. All 33 new C01 tests and the pack-contract tests passed. The required type contracts and this existing guard contradict each other as written.

Smallest change that would satisfy the plan's intent: have the architect authorize a narrow, regression-tested exception for the scoring hand contract in the vocabulary guard (and document how the later delivery validators and zone helpers use that same contract). Keep pack vocabulary leak detection intact. Do not rename the required payload values or evade the scanner.

Verification: format, dependency boundaries (1989 modules, 8286 dependencies), tenant posture (81 by-design, 0 debt, 0 defect), and motion checks passed. The first repository typecheck run found a nullable overs value in a new test assertion; that local implementation error was corrected. A subsequent standalone core typecheck and core lint both passed. Full G-static remains unverified after that correction. G-core remains red due to the vocabulary contradiction.

The C01 implementation is preserved uncommitted for review. No acceptance IDs are marked complete while its gates are red. Only this log is committed as required by §6; implementation commits remain deferred under the user's instruction. C02 has not started. Execution and the continuation monitor must wait for architect resolution of this new blocker.

## 2026-10-08 · C01 · RESOLVED by Astra architect review

The user explicitly authorized calling Astra for architect resolution and continuing. The `gpt-6-astra` architect approved a canonical `BATTING_HANDS = ["right", "left"] as const` declaration and a derived `BattingHand` type in `scoring/types.ts`. The vocabulary scanner may remove only one exact, anchored canonical declaration in that exact file before its unchanged style check. Role checks continue scanning the entire source. Mutation tests must prove wrong paths, modified tuples, duplicate hand lists and compound style copies still fail. Later validators use tuple membership; zone helpers accept the derived type. No football-foot coupling or broad allowlist is authorized. C01 gates must pass before C02 begins.

## 2026-10-08 · C01 · Gates passed

G-core: 47 test files, 799 tests passed; core typecheck and lint passed. G-static: format, depcruise (1989 modules, 8286 dependencies), posture (81 by-design, 0 debt/defect), motion, and forced repository lint/typecheck all passed (25 tasks). A-C01-01..04 satisfied; the exported subpath is imported and typechecked by the formats test, both pack declarations and exact presets are asserted, and the conditions example is exact. Implementation remains uncommitted per user instruction.

## 2026-10-08 · C02 · Astra sequencing clarification

The architect authorizes reserving penalty state and testing that balls preserve it in C02. Full R-05 event validation, application and current/next-innings routing remain in C04 as explicitly assigned there. Partial R-05 coverage in C02 does not claim full R-05 completion. Before C05, the architect recommends an explicit additive E-2/S-2 amendment for immutable `superOverTie` on `match_started` and state; record that amendment when reached, preserving the original setting on restart.

## 2026-10-08 · C02 · Gates passed

G-core: 48 files, 840 tests passed (41 delivery tests); typecheck and lint passed. A-C02-01..05 satisfied for balls/extras, strike, over completion and deterministic replay, with the logged partial R-05 sequencing clarification. Inputs are frozen in an immutability regression; malformed extras, wrong players/attempts, and replay errors are covered. No implementation commit created per user instruction.

## 2026-10-08 · C03 · Gates passed

G-core: 48 files, 866 tests passed (67 delivery tests); typecheck and lint passed. A-C03-01..04 satisfied: all ten wicket kinds, bowler credit, wide/no-ball/free-hit restrictions, disabled LBW, new-batter gating, run-out ends/completed runs, hurt/resume and retired-out semantics. Unknown fielders, invalid pins and second-wicket shapes are refused. No implementation commit created.

## 2026-10-08 · C04 · Gates passed

G-core: 48 files, 877 tests passed (78 delivery tests); typecheck and lint passed. A-C04-01..04 and full R-05 satisfied: consecutive-over and quota refusals, mid-over figure splits, persistent free hits, current and queued penalty runs without player credit. Style values are validated through the canonical hand tuple and cricket pack bowling vocabulary. No implementation commit created.

## 2026-10-08 · C05 · Astra contract amendment: tie setting snapshot

As explicitly authorized by the architect review, E-2 `match_started` gains optional `superOverTie?: SeasonScoringRules["superOverTie"]`, and S-2 `MatchState` gains the required setting defaulted to `"another"`. This makes boundary-count versus repeated super-over outcomes deterministic from the event log. The start API will snapshot the season setting; a restarted attempt must reuse that original snapshot, not mutable season settings. C05 tests must cover both options, invalid values, replay and restart preservation (restart execution arrives in C06).

Further Astra authorization at C05: `BallPayload.nonStrikerId` and `innings_started.nonStrikerId` become `string | null`, with null allowed by state validation only for a lone remaining batter under lastManStands. `innings_started.inningsNo` becomes a positive safe integer, constrained to the exact scheduled next number. R-19 schedules a pair in pending metadata; explicit `innings_started` events select openers/bowler and consume that pair in order. This supports repeated super overs (innings 5–6+) without skeletal/unstarted innings contaminating results. No further super-over start is allowed while a pair is pending, and no result is exposed until both are completed.

## 2026-10-08 · C05 · Gates passed

G-core: 48 files, 894 tests passed (95 delivery tests); typecheck and lint passed. A-C05-01..06 satisfied for closures, penalty-inclusive targets, revisions, super-over pairs/repeats/boundary count, last man stands and retirement prompts. Ordinary-null and unscheduled/skipped starts are refused. R-21 player-line exclusion remains assigned to C08, and the restart preservation test for the authorized tie-setting amendment is assigned to C06. No implementation commit created.

## 2026-10-08 · C06 · Astra correction and restart resolution

Astra authorizes internal readonly raw `eventHistory` on MatchState, retained across restart and excluded from the public projection. Ordinary transitions live in `transition.ts`; the apply wrapper replays corrections without an import cycle. Restart validates the preceding attempt, advances exactly once, clears scoring, and preserves the original tie snapshot. Unexplained attempt jumps are refused. Amendments can target an earlier amendment and resolve to its original event; the latest valid payload wins. Voiding an original removes its amendment chain; voiding an amendment, future/missing/cross-attempt/already-voided targets, and correction of restart are refused. Changes to the immutable tie snapshot are refused. Raw accepted history supplies final sequence/time metadata; failed corrections leave input state unchanged.

## 2026-10-08 · C06 · Gates passed

G-core: 48 files, 903 tests passed (104 delivery tests); typecheck and lint passed. A-C06-01..06 satisfied: interruption/resumption, validated restart with old-attempt score removal and tie preservation, void refolding and later-event refusal, amendment payload/chain checks, substitutions, conditions snapshots, and derived-result-only finish. Implementation commits remain deferred per user instruction.

## 2026-10-08 · C07 · Astra sequencing and prompt clarification

Astra authorizes `ask_style` as a stable suggested action: identical state produces identical actions. One logical prompt exists per player and missing attribute. The scoring client must deduplicate presentation/dismissal using `(fixtureId, registrationId, what)`, persisted across refresh and restart; known styles remove suggestions. Viewing a prompt does not mutate core state or append a scoring event. Cross-device dismissal synchronization is outside this contract. Carry this requirement to the scorer UI steps.

Astra authorizes bringing the minimal English `commentary.ts` formatter forward into C07 so the public projection uses the specified C-6 templates without temporary duplicate wording. C08 still completes Hindi, all commentary snapshots, player lines and zones.

## 2026-10-08 · C07 · Gates passed

G-core: 48 files, 910 tests passed (111 delivery tests); typecheck and lint passed. A-C07-01..06 satisfied: preparation/live/result action ladders, ordered batter and least-recent bowler suggestions, stable style prompts, result wording, quota-sensitive NRR with super-over exclusion, exact situation/rate strings, and a full T20 public projection below 6 KB. No implementation commit created.

## 2026-10-08 · C08 · Gates passed

G-core: 49 files, 955 tests and 24 English/Hindi snapshots passed; typecheck and lint passed. A-C08-01..04 satisfied: batting/bowling/fielding lines, substitution appearances, full/un-charged/single-bowler maiden detection, dots, super-over exclusion, 12 commentary shapes in each language, and all eight zones round-trip for both hands. Snapshot text reviewed. No implementation commit created.

## 2026-10-08 · C09 · BLOCKED · Cricsheet umpire-miscounted overs

Preflight downloaded the required unmodified public archives:

- `https://cricsheet.org/downloads/t20s_json.zip`: 5,775 JSON matches; SHA-256 `3b35ddaaa2fd9ac914a640a8511389682f7f1ea3876b13f07f4416c7f9e987da`.
- `https://cricsheet.org/downloads/ipl_json.zip`: 1,243 JSON matches; SHA-256 `5757e04287179767ff8495f02902bd13812b9572ec8fa2ac1347ec2e9c6d4709`.
- Combined: 7,018 matches, comprising 6,967 JSON v1.2.0 and 51 v1.3.0. All requested special-fixture categories have candidates.

An independent scan counted legal deliveries directly from raw deliveries, excluding wides and no-balls, and checked every non-final over of each innings. 116/7,018 matches (1.6529%) contain a non-final over whose legal-delivery count differs from `info.balls_per_over`. 119/7,018 matches (1.6956%) explicitly declare `innings.miscounted_overs`; these categories overlap and must not be added together. Either unsupported-feature skip already exceeds the plan's maximum 0.5% before any other skips.

Representative evidence: `t20s:1161233.json` (2018-10-29, JSON v1.2.0) explicitly declares first-innings over 13 as seven balls, and the raw non-final over independently contains seven legal deliveries while `balls_per_over` is six. Further affected files include `t20s:1182646.json`, `t20s:1190605.json`, `t20s:1190744.json`, `t20s:1197398.json` and `t20s:1230857.json`. `t20s:1147717.json` explicitly declares a five-ball final over, illustrating why declared and non-final violation counts differ.

This contradicts C09 oracle assertion 3 (all non-final overs contain exactly `balls_per_over`) and the local-full-run skip limit. The fold's fixed over boundaries also govern strike changes, bowler changes and innings limits, so changing the assertion alone does not resolve it.

Astra reviewed the measured evidence and explicitly ruled C09 BLOCKED. It does not authorize silently normalizing deliveries, removing affected matches from the denominator, increasing the skip threshold, or claiming partial oracle checks as full passes. A separately specified architecture amendment must add source-backed umpire-adjudicated over lengths, separate actual legal-delivery counts from officially completed overs, and update strike/bowler/innings-limit/export behavior and regression expectations. This spans earlier scoring-model steps and cannot be introduced as an incidental C09 importer workaround.

C09 implementation has not started; no C09 acceptance IDs are complete. C00–C08 work is preserved. Implementation remains uncommitted under the user's final-commit instruction. This blocker log alone is committed under README §6 with subject `docs(ls1): blocked at C09`. No PR was created, pushed or merged. Execution stops pending the architecture amendment.

For resumption, Astra's preliminary C09 normalization guidance remains conditional on resolving this blocker: source-backed player/role replacements only; historical crossed-catch/run-out swaps require independent source transitions and mutation tests, never blanket alignment after a failed oracle; explicit targets must preserve documented timing; round trips compare a documented canonical domain-state projection excluding generated identifiers/timestamps/history while preserving all representable cricket state. Record normalization counts separately from skip counts.

## 2026-10-08 · C09 · RESOLVED by explicit user-authorized Astra amendment

The user explicitly instructed: "keep going - use astra to resolve and move forward" after the C09 stop. Astra now authorizes an additive architecture amendment, preserving the 0.5% skip limit and unmodified source fixtures. `innings_started.miscountedOvers?: Record<string, number>` snapshots explicit zero-based official over declarations; canonical safe-integer keys, positive safe-integer counts, and no redundant normal-count entries. State adds copied declarations, `completedOvers` and `ballsInOver`; `legalBalls` remains actual legal deliveries. Every over boundary uses the declared/default count, including strike changes, bowler selection and maidens.

`maxBalls` retains normal format units. An actual-delivery limit is computed by adding declared-length differences for full scheduled overs; a partial final-over limit cannot exceed that over's declared length. Exhaustion and balls remaining use this actual limit. Bowler quota counts distinct official overs in which the bowler participated; completing an already-started seven-ball over is allowed, and shared overs count for each bowler. Public innings overs use official completed overs and within-over balls. Bowler figures, rates, player statistics and NRR keep their explicit actual-delivery/quota inputs; no phantom deliveries are allocated.

C09 assertion 3 is amended to require declared counts for completed exceptional overs and default counts otherwise; incomplete final overs may contain fewer. Import must independently verify declarations against raw data; unexplained discrepancies fail. Export and canonical round-trip preserve declarations, over groupings and separate counters. Corrections refold all boundaries and reject invalid later play. Required regressions include five/seven-ball overs, illegal extras, final limits, quota completion, maidens, round trips, boundary-changing corrections and mutation failure after removing a necessary declaration.

The earlier BLOCKED decision remains historical evidence; this explicit amendment resolves it. Execution resumes at C09, without changing later step order. A narrow Prettier ignore preserves the required fixture bytes. Curation selected 60 files in deterministic criterion order; source bytes are restored directly from the archives after formatting.

## 2026-10-08 · C09 · Further Astra source-domain amendments

Astra authorizes source-backed rain closure: if a D/L first innings remains open and a following innings exists, append a terminal `revise` using the observed official over endpoint in normal format units, after verifying conversion equals actual deliveries. This records the effective limit without claiming interruption timing. A final D/L target that would prematurely end the recorded chase may instead be applied after its last recorded delivery, provided the unrevised fold remains valid. No intermediate targets are invented.

Round-trip equality is explicitly scoped to the supported Cricsheet import domain. It preserves identities, lineups, ordered scoring deliveries and participants, official over grouping/declarations/counters, wickets/fielders, supported retirements/replacements, effective targets/limits, totals/player figures and result. It excludes raw envelopes/history/timestamps and LS-1-only conditions/styles/consent/trust/prompts/native-format options absent from this source format. Exports use actual Cricsheet schema, with no hidden serialized state or event stream. Arbitrary native LS-1 matches are not promised lossless export.

Further additive E-3 amendments: optional `extras.noBallRuns` with `noBall:true` supplies the delivery's total no-ball extras, at least the format base, with surplus affecting physical-run parity and run-out completed-run validation. Run-outs allow distinct assistants up to fielding-side size; other dismissals keep a one-fielder ceiling. Optional `wicket.substituteFielderIds` is a distinct subset of `fielderIds` registered in the fielding substitutes list. Explicit temporary substitutes get fielding credit without batting/bowling eligibility. Source markers and amounts survive export; no permanent match substitution is fabricated for temporary fielding.

After inspecting additional raw evidence, Astra explicitly supersedes its earlier ban on ordinary-delivery end adjustments. The entire reconstruction plan is precomputed independently from source before any fold. Resolve source-backed entries, retirements and replacements, then infer a single unconditional `strike_swapped` only for the exact reversal of the same two distinct players. Record match/innings/delivery, predicted/observed pairs, preceding source delivery and reason `unrepresented_end_change`. These are inferred end adjustments, not proven umpire actions. Do not repair unresolved identities, over counts or bowling eligibility. Assertion 2 now checks that the fold follows the reconstructed sequence including these auditable actions; it does not claim every raw transition follows ordinary rotation unaided. Mutation regressions must fail for broken ordinary/over-end rotation on adjusted and unadjusted segments, and for omitted/duplicated inferred swaps.

Curation is now the first eligible matching source files in deterministic order, preserving all quotas and original bytes. Exclusions are published in NOTICE and still counted in the full denominator. Source-only preflight after handling explicit batter role replacements: 7,018 matches, zero preflight failures, two exclusions (0.0285%): `1298152.json` unexplained seven-delivery over without a declaration; `1418184.json` unrepresented mid-over bowler change. 4,939 matches require 15,117 inferred end adjustments, including historical crossed-wicket transitions. These are preflight measurements only, not a full oracle pass. The earlier preliminary 725-match strike count did not include all reconstruction transitions; source `1150554.json` is dated 2018-11-22, correcting the preliminary review note.

## 2026-10-08 · C09 · Astra unavailable-player and source-closure resolution

The first complete oracle run reported 7,018 total, 6,613 passes, 403 failures and two source-only exclusions (0.0285%). This was a failed gate; C09 remains active. Astra authorizes terminal manual first-innings limit revision only where the observed official endpoint exactly equals the following innings' explicit reduced target overs and is below the original quota. D/L source-backed closure remains as previously approved.

Optional `innings_started.absentBatterIds` snapshots distinct batting-team identities listed in source `absent_hurt`, excluding both opening batters. These players have no manufactured batting statistics or wickets and cannot enter or be suggested. They and recorded retired-hurt players are excluded from immediately available batters when determining `no_more_batters`; last-man-standing rules remain applicable. Export and canonical comparison retain absent identities. A source absent identity that actually bats requires investigation.

Optional positive safe-integer `wicket.unknownFielderCount` preserves explicit anonymous source fielders. Known plus unknown cardinality observes dismissal/side limits. No identity or personal credit is fabricated; run-out direct/assisted attribution uses the total participant count. Export writes `{unknown:true}` markers. First-delivery match substitutions determining opening participants now precede `innings_started`, an importer ordering correction. Historical free-hit discrepancies remain failures pending evidence and an additional focused resolution; the skip limit is unchanged.

## 2026-10-08 · C09 · Astra historical profiles and reconstruction timing

Astra authorizes source-only `historical_free_hit_unresolved`: source dated through 2014, a no-ball without subtype, then a dismissal whose validity depends on unresolved free-hit status before a legal delivery clears it. This is corpus-wide preflight, never an ID allowlist or a fold-error fallback. Evidence retains date, triggering no-ball and dismissal. Historical ICC men's and women's conditions distinguish foot-fault no-balls; the 2015 men's change is not a universal women's/IPL cutoff. References: https://images.icc-cricket.com/image/upload/prd/webeladxgaykq4opb6yi.pdf ; https://images.icc-cricket.com/image/upload/prd/znuhyzqswlgae4s54cjb.pdf ; https://www.icc-cricket.com/news/new-playing-conditions-come-into-effect . Source-only quota and consecutive-over exclusions enumerate participant and official over indexes, counting split overs. The third full oracle found 26 unique exclusions (including 18 historical ambiguities) and 58 remaining failures; it did not pass.

Astra authorizes explicit match replacements at the earlier of recorded position and incoming player's first batting/bowling participation, excluding temporary fielding. Outgoing last participation must precede that position; contradictory overlaps fail. The source normalization ledger records recorded/inferred positions. It applies once. Anonymous `{substitute:true}` fielders without names normalize to unknown participants; their anonymous substitute designation is outside the scoring projection.

`resume_batting` may reopen only the latest/current innings provisionally closed `no_more_batters`, for a recorded retired-hurt player and an empty end. Reject after finish, abandonment/walkover, any later innings, target attainment, exhausted quota or wicket limit. Recompute closure and phase; repeated returns are rejected. Regression covers permitted return and all exclusions.

Source records followed by the opposing innings may normalize terminal quota to the observed official endpoint when source wickets, availability, target and quota establish no natural closure. The decision is planned entirely from raw data before folding; relevant missing-delivery metadata rejects inference. Record `observed_innings_endpoint`, with DLS only when explicit and manual otherwise; no target or interruption time is invented. Export preserves DLS even for ties/no-result outcomes. A final DLS revision also waits until the last source delivery when installing its quota earlier would reject recorded final illegal extras. Aggregate source penalties of ten normalize to two statutory five-run events.

A corpus-wide `ambiguous_cross_team_registry_identity` predicate rejects one registry identity listed on both teams, as in `1229824`. No identities are invented. Skip allowance remains 0.5%; remaining source outcome and dismissal discrepancies are under focused Astra review, not silently excluded.


## 2026-10-09 · C09 · BLOCKED

What the plan says: the pinned full Cricsheet oracle must have zero execution failures and at most 0.5% unique excluded matches before C09 can pass. At 7,018 matches, at most 35 exclusions are allowed. Section 6 requires committing this log alone and stopping when the gate cannot pass.

What the repo has: Astra-authorized corpus-wide source-only preflight in `packages/core/src/scoring/delivery/cricsheet.ts` reports **7,018 total, zero preflight execution failures, 40 unique exclusions (0.569963%)**. Both original pinned archives and the original denominator are unchanged. This is a source-only preflight result, not 6,978 full scoring passes and not a successful C09 gate. The most recent full scoring run before the final focused fixes still had 27 failures and 27 exclusions; no claim is made that all remaining execution failures are resolved.

Reproduction: `node scripts/cricsheet-oracle.mjs --zip /tmp/ls1-t20s_json.zip --ipl /tmp/ls1-ipl_json.zip --preflight --report /tmp/ls1-definitive-preflight.json`. The command exits 1 because the exclusion ceiling fails. Audit output also lives in `/tmp/ls1-definitive-preflight.log`.

| Source-only exclusion | Count | Match files |
| --- | ---: | --- |
| `historical_free_hit_unresolved` | 17 | `335990.json`, `336002.json`, `419137.json`, `501248.json`, `548317.json`, `548348.json`, `598045.json`, `729299.json`, `306991.json`, `366707.json`, `412698.json`, `489212.json`, `533293.json`, `660185.json`, `682995.json`, `683015.json`, `718465.json` |
| `bowling_quota_outside_supported_profile` | 5 | `1179017.json`, `1267304.json`, `1419932.json`, `1490882.json`, `1499795.json` |
| `ambiguous_cross_team_registry_identity` | 1 | `1229824.json` |
| `awarded_result_unsupported` | 4 | `1268191.json`, `1273144.json`, `1407719.json`, `1544610.json` |
| `consecutive_overs_outside_supported_profile` | 2 | `1283040.json`, `1318396.json` |
| `unexplained_over_length` | 1 | `1298152.json` |
| `unrepresented_mid_over_bowler` | 1 | `1418184.json` |
| `source_outcome_tally_conflict` | 6 | `1457218.json`, `1491604.json`, `1494140.json`, `1495657.json`, `1506668.json`, `1536405.json` |
| `multiple_delivery_dismissals_unsupported` | 1 | `1535418.json` |
| `non_delivery_dismissal_unsupported` | 1 | `1536623.json` |
| `incompatible_wide_batter_runs` | 1 | `423788.json` |

All six ordinary result conflicts independently include pre/post penalties and exclude retired-hurt/non-dismissal retirements. Explicit manual targets alone do not imply a contradiction; only conflicting declared result margins are classified. In particular, no-result matches with revised targets remain eligible. Raw totals/targets/dismissals and the declared outcome are recorded in each exclusion's evidence. The unreconciled DLS result `1507719` remains a full-oracle failure, not an invented revised target or silently accepted result.

Astra's final resolution explicitly authorizes deduplicating named fielding registry identities and expanding source retirement batches into existing `new_batter`/`retire` events without deliveries or balls faced. Regressions cover those changes, anonymous attribution, source-only endpoint planning and guarded retired-hurt reopening. Core verification: **50 files, 1,035 tests passed**, typecheck and lint passed. The curated 60 source fixtures retain their unmodified source bytes. C09 remains incomplete; C10–C56 have not started.

Smallest change that would satisfy the plan's intent: a separately specified architecture amendment to the dataset or acceptance contract, supported by this audit. Raising the ceiling, shrinking the denominator, replacing the pinned corpus, or treating excluded assertions as passes is not authorized. Astra expressly instructed: if the definitive count is 36 or more, log/commit the blocker and stop before C10.

All implementation work remains uncommitted and preserved as requested. Only this log is committed for the mandatory blocker record. No PR, push or merge. The heartbeat must remain quiet while unchanged and must not retry this gate or call Astra again for the unchanged issue. Resume only after a specific architecture amendment.
