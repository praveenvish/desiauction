# LS-1 · 04 · Validation matrix

The executor ticks these in the PR body. The architect re-checks every line after the PR is complete, using the method given per row.

**Verdicts per ID:**
- ✅ done as specified;
- ⚠️ done with a logged deviation the architect accepts;
- ❌ missing or wrong, which blocks merge.

---

## 0. PR body template (paste at C00, keep updated)

```markdown
## LS-1: live scoring, stats and awards
Plan: docs/product/LS-1/exec/ (00-README → 04-validation). Product: docs/product/LS-1/FINAL.md.
Branch: feat/ls1-live-scoring · Base: main @ <sha>

### Progress
- [ ] M0 kickoff (C00)
- [ ] M1 core (C01–C12) ★
- [ ] M2 data (C13–C15) ★
- [ ] M3 backend (C16–C22) ★
- [ ] M4 scorer app (C23–C28) ★
- [ ] M5 watching live (C29–C34) ★
- [ ] M6 results/awards/careers (C35–C37) ★
- [ ] M7 trust (C38–C39) ★
- [ ] M8 modes (C40–C41) ★
- [ ] M9 insights/broadcast/scale (C42–C44) ★
- [ ] M10 launch (C45–C46) ★
- [ ] M11 rally + kabaddi (C47–C51) ★
- [ ] M12 timed + placement (C52–C56) ★

### Acceptance (tick as satisfied; see 04-validation.md)
<paste §2 IDs as a checklist>

### Deviations
<link to EXEC-LOG.md entries, or "none">

🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

---

## 1. Cross-cutting checks (run at the end, on the final branch head)

| ID | Check | Method |
|---|---|---|
| X-01 | Commit list matches the plan | `git log --format=%s origin/main..feat/ls1-live-scoring`: subjects equal the plan's Subject lines in order. Extra commits are allowed only for `chore(ls1): merge main` and `docs(ls1): blocked at …` |
| X-02 | INV-01 core purity | `pnpm depcruise` green; `grep -rn "from \"zod\"" packages/core/src` is empty |
| X-03 | INV-02 packs are values | `pack-contract.test.ts` green, and the packs contain `scoring:` blocks |
| X-04 | INV-03/04 RLS and append-only | `grants:verify`, `rls:verify` and `posture:verify` green. `APPEND_ONLY` includes `match_events` and `match_awards`. SQL check: `select relname, relforcerowsecurity from pg_class where relname in (<all new tables>)` is all true, except `player_previous_careers` (person-scoped by design) |
| X-05 | INV-05 posture ratchet | `pnpm check:posture` green. New allowlist entries are only `server/scoring/public.ts` and `server/scoring/today.ts` (if it reads across orgs; it should not), each with class `by-design` |
| X-06 | INV-07 engine untouched | `git diff --stat origin/main -- apps/engine` is empty |
| X-07 | INV-08 one fold | The pad (`use-match.ts`) and the server (`append.ts`) both import `replayMatch` from `@desiauction/core/scoring` |
| X-08 | INV-09 nothing destroyed | `grep -rn "delete(matchEvents\|delete(matches\|delete(matchAwards" apps/web/src` returns only test-support |
| X-09 | INV-10 result source | A regression test exists for the `scored_match` refusal |
| X-10 | INV-11 privacy | `public.regression.test.ts` scans the keys; the e2e live page has no `@` or `+91` text |
| X-11 | INV-12 both themes | `e2e/ls1-screens.spec.ts` screenshots exist for both themes; axe passes in both (`e2e/axe.ts`); no raw hex in new TSX/CSS except UI-3 (scan `apps/web/src/app/score`, `components/scoring`, `app/c/[slug]/m` for `#[0-9a-fA-F]{6}`) |
| X-12 | INV-13 notifications | `notification-guard.test.ts` green, with the 4+ new kinds present in the catalogue |
| X-13 | INV-14 copy | No "Successfully" and no `!` in new user-facing strings (scan the new TSX string literals) |
| X-14 | INV-15 dependencies | `git diff origin/main -- '**/package.json'` adds only `idb-keyval`, `qrcode` (+ `@types/qrcode` dev) and the new `apps/live` package's deps (copied from the engine set) |
| X-15 | Mockup fidelity | The architect compares the `ls1-screens` screenshots to the canvas boards (Scorer, Watch, Insights, Organiser, Both themes). Layout, hierarchy and copy must match; pixel-perfection is not required |
| X-16 | Performance | EXEC-LOG shows: pad tap → local update < 50 ms (A-C24-01); viewer sees a ball ≤ 3 s (A-C34-01); live-load p95 < 300 ms and 304 ratio > 80% (A-C34-03); `/score/[id]` route JS within budget (A-C24-04) |
| X-17 | Oracle | EXEC-LOG shows the Cricsheet oracle summary: 60 committed fixtures pass; the local full run has 0 failures and ≤ 0.5% skips (A-C09-02/04) |
| X-18 | Migrations | `check-journal.mjs` green; numbering is contiguous after main's last; every new table is in purge-org and the move-tournament function (D-8) |
| X-19 | CI | Every PR CI job green on the final head |
| X-20 | Competitor bar (product) | The architect runs the "60-second start" timing on a seeded season: from `/score` to the first ball recorded is ≤ 60 s for a person who knows the app (record it as a Playwright trace in the screens spec) |

---

## 2. Per-commit acceptance IDs

These are the meanings of the IDs referenced in `02-commits.md` and `03-sports-families.md`. Each must be provable by a named test, a command or a screenshot.

### M0–M1

| ID | Check |
|---|---|
| A-C00-01 | `EXEC-LOG.md` has the main sha and the migration check output |
| A-C00-02 | Draft PR open with the §0 template |
| A-C01-01 | `@desiauction/core/scoring` export resolves (a typecheck of a web import) |
| A-C01-02 | Cricket and box_cricket packs have `scoring`; pack-contract green |
| A-C01-03 | `FORMAT_PRESETS` values equal F-1 (test) |
| A-C01-04 | The `conditionsLine` example string is exact (test) |
| A-C02-01..05 | R-01..R-07 tests pass; extras accounting; over completion; strike rules; determinism test |
| A-C03-01 | Every WicketKind is covered by a test |
| A-C03-02 | R-11 extra/free-hit restrictions are tested |
| A-C03-03 | Retire hurt and resume; retire out counts as a wicket without a bowler |
| A-C03-04 | A ball before `new_batter` after a wicket is rejected |
| A-C04-01 | Consecutive-over refusal (not the first over) |
| A-C04-02 | Quota refusal |
| A-C04-03 | Mid-over bowler change splits figures |
| A-C04-04 | Free-hit persistence; penalty runs not charged to the bowler |
| A-C05-01 | All-out / overs / target closures |
| A-C05-02 | Target incl. penalty runs |
| A-C05-03 | Revise (overs + target) |
| A-C05-04 | Super over flow incl. repeat and boundary count |
| A-C05-05 | Last man stands |
| A-C05-06 | `retirePromptDue` flag for `retireAt` |
| A-C06-01 | Interrupt/resume |
| A-C06-02 | Restart ignores the old attempt |
| A-C06-03 | Void re-folds; void breaking later events is rejected |
| A-C06-04 | Amend works; type mismatch rejected |
| A-C06-05 | A substituted-out player cannot play |
| A-C06-06 | `finish` only with a derived result |
| A-C07-01 | NextAction for every phase |
| A-C07-02 | Bowler and batter suggestions |
| A-C07-03 | Result wording table |
| A-C07-04 | `nrr_balls` with both flag values |
| A-C07-05 | Situation strings exact |
| A-C07-06 | PublicLiveState < 6 KB for a full T20 |
| A-C08-01 | Player lines batting/bowling/fielding incl. maidens and dots |
| A-C08-02 | Super overs excluded from lines |
| A-C08-03 | Commentary snapshots en/hi |
| A-C08-04 | Zone round-trip for both hands |
| A-C09-01..04 | See C09: fixtures + NOTICE; 6 assertion classes; nightly pinned; full-run summary |
| A-C10-01 | All-out quota flag |
| A-C10-02 | No-result exclusion flag |
| A-C10-03 | Legacy fallback; old tests unchanged |
| A-C11-01 | The mockup example gives exactly 127.6 with the same lines |
| A-C11-02 | PoM winning-side swap |
| A-C11-03 | Fighter rules |
| A-C11-04 | Deterministic tiebreaks and qualification |
| A-C12-01 | T-1 branches |
| A-C12-02 | Pace: live vs backfill |
| A-C12-03 | Personal org never verified |

### M2–M3

| ID | Check |
|---|---|
| A-C13-01..05 | See C13 |
| A-C14-01 | 0113/0114 applied; journal OK |
| A-C14-02 | `team_managers` person arm (own rows only) |
| A-C14-03 | `fixture_officials` tenant |
| A-C14-04 | Grants CHECK accepts `fixture:scorer` and still rejects others |
| A-C14-05 | `fixture_results.source` default `typed` |
| A-C14-06 | New seasons get `NEW_SEASON_SCORING_RULES`; legacy rows backfilled false |
| A-C15-01 | Move-tournament posture test asserts all 5 tables moved |
| A-C16-01 | `mayScore` arm (a) |
| A-C16-02 | `mayScore` arm (b) |
| A-C16-03 | `mayScore` arms (c), (d) |
| A-C16-04 | Revoked grants/managers refused; auction owners synced idempotently |
| A-C17-01 | Start creates the match and seq 1..3 |
| A-C17-02 | A non-approved registration is refused |
| A-C17-03 | A draft fixture is refused |
| A-C17-04 | Idempotent restart from the same device |
| A-C17-05 | A claim held by another person is refused |
| A-C18-01 | Batch-size invariance (1/7/50) |
| A-C18-02 | Duplicate `event_id` |
| A-C18-03 | Reject + skip the rest of the batch |
| A-C18-04 | Non-holder forbidden |
| A-C18-05 | Rate limit |
| A-C18-06 | Edit window rules |
| A-C18-07 | live_state seq equals last_seq |
| A-C18-08 | Delay ring buffer present |
| A-C19-01..05 | Resume; clean claim; force timing; organiser force; token expiry/reuse |
| A-C20-01..03 | Guest registration; style fills null only; audit |
| A-C21-01 | Scored result `source=scored` + `nrr_balls` |
| A-C21-02 | Standings use the new NRR per season rules |
| A-C21-03 | Typed result refused on a scored match |
| A-C21-04 | Re-finalize after amend |
| A-C22-01 | finished → final |
| A-C22-02 | Stalled after 6 h |
| A-C22-03 | `match.quiet` deduped |
| A-C22-04 | Notification guard green |

### M4 (screens are compared to mockups in both themes)

| ID | Check |
|---|---|
| A-C23-01..04 | See C23 |
| A-C24-01..05 | See C24 (the timing number in the log) |
| A-C25-01 | Sheets match mockups ×2 themes |
| A-C25-02 | Shot sheet auto-closes in 5 s and honours reduced motion |
| A-C25-03 | LHB mirror and note |
| A-C25-04 | Illegal wicket kinds absent per state |
| A-C25-05 | The ball is stored before the shot amend |
| A-C25-06 | Hit targets ≥ 44 px (axe/target check) |
| A-C26-01 | Menu items per authority |
| A-C26-02 | Edit any ball via amend; rejection message |
| A-C26-03 | Restart and no-result confirmations |
| A-C26-04 | Finish sheet + next match |
| A-C26-05 | Theme toggle persists |
| A-C27-01..05 | See C27 |
| A-C28-01 | Full T10 e2e |
| A-C28-02 | Offline e2e |
| A-C28-03 | Handover e2e |
| A-C28-04 | Both-themes axe e2e |

### M5–M6

| ID | Check |
|---|---|
| A-C29-01..06 | Gate 404/200/token; ETag 304; delay by trust; privacy scan; minors initials |
| A-C30-01 | SSR first paint shows the score with JS disabled |
| A-C30-02 | Poll cadence 2 s / 15 s / stop |
| A-C30-03 | Stale state after 60 s |
| A-C30-04 | Reconnecting banner after 2 failures |
| A-C30-05 | Result in place, both themes |
| A-C30-06 | `noindex` on `/m/[token]` |
| A-C31-01..04 | Wagon (batter pills + All), worm, Manhattan, table link, keyboard focus, tokens in both themes |
| A-C32-01..03 | OG/Twitter images render the live score; view ping throttled; `revalidate = 15` |
| A-C33-01..04 | Problems first; one action per row; live progress; phone scroll |
| A-C34-01 | Viewer sees each ball ≤ 3 s |
| A-C34-02 | Stale/reconnect e2e |
| A-C34-03 | Load numbers logged and within target |
| A-C35-01 | Lines sum to the scorecard |
| A-C35-02 | Auto awards written |
| A-C35-03 | Override appends; computed pick kept and shown |
| A-C35-04 | Non-organiser refused |
| A-C35-05 | `match_awards` append-only |
| A-C36-01 | Result panel matches the mockup |
| A-C36-02 | Result poster renders in every theme and size |
| A-C36-03 | Poster gate |
| A-C36-04 | `match.result` + `match.award` notifications with dedupe keys |
| A-C36-05 | WhatsApp template registered, switchable off |
| A-C37-01 | Career by format and ball type |
| A-C37-02 | Super over excluded |
| A-C37-03 | Trust labels per match |
| A-C37-04 | Previous-career block labelled and excluded from boards |
| A-C37-05 | Person scoping of previous career |

### M7–M10

| ID | Check |
|---|---|
| A-C38-01 | Trust transitions written at finalize |
| A-C38-02 | Confirmation page manager-only |
| A-C38-03 | Dispute flags |
| A-C38-04 | `match.confirm_request` sent only for authority (d) |
| A-C38-05 | Moderation list + actions via platform-ops |
| A-C38-06 | Depcruise green |
| A-C39-01..04 | Guest claim keeps stats; minors initials on live/poster/OG; adults full |
| A-C40-01 | Personal org created once |
| A-C40-02 | Hidden from listings |
| A-C40-03 | Admin counts separate |
| A-C40-04 | `rolesOf` not organiser |
| A-C40-05 | Share page signed-out |
| A-C40-06 | Never verified |
| A-C41-01 | Formation question at season creation |
| A-C41-02 | Auction tab hidden |
| A-C41-03 | Stage logic |
| A-C41-04 | Entry code |
| A-C41-05 | Approve creates team/registrations/manager |
| A-C41-06 | e2e team-entry green + fixtures/multi-sport regression |
| A-C42-01 | `ball_facts` written at finalize |
| A-C42-02 | Batter insights numbers match a hand fixture |
| A-C42-03 | Bowler insights |
| A-C42-04 | Small-sample flag |
| A-C42-05 | Leaderboards T-3 + qualification + tiebreaks |
| A-C42-06 | Season awards |
| A-C42-07 | Matchup hint ≥ 60 balls only; minors private |
| A-C43-01 | Entitlement single source |
| A-C43-02 | Locked brief preview without data |
| A-C43-03 | Overlay transparent with stings and STAT |
| A-C43-04 | Sponsor slot |
| A-C43-05 | Board route |
| A-C44-01 | `apps/live` builds and its tests pass |
| A-C44-02 | `pg_notify` in the append transaction |
| A-C44-03 | Gate + delay shared with API-9 (one core function) |
| A-C44-04 | Deploy wiring (CI image, deploy loop, compose, Caddy `/live/*`, preflight) |
| A-C44-05 | Polling fallback still works when the WS env is unset |
| A-C44-06 | healthz/readyz |
| A-C45-01 | assetlinks route (404 when unset) |
| A-C45-02 | Middleware excludes `.well-known` |
| A-C45-03 | TWA.md |
| A-C45-04 | Terms paragraph + install prompt |
| A-C46-01 | G-full green |
| A-C46-02 | Screens captured both themes |
| A-C46-03 | EXEC-LOG final summary |
| A-C46-04 | FINAL.md "As built" |

### M11–M12

| ID | Check |
|---|---|
| A-C47-01..03 | Engine registry; cricket unchanged; unsupported-sport message |
| A-C48-01..05 | RR rules tests incl. deuce cap, TT serve at deuce, pickleball side-out, volleyball 5th set, early-stopped tie |
| A-C49-01..04 | Rally pad + live panel + e2e + volume-key toggle shown only when supported |
| A-C50-01..05 | KR-01..KR-08 tests incl. revival FIFO, all-out, super tackle, do-or-die, bonus line |
| A-C51-01..04 | Kabaddi pad (mat view, timers) + panel + awards + e2e |
| A-C52-01..04 | Timed rules incl. shootout and score units |
| A-C53-01..04 | Timed pad + panel + football/basketball awards + e2e |
| A-C54-01..03 | Lobby rounds fold + finalize parity with `recordLobbyResult` + top fragger |
| A-C55-01 | Families e2e both themes + axe |
| A-C56-01 | G-full + logs |

---

## 3. How the architect validates (for the record)

1. Read `EXEC-LOG.md` end to end: every BLOCKED and NOTE entry must have a resolution.
2. Run X-01..X-20 on a fresh checkout of the PR head (fresh DB, roles applied).
3. For each A-ID, open the named test or file, or the screenshot, and mark ✅ / ⚠️ / ❌. A ❌ becomes a review comment on the exact line, with the plan reference.
4. Spot-check the domain: replay 5 random Cricsheet matches outside the committed 60 through `replayMatch` and compare scorecards by hand.
5. Product walk-through on the precompiled build, both themes, phone viewport. Score a full T10 including the shot map, a wicket with a pin, an over-end matchup hint (after C42), finish, poster and live page from a second device.
6. Verdict: **merge**, **fix list**, or **re-plan** (only if the plan itself was wrong; the plan is amended in a new commit before more code).
