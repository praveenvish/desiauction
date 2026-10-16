# LS-1 · Brainstorm 2: every angle

Written 2026-10-08, after the founder's follow-up. It covers these points:

- Teams that want **only scoring** (no auction).
- A **clear next action** on every screen.
- **Beating CricHeroes on UI and UX**, smoothness and speed.
- **Real-time updates.**
- **Easy to extend.**
- **Abandoned and restarted matches**, and every other match situation.
- **No dummy scores**, with full detection.
- **No commitment to free.**

This document extends [PLAN.md](PLAN.md); where they disagree, this one wins.

---

## 1. Three ways in, and the auction is only one of them

Today the product journey is auction-first: club → season → registration → auction → teams → matches. The data already allows more. `assignTeam` places players without an auction, and `auction_source = imported` exists. But the screens, the navigation and onboarding all assume an auction. CricHeroes' biggest volume is the **one-off match between two local teams**, which we cannot do at all today.

| Mode | Who | What they do | What they never see |
|---|---|---|---|
| **A. Quick match** | Two teams on a Sunday, a gully game, a corporate friendly | "Score a match" → pick or type two teams → players → toss → score. Done in 60 s | Clubs, seasons, registration, auction, money |
| **B. Tournament without auction** | A league where teams already exist (corporate cups, school leagues, most cricket tournaments in India) | Create tournament → teams join by link or code (or the organiser adds them) → captains add their own squads → fixtures → score | Auction, pool, purses |
| **C. Auction season** (today) | Premier-league style clubs | As today, plus live scoring after the auction | — |

### 1.1 How it fits the data (no fork)

- **Every match is still a `fixture` inside a `competition`.** One model means one set of standings, stats, awards and posters.
  - **Quick match:** the match sits in an automatic, hidden "Friendlies" competition owned by the team (or the person) that started it. The user never sees the word "season".
  - **Without auction:** the competition gets `team_formation: auction | organiser | team_entry`. Navigation, readiness, the season road and home all read this field and **simply hide** auction surfaces when it is not `auction`. This is the same pattern as `auction_source`, one level up.
- **Persistent teams.** `franchises` already exist as "the team that outlives a season". A quick-match team *is* a franchise with a roster. When that team later enters a tournament, it brings its players and its history. This is how CricHeroes keeps teams sticky.
- **Team entry** (mode B): the organiser shares one link or a 6-digit code. A captain opens it, names the team, adds players (from contacts, or names + phones), and submits. The organiser approves. This reuses registration's approve/decline machinery, applied to a *team* instead of a player.
- **Who owns a quick-match team without a club?** A person-level owner. Today every org-scoped thing needs an org. Options:
  1. auto-create a hidden personal org per person (no schema change, a little invisible weirdness);
  2. make franchises person-ownable.

  **Recommendation: (1) now, (2) only if it hurts.** This is a founder decision (§10).

### 1.2 Entry points

- **The `/home` hero for a new user** offers two big cards: "Score a match now" and "Run a tournament". The auction becomes a choice *inside* "Run a tournament": "How will teams be formed? Auction · I'll assign · Teams sign up".
- **A public "Score a match" button** on the landing page leads to the fastest path to a live scorecard, with login at the last possible moment (just before the first ball, so the match has an owner).
- **Shortcuts:** PWA manifest shortcut "Score a match", and a WhatsApp deep link.

---

## 2. Next action everywhere: one obvious thing to do

We already have the pieces: the HeroNext pattern, the Readiness Center, the season road and numbered steps. LS-1 extends them to the match. Rule: **every match screen shows exactly one primary button, and it is always the right next step.**

### 2.1 The match's next-step ladder (derived from state, never stored)

| Match state | Primary action shown | Who sees it |
|---|---|---|
| Scheduled, no XI | **Pick your XI** (per team) | Team owner/captain, organiser |
| XIs picked, before start time | **Start match** (toss next) | Scorer, organiser |
| Toss done | **Pick openers & bowler** | Scorer |
| Live | **(the pad itself)**; viewers get **Watch live** | Scorer / everyone |
| Innings break | **Start 2nd innings** (shows target) | Scorer |
| Interrupted | **Resume** or **Shorten match** or **Abandon** | Scorer / organiser |
| Result reached | **Finish match** (auto-prompted, see §5.4) | Scorer |
| Finished, edit window open | **Check scorecard** → **Confirm result** | Scorer, then the opposing captain |
| Final | **Share result** (poster + link) | Everyone |
| Awards ready | **See Player of the Match** | Everyone |

### 2.2 Organiser match-day board

- One screen titled "Today": every match today as a row, with a state chip (Not started / Live 87/3 / Innings break / Finished / Needs confirm / Problem) and **that row's one next action**.
- Problems float to the top: no XI an hour before, scorer not assigned, a live match with no ball in 15 min, unconfirmed result.
- This is the organiser's "is everything OK?" screen. It reuses the stat-row and needs-you band patterns.

### 2.3 Copy rules

- Write sentences, not states. Write "Strikers need 65 off 50 balls", not "Target: 152".
- Write "Pick the next bowler, Karan can't bowl twice in a row", not a disabled button with no reason.
- Every empty state says what will appear and what to do now.
- Write Hindi copy alongside English from day one. The scorer pad matters most here: scorers at the ground skew Hindi-first.

---

## 3. Beating them on UI and UX: concrete, measurable

CricHeroes is a mature product, but it is ad-heavy, menu-deep and slow to start. Where we win:

| Moment | CricHeroes today | Ours |
|---|---|---|
| Start a match | ~5 min: add teams, type players and phones | **<60 s**: teams and players already known, or quick-add by name |
| Record a ball | Run, then dialogs for extras or wicket types | **1 tap** for 80% of balls. Extras are toggles before the runs, so no dialog |
| Wicket | Several screens | **One bottom sheet**, showing only legal kinds; the next batter is preselected |
| Mistake | Undo the last ball only; deeper fixes go through settings | Undo toast on every tap, plus **tap any past ball → edit it**, then a replay checks everything after it |
| Ads | On screen switches | **None in the pad or on the live page**, whatever the pricing |
| Phone dies | Log in on a new phone → Resume | Same, plus queued balls that **never get lost** and a visible take-over |
| Watching | App required for the full experience | **A link** that works in WhatsApp's in-app browser, instantly, no install |

### 3.1 Pad design rules

- **Thumb zone:** all actions sit in the bottom 60% of the screen; the score lives at the top.
- **Buttons:** at least 64 px; run buttons fill the width.
- **Sunlight mode:** high contrast, auto when the ambient-light API is available, plus a manual toggle. Scorers sit outdoors at noon.
- **Feedback:** haptic on every recorded ball, plus a short visual "flash" of the ball result.
- **Screen lock:** the screen stays awake during scoring (Wake Lock API).
- **Landscape mode** for tablets: pad on the right, scorecard on the left.
- **Voice readout** (optional): "Four. 91 for 3."
- **Never a spinner on the pad.** The tap is local (§4), so nothing to wait for.
- **Low-end Android:** a ₹8,000 phone on patchy 4G is the design target. Test on a throttled profile in CI (the Lighthouse-style budget is in §4.3).

### 3.2 Live page design rules

- The score is the first paint; the server-rendered HTML already has it.
- Updates animate gently. The `RollingNumber` from PREMIUM-1 rolls the score, and a four or six gets a short sting.
- No layout shift as balls arrive (fixed-height feed rows).
- "Last updated 3 s ago" sits next to the score, and turns amber after 60 s with no event: "Scorer may be offline". Honest beats fake-live.
- When the match ends, the page becomes the result page in place: same URL, no reload.

### 3.3 Process

The founder wants mockups (memory: founder-wants-mockups), so: a **mockup canvas first** for these screens, then build.

1. Score-a-match start
2. Pad
3. Wicket sheet
4. Over-end sheet
5. Interruption sheet
6. Live page (mobile + desktop)
7. Scorecard
8. Match-day board
9. Result poster
10. PoM card

---

## 4. Real-time and smooth loading

### 4.1 Write path (scorer)

- **Local-first.** A tap writes to IndexedDB and folds locally, so the screen updates in under 50 ms. Sync happens in the background.
- **Batching.** Events are sent in batches as they queue; online, that is usually one event per request. Each event carries a client ULID and `client_seq`, so retries are harmless.
- **Acks.** The server replies with an ack per event (with `seq`) or a rejection reason. The pad shows a tiny tick per ball: synced or pending.

### 4.2 Read path (viewers)

- **WS room per match.** On connect, the viewer gets the snapshot plus the last seq. After that, the server sends **deltas**: the new event plus the few changed summary fields (around 300 bytes). It does not resend the full snapshot every ball, which matters on 2G.
- **Gap repair.** A gap in seq means re-fetching events since the last seq. Coming back from the background means catching up the same way.
- **Fallbacks:**
  - **Polling** with ETag every 10 s, when WS is blocked (some corporate networks).
  - **Server-rendered first paint** from a cached read model, so the page is useful before JS loads.
- **Push:** web push for followers on wicket, milestone, innings break and result. WhatsApp only for the result, and only with opt-in (cost and consent rules already exist).

### 4.3 Budgets (enforced in CI where possible)

| Metric | Target |
|---|---|
| Tap → pad updated | < 50 ms (local) |
| Tap → viewer sees it | < 2 s p95 on 4G |
| Live page LCP (mid-range Android, 4G) | < 1.5 s |
| Pad JS (gzipped, route) | < 150 KB |
| Delta frame | < 1 KB |
| Live rooms on one engine machine | 1,000 matches / 50k viewers (`perf:scale` test in P3) |

If load outgrows one engine machine, matches shard across engine instances by `fixture_id` hash. The single-writer lock is already per-entity, so this is a config change, not a redesign. Plan for it, but don't build it until the numbers say so.

---

## 5. Every match situation

### 5.1 Match state machine

```
scheduled ─▶ toss ─▶ live ─▶ innings_break ─▶ live ─▶ result_reached ─▶ finished ─▶ final
                       │  ▲                                                  │
                       ▼  │                                                  ▼
                  interrupted ───▶ abandoned (no result)            corrected (audited)
                       │
                       └───▶ shortened (revised overs/target) ─▶ live
scheduled ─▶ walkover/forfeit ─▶ final
scheduled ─▶ called_off (no play) ─▶ final (no result) or rescheduled
any pre-final ─▶ restarted (new attempt, same fixture)
abandoned ─▶ replay (NEW fixture, linked `replay_of`)
```

### 5.2 Situation table: what happens to the score, the table, stats and awards

| Situation | How it's recorded | Standings | Player stats | Awards |
|---|---|---|---|---|
| **Rain or bad light, play stops** | `interrupt {reason}` event; clock paused; viewers see "Play stopped: rain" | — | — | — |
| **Overs reduced** | `revise {overs, target, method: "manual" \| "dls"}` | Uses revised figures; NRR uses DLS credit rules | Count | Normal |
| **Abandoned, no result** | `abandon {reason}` | The pack's `PointsPolicy` (e.g. 1 pt each); **excluded from NRR** | **Kept** (runs scored are real), flagged "in an abandoned match" | No PoM by default (organiser may give one) |
| **Abandoned, result by rule** (enough overs bowled) | `abandon` + `result {method:"dls"\|"rule"}` | Normal, with abandoned-NRR rule | Count | Normal |
| **Called off before a ball** | Fixture status `called_off`, no events | `no_result` points or nothing (season rule) | None | None |
| **Walkover / forfeit** | `walkover {winner, reason}`, no events | Win to the other side; NRR: defaulter charged full quota, winner's figures ignored (ICC) | None | None |
| **Tie** | Derived | Tie points | Count | Normal |
| **Super over** | `super_over_start` → mini innings pair; repeat if tied, or a boundary-count rule (format knob) | Winner by super over; **super over excluded from NRR** | **Excluded from career totals** by default (shown separately) | May count toward PoM (knob) |
| **Restart from scratch** ("we started wrong, begin again") | `restart {reason}` increments the `attempt` number. Old attempt's events kept, read-only, visible to organiser | Only the latest attempt counts | Old attempt **never** counts | Old attempt ignored |
| **Replay on another day** (after an abandonment) | Original → `abandoned`; new fixture with `replay_of` | Season rule: replay *replaces* the original (original excluded) or *adds* | Original stats kept as abandoned-match stats | From the replay |
| **Wrong teams / swapped batting order at start** | Correction event `swap_innings_teams` (allowed until the 1st over completes; later only via restart) | — | Re-folded | — |
| **Toss recorded wrong** | `amend` the toss event | — | — | — |
| **Wrong bowler or batter on a ball** | Tap the ball → edit → replay validates | — | Re-folded | Re-scored |
| **Player retires hurt, returns later** | `retire {hurt}` then `resume_batting` | — | Not out (no dismissal) | — |
| **Injury replacement / concussion / impact player** | `substitute {in, out, kind}` | — | Both get an appearance | Both eligible |
| **Late player added mid-match** | `add_player` (guest or person) | — | Normal | Normal |
| **Scorer forgot to finish** | Auto-detected (target reached, all out, overs done) → pad prompts "Finish?"; if ignored, auto-finish after 30 min | Normal | Normal | Normal |
| **Live match went silent** (no ball for 20 min, not interrupted) | Organiser gets a nudge; live page shows "scorer may be offline" | — | — | — |
| **Live match never finished** (no event for 6 h) | Becomes `stalled`; organiser must finish, abandon or restart. **Never counts while stalled** | Excluded | Excluded | None |
| **Two phones scoring the same match** | Impossible: the lease. Second phone gets "Ravi is scoring. Ask to take over?" | — | — | — |
| **Scorer's phone dies** | Take-over (clean or forced); unsynced balls quarantined, organiser can replay them | — | — | — |
| **Scored on paper, typed in later** | Allowed. "Backfill" mode enters balls fast after the match | Normal | Count, labelled "entered after the match" | Normal (trust tier lower, §6) |
| **Only the final score known** (no ball by ball) | Today's hand-typed result path, unchanged | Normal | No player stats | No PoM (or organiser picks) |
| **Dispute** | Organiser sets `under_review`; result hidden from the table until resolved | Excluded while under review | Held | Held |
| **Match deleted by mistake** | No hard delete after the first ball; `void_match` with reason, restorable | Excluded | Excluded | Removed |

**Principle:** nothing that happened is ever destroyed. Restart, void and correction add events; the fold decides what counts. That gives us both a clean scorecard and a full audit trail for disputes.

### 5.3 Season rules the organiser sets once (with sensible defaults)

- Points for win, tie, no result and abandoned (already in `PointsPolicy`).
- Replay replaces or adds.
- Super-over tie rule: another super over, or boundary count.
- Minimum overs for a result in a shortened match (e.g. 5 per side in T20).
- Walkover points and NRR treatment.
- Edit window length (default 24 h) and who confirms.

### 5.4 Auto-detection prompts on the pad (so scorers don't get it wrong)

- Target reached or passed → "Strikers win by 6 wickets. Finish match?"
- 10th wicket (or the format's last) → "All out. End innings?"
- Last ball of the overs → "Innings complete."
- Scores level at the end → "It's a tie. Super over?" (if the knob is on)
- Bowler reaches max overs → shown on the bowler chip: "Karan: last over".
- Odd entries, accepted but confirmed:
  - A 7 off one ball → "7 runs? (overthrows)".
  - Two wickets on one ball → "Sure? Two dismissals".

---

## 6. No dummy scores: trust and fraud detection

**Honest framing:** no system can prove a gully match happened. Our goal is that **fake stats are worthless**. They can live in someone's private history, but they never reach leaderboards, records, badges or awards beyond their own match. CricHeroes shows everything equally, which is why people fake.

### 6.1 Trust tier per match (shown on every scorecard)

| Tier | How a match earns it | Counts toward |
|---|---|---|
| **Verified** ✓ | Scored by an appointed neutral scorer or official in a published tournament, **or** organiser-verified after review | Everything: season, tournament, city and platform boards, records, badges |
| **Confirmed** | Scored by one side **and confirmed by the other side's captain/owner** (one tap in WhatsApp/push: "Confirm Strikers 152/6 beat Royals 140/9?") | Season and tournament boards, career, awards inside the competition |
| **Self-scored** | One side scored, the other did not confirm within 48 h | Personal career only (labelled), no boards, no badges |
| **Flagged** | Failed checks (§6.2) or reported | Hidden from everything except the organiser and admin until reviewed |

The opposing captain can **dispute** instead of confirming, which sends the match to the organiser.

### 6.2 Automatic checks (each one becomes a reason on the match's trust panel)

**Timing:**
- Balls entered faster than physically possible (e.g. 20 overs inside 10 min of wall clock) → "entered after the match" (allowed, labelled), not "live".
- Match "live" at a time that overlaps the same player's other live match.
- Match started far from the scheduled time, without a reschedule.

**People:**
- The same person in both XIs.
- A player in two matches at overlapping times.
- An XI made of guests created minutes before the match, with no verified players (a "phantom opponent").
- Duplicate profile signals: same phone, same name + DOB, same photo hash.

**Numbers:**
- Statistical outliers against the format's norms: a 100 off 20 balls in a leather T20, 8 wickets in 3 overs, a team strike rate 3σ above the platform norm for that format and ball type.
- One player taking a share of team runs or wickets that repeats implausibly across matches.

**Behaviour:**
- The scorer is the main beneficiary (the scorer = the player with the big score) on self-scored matches.
- A pattern of matches never watched live by anyone, never confirmed, always self-scored.
- Many matches against the same unverified opponent.

**Location** (opt-in, never required; DPDP consent):
- The scoring phone's coarse location vs the ground's city. Used only as a positive signal toward Verified, never as an accusation.

### 6.3 What happens

- Checks never delete anything. They lower the tier and add a reason.
- **Admin moderation queue** (the existing moderation surface): flagged matches with reasons. Actions: verify, keep flagged, exclude from boards, or warn/suspend the scorer account.
- **Player-facing:** "This match isn't counted on leaderboards because the other team hasn't confirmed it. Ask them to confirm." This turns integrity into a growth loop: the other team has to open the app.
- **Appeals:** the player or organiser can request a review.

### 6.4 Identity integrity (from PLAN §8.2, restated)

- One person = one profile (OTP-verified).
- Guests are claimable exactly once.
- Merges are audited and reversible.
- Records, badges and city/platform boards are open to **verified people in Verified or Confirmed matches only**.

---

## 7. Money: no "free" commitment, options for the founder

The founder said: **don't commit to free.** So pricing stays open. Below are the levers, so the decision can be made with the product in hand.

| Lever | Example | Notes |
|---|---|---|
| Per-tournament fee | ₹X per tournament for live scoring + live pages | Clear for organisers, matches how they already think (entry fees) |
| Organiser plan | Monthly/yearly: unlimited tournaments, branded overlays, analytics, exports | B2B, predictable |
| Per-match unlock | Live scoring is a quick-match add-on | Fits gully/friendlies. Price must be impulse-level |
| Viewer premium | Advanced charts, full history, follow alerts | GameChanger model (fans pay). Risky in India |
| Broadcast | Overlay themes, sponsor slot in ticker, board screen | Strong: organisers sell sponsors |
| White-label | Tournament's own domain/app look | High value, low volume |
| Posters / highlights | Premium themes, player cards | Impulse |

**Hard rules whatever the pricing:**
1. Never gate something that used to be free. CricHeroes' 2025 claw-back is the lesson.
2. A player's *own* scorecard is always viewable, even if analytics are paid.
3. No ads in the scoring pad.
4. Free trial or a free first tournament, so organisers try before paying.

Build a **plan/entitlement check** into LS-1 from P1 as a no-op (everything allowed), so turning on pricing later is a config change, not a rebuild.

---

## 8. Easy to extend

| Extension point | How it extends | Guard |
|---|---|---|
| **New sport** | New pack file (values) picking an existing family + format knobs + an award table | `pack-contract.test.ts` (no functions in packs, migration row exists) |
| **New family** (rare) | New folder `scoring/<family>/` implementing one interface: `validate(event, state)`, `apply(state, event)`, `nextActions(state)`, `stats(state)`, `isFinished(state)`, `result(state)`, plus a pad component and live-page components registered by family key | Family contract test + golden matches |
| **New event type** | Added to the family's event union with a payload `v` (version) | Old events re-read through **upcasters** (v1 → v2), never rewritten in the DB |
| **New format / house rule** | A knob on the format (values) that the family reads | Knob coverage test |
| **Award formula change** | New award-table version; seasons pin a version | Old seasons never re-rank |
| **Charts / overlays** | Registry keyed by family: `charts.delivery = [worm, manhattan, wagon]` | — |
| **Commentary** | Template files per family per language (en, hi, then more) | Missing-key test |
| **Integrations** | Webhooks on match events (for electronic scoreboards, PlayHQ-style) + Cricsheet export + a read API | Later; signed payloads |
| **Pricing** | Entitlement check at known points | No-op until switched on |

The one interface, `nextActions(state)`, drives **both** the pad buttons and the next-step ladder (§2). Clear next actions therefore come from the same code for every sport, not from hand-written screens.

---

## 9. Revised phases (replaces PLAN §11)

| Phase | Adds | Est. |
|---|---|---|
| **P0 Foundations** | Event log + attempts + upcasters; family interface; delivery fold; Cricsheet golden suite; entitlement no-op | 1.5 wk |
| **P1 Cricket pad (online)** | Start flow, pad, wicket/over sheets, undo/edit-any-ball, auto-detect prompts, finish → result → table | 2.5 wk |
| **P1b Scoring without auction** | `team_formation` on competitions; hide auction surfaces; **Quick match** (friendlies competition, persistent teams, personal org); **team entry by link/code** | 2 wk |
| **P2 Every situation + offline** | Interrupt/shorten/abandon/walkover/called-off/restart/replay/super over/stalled; season rules; IndexedDB queue; lease take-over; NRR fixes | 2.5 wk |
| **P3 Live for viewers** | Rooms + deltas, live page, charts, push, match-day board, overlay/board, load test | 2 wk |
| **P4 Stats + careers** | Projections, career splits, leaderboards with qualification | 1.5 wk |
| **P5 Awards** | PoM/Fighter/season awards with explanations, overrides, posters | 1.5 wk |
| **P6 Trust** | Tiers, opposing-captain confirm, automatic checks, moderation queue, guests → claim → merge, officials | 2.5 wk |
| **P7+ Other sports** | Rally → kabaddi → timed → placement (order from the demand gate) | 1.5–3 wk each |

**Cricket complete with no-auction mode, every situation and trust: about 16 weeks** (P0–P6). Mockups come first, for P1/P1b/P3 screens.

---

## 10. New founder decisions (add to PLAN §12)

1. **Quick-match team ownership:** hidden personal club per person (recommended), or person-owned teams?
2. **Team entry:** a captain adds their own squad via link (recommended), or only the organiser adds teams?
3. **Confirmation rule:** do matches need the other side's confirmation to count on boards? (Recommended: yes, 48 h.)
4. **Restart vs replay defaults:** a replay *replaces* the abandoned match in the table? (Recommended: yes.)
5. **Abandoned-match player stats** count in careers? (Recommended: yes, labelled.)
6. **Super-over stats** in career totals? (Recommended: no, shown separately.)
7. **Pricing model** to try first: per-tournament fee, or organiser plan? (Decide with mockups in hand; build the entitlement hook now.)
8. **Location signal** for verification (opt-in): yes or no?
