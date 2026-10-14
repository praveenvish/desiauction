# LS-1 · FINAL validated plan: live scoring, stats, awards (cricket first, every sport later)

**Status:** final plan, 2026-10-08. **Supersedes** [PLAN.md](PLAN.md) and [BRAINSTORM-2.md](BRAINSTORM-2.md) wherever they disagree. Those two stay as the research record.

**How it was validated:** two independent reviews.
- **Product and adoption review:** an adversarial look at beating CricHeroes and getting quick adoption.
- **Technical review:** every claim checked against the codebase, with file and line evidence.

Their findings are folded in below, and §9 lists what changed and why.

---

## 0. The verdict in five lines

1. **Product design: right.** One tap per ball, a log that is the single truth, every match situation handled, awards that explain themselves.
2. **Missing before review: go-to-market.** A better scorer alone won't move teams off CricHeroes. Organisers, our existing auction customers, density in one city, and the share loop will.
3. **Architecture: corrected.** The auction engine stays untouched. Scoring writes go through the web tier, and a new small `apps/live` service fans out to viewers.
4. **Launch slice: ~8 weeks** to win one city, not 16 weeks to "complete cricket".
5. **Three new risk areas now designed in:**
   - **Betting misuse of live data:** fake leagues have been staged in India for bettors before.
   - **Offline on iOS and inside WhatsApp's browser.**
   - **Minors' data.**

---

## 1. How we win (go-to-market)

### 1.1 The wedge is the organiser, not the player

- **Why the organiser:** one organiser brings 8–16 teams and 150+ players at once. A gully team brings 11.
- **Our unfair asset:** organisers who already ran an auction with us. Their squads, lineups, grounds and fixtures already exist here.
  - Every finished auction ends with: **"Your squads are ready. Score your matches here."**
  - **KPI #1:** auction seasons → live-scored seasons, as a conversion rate.
- **What the organiser gets that CricHeroes doesn't give:**
  - auction → schedule → live → awards → posters in one place;
  - a match-day board;
  - branded season posters;
  - **sponsor slots they can resell** on the overlay, live page and posters. The organiser makes money, and that is the hook.

### 1.2 One city first

- **Which city:** the one with the most auction seasons today. Score the city, never just one tournament.
- **90-day target in that city:**
  - 30 organisers;
  - 1,500 live-scored matches;
  - 10k distinct viewers;
  - 40% of matches shared to WhatsApp.
- **Why one city:** leaderboards, records and "best in Jaipur" only mean something with density. A second city starts only after the first hits target.
- **Ground partnerships:**
  - a QR code at the ground opens "Score a match here" with the venue already filled in;
  - the ground owner gets a live board for their TV for free.

### 1.3 The growth loop ships in slice 1, not last

```
Scorer starts match → live link shared in team WhatsApp groups (OG preview shows the score)
→ relatives and players watch → result poster + Player of the Match card auto-made
→ one-tap WhatsApp share by the player → new people see the brand → "Score your match" button
```

Every match also gets **an indexed public scorecard page**, so a player who searches their own name finds us. CricHeroes already uses this channel, and it costs us nothing.

### 1.4 "I'll lose my 5 years of stats" (the switching cost)

- **No scraping of CricHeroes.** It breaks their terms, it is a legal risk, and it would pour unverifiable numbers into our "trusted" profile.
- **Self-declared "previous career" block:** the player types their totals, with an optional screenshot. It is labelled "self-reported" and **never counts on leaderboards**.
- **Organiser import of their own past seasons** (Cricsheet/CSV). The organiser owns that data, so this is legally clean.

### 1.5 Verify the competitor story before marketing it

The research conflicts on one point:
- 2025 App Store reviews say CricHeroes moved the points table and career stats behind Pro;
- their store listing still says scoring and tournaments are free, and Pro is sold as "CricInsights" analytics at roughly ₹119/month.

**Task before any marketing copy:**
1. Install CricHeroes and score one match.
2. Screenshot every paywall.
3. Tag 200 recent 1–3★ Play Store reviews by complaint.

Our pitch is built on what that shows. Our own rule stays either way: **never take away something users already had.**

---

## 2. Product principles (final)

1. **Start a match in under 60 seconds.** Squads, XIs, ground and format are already known.
2. **One thumb, one tap per ball.** Extras are toggles before the runs; wickets are one sheet showing only legal choices.
3. **The log is the truth.** Scorecard, table, career, awards, overlay and poster are all folded from events. Nothing is typed twice, and nothing is ever destroyed.
4. **The server is the safe copy, as fast as possible.** The phone buffers through bad signal, but we never rely on a phone to keep data for days.
5. **One scorer at a time.** Handover is explicit, by QR code or "take over".
6. **One obvious next action** on every screen, coming from the same `nextActions(state)` code that drives the scoring pad.
7. **Every award explains itself.** An organiser override shows the system's pick beside it.
8. **Fake stats are worthless.** They never reach leaderboards, records or badges.
9. **Sports are pack values.** Behaviour lives in four family engines.
10. **No commitment to free.** We never claw back a feature, and a player's own scorecard is always viewable. There are **no ads in the scoring pad**. Whether the live page carries ads is still open.

---

## 3. Corrected architecture

### 3.1 Domain: `packages/core/src/scoring/`

- **Family interface:** `validate`, `apply`, `nextActions`, `isFinished`, `result`, `stats`.
- **Pure fold:** `replayMatch(format, events)`.
- **Payload validators are hand-written.** The `core-is-pure` rule forbids zod.
- **Subpath export `@desiauction/core/scoring`,** so the pad bundle stays small. This follows the sport-labels precedent. The pad gets **plain format data, never a `SportPack`**, because packs carry functions such as `summariseSide`.
- **Packs gain a `scoring` block of pure values:** `family`, `depth` (not "tier", which already means something else), `formats` with knobs, stat keys and the award-table id. Box formats live in the **`box_cricket` pack**, not in cricket's.
- **Award tables are code** (versioned values in core), not a DB table.
- **Version pinning:**
  - the season pins its format and award version;
  - **the match snapshots its knobs at start**, so later edits never re-fold finished matches.

### 3.2 Data (new tables)

Every new table gets: RLS with FORCE, `desiauction_app` default privileges, **explicit REVOKEs for engine and runner** (default privileges silently give them SELECT), coverage in `grants:verify`/`rls:verify`, and posture tests.

| Table | Key points |
|---|---|
| `matches` | `fixture_id`, `attempt`, `scoring_claim` (holder, since), `format_snapshot`, `phase` (derived cache), `trust_level`, `share_token` |
| `match_events` | Append-only: added to the UPDATE/DELETE revoke in `create-app-role.sql`. Unique `(fixture_id, seq)` and `(fixture_id, event_id)`. Players are referenced by **`registration_id`**, ids only, never typed names. `voids_event_id`/`amends_event_id` (by event id, so offline corrections work). `attempt`, payload `v`, `client_recorded_at`, `received_at` |
| `match_live_state` | One row per match: score, situation, last 12 balls, seq. Updated in the append transaction. SSR and polling read it by primary key |
| `match_player_lines` | Per-registration stat lines, written at finish |
| `match_awards` | Append-only: computed pick, winner, source, reason, actor |
| `fixture_officials` | Umpire, referee, scorer, commentator. A person or a display name |
| `team_managers` | `team_id`, `person_id`, role captain/manager. **New:** today the only "owner" identity comes from the auction (paddles). Who may score, who confirms and who enters a team all hang on this table. Auction ownership feeds it |

Changes to existing things:

- **`fixtures.status` stays coarse.** Live maps to `in_progress`; finished and final map to `completed`. The fine phase (toss, innings break, interrupted, stalled, under review) is derived and cached on `matches`. This avoids breaking the closed CHECK constraint, the core fixture machine and ~18 readers.
- **Outcome vocabulary follows the existing schema:**
  - `no_result` = started, then washed out;
  - `abandoned` = never started.
  - (BRAINSTORM-2 had these two the other way round.)
- **`fixture_results.source`** is `typed` or `scored`. A typed write is **refused** on a match that has events. Today `recordResult` silently overwrites.
- **NRR fixes** (the review confirmed both bugs):
  - Add an optional score field **`nrr_balls`**, written by the fold. It is the full quota when a side is all out, and the revised-target credit when DLS applies.
  - Season rule `allOutUsesQuota`, on for new seasons only.
  - Season rule **exclude no-results from NRR.** Today they are counted, which ICC does not do.
  - Displayed overs stay the real overs.
- **Capabilities:**
  - add `fixture:scorer` to `CapabilitySet`;
  - widen the 0077 CHECK to allow it on the season scope;
  - appoint per match with a `fixture_officials` row, checked in the write path. There is no new grant scope.
- **Guests are club-only people plus a registration** (this mechanism already exists, migration 0104). Claiming uses the existing `attachPhoneToClubOnly`. **Nothing ever merges** (founder rule). The "merge requests" idea from PLAN is dropped.

### 3.3 Write path: web tier, not the auction engine

1. The scorer pad writes to IndexedDB and folds locally, so the screen updates in under 50 ms.
2. It POSTs batches to a route handler.
3. One transaction runs:
   1. `SELECT … FOR UPDATE` on the `matches` row (a per-match single writer, for free);
   2. check the scoring claim and authority;
   3. `INSERT … ON CONFLICT DO NOTHING` to dedupe (never catch-and-continue: the savepoint trap);
   4. validate with the same core fold;
   5. assign `seq` and append;
   6. update `match_live_state`; at finish, also results, lines and awards;
   7. `pg_notify`.
4. The handler returns an ack or a reason per event.
5. Per-scorer rate limit (token bucket, copied from the engine's pattern).

**Why not the engine:**
- every engine route, ticket, hub and recovery path is typed to auctions;
- its single-writer lock is one global lock, so it can't be sharded by match;
- it runs at 768 MB / 1.5 CPU;
- auction nights are the certified, money-bearing path, and we don't put cricket Sunday traffic in the same process.

### 3.4 Read path: new stateless `apps/live`

- **Fan-out:** one Postgres LISTEN connection fans out to receive-only WS rooms keyed by fixture. HMAC tickets carry the fixture and the share token.
- **Delta frames:** seq-numbered, under 1 KB. Gap repair goes through `GET /events?since=seq`.
- **Scale:** no lock, so it **scales horizontally** behind Caddy.
- **Fallback:** the same JSON is served with an ETag and a short `s-maxage`, so a CDN or Caddy absorbs 50k viewers polling.
- **Load test:** its own harness. `perf:scale` is auction-only.
- **Timers:** auto-finish, stalled detection and confirmation windows run in the **existing jobs scheduler**, not in engine timers.

### 3.5 Offline: what is actually achievable

- **Pad shell is cached:** a static, data-free pad route is precached by the SW. This is a documented exception to the "no page caching" posture. It renders without cookies and hydrates from IndexedDB, so a killed tab reopens with its balls. Its static chunks are pinned across deploys.
- **No scoring in in-app browsers.** WhatsApp and Instagram in-app browsers get a full-screen "Open in Chrome/Safari to score" step before the toss. Their storage is separate and gets killed.
- **Install and persist:**
  - Android gets an install prompt; iOS gets an "Add to Home Screen" guide.
  - `navigator.storage.persist()`.
- **Match-day prep:** "Get ready for match day" pre-caches the shell, both XIs and the format when a scorer is appointed.
- **Sync** runs whenever the page is open, plus on `visibilitychange`/`pagehide` with `fetch keepalive`. Before leaving with unsent balls, the pad warns: "7 balls not sent, keep this open". iOS has no Background Sync, and we say so honestly.
- **Play Store app via TWA (Bubblewrap) in slice 1.** The market searches the Play Store for "cricket scoring app", and not being there means not existing. iOS stays a home-screen web app.
- **Hygiene:**
  - IndexedDB is wiped on sign-out (shared phones);
  - Sentry on sync failures, quota errors and refused events.
- **E2E:** offline specs use `context.setOffline`, never `page.route` (WebKit + SW bypass).

### 3.6 Performance budgets (corrected)

| Metric | Target |
|---|---|
| Tap → pad updated | < 50 ms |
| Tap → viewer | < 2 s p95 |
| Pad route JS **on its own minimal layout** (outside the console shell, which alone is 153 KB) | ≤ 60 KB over the framework baseline |
| Live page LCP on mid Android 4G | < 1.5 s (SSR from `match_live_state`) |
| Battery: 4 h of scoring on a low-end Android | < 40% drain. The scorer doesn't hold a WS, sync is batched, low-power dark pad |

---

## 4. Scoring UX additions from the review

- **House-rule presets gallery:** "Mumbai tennis-ball", "Box cricket 6-a-side", "Corporate T10", "Last man stands", "Kids league". Knobs we were missing:
  - batter retires at 25 or 30 runs, and may return after everyone else is out;
  - no LBW;
  - one-tip-one-hand catch;
  - six over the wall = out;
  - wides only down leg;
  - 6–8 a side and unequal team sizes;
  - a "common player" who bats for both sides;
  - a minimum ball count per batter (kids);
  - compulsory bowling rotation;
  - mixed-gender scoring rules (e.g. a female batter's runs ×2 in corporate leagues).
- **Multi-match day:** a "Next match" button straight from the result screen, with XIs preloaded. One scorer does 4–6 matches.
- **QR handover:** anyone can take over the pad by scanning, with no account needed until they sign the match at the finish.
- **Scorer reward:**
  - a public scorer profile ("Scored 140 matches");
  - a Scorer of the Season award;
  - credit toward the organiser's paid plan.
- **Shot direction:** an optional swipe from the run button into 8 zones. Off by default; on for showcase matches.
- **Commentary:** template lines plus free text or voice notes from a commentator device.
- **Language:** Hindi plus the first city's language (Marathi/Gujarati/Tamil…). **Western numerals** even in Hindi. Icon-first buttons.
- **Input and access:**
  - volume-key and Bluetooth clicker input for cricket too;
  - large text;
  - colour-blind-safe colours.

---

## 5. Trust and anti-fake (corrected)

Confirmation is an **upgrade nobody waits on**. Losing captains don't confirm losses, so making them gatekeepers would starve the boards.

**A match counts for the player's own career immediately.**

**It counts for season and tournament boards when any one of these is true:**
- a neutral or appointed scorer scored it;
- the opposing manager confirmed it;
- it was **live-scored and watched by ≥N distinct devices during play**: the strongest cheap signal;
- it was live-scored and the opposing side raised no dispute within 48 h.

**Matches entered after the fact** (backfilled from paper) need explicit confirmation or organiser verification.

**City and platform boards stay off** until the integrity graph exists. That graph:
- **discounts clusters of accounts that only ever play each other** (the PageRank idea against link farms);
- uses SIM-age and device-fingerprint signals for "phantom opponent" checks;
- flags the same person in both XIs or in overlapping matches;
- flags statistical outliers against format norms.

**Timing checks** use the phone's own relative timestamps inside a batch, anchored to server time at sync. An offline batch that arrives all at once is **never** downgraded just for arriving late.

**Confirmation channel:** a signed, single-use token page (the DEMO-1 pattern), reached by push or email first, with WhatsApp as an optional URL button for opted-in users. The page checks the person is a `team_manager` of the other side.

**Organisers resolve their own disputes.** The platform admin handles only boards, records and abuse.

**Moderation:** a profanity filter on team names and commentary (en/hi/Hinglish), and a "fake match / betting" report reason.

---

## 6. Betting, legal and minors

**Betting defence**, because live ball-by-ball data from local matches is a feed for offshore bookmakers:
- rate limits and bot detection on rooms and polling;
- no public read API;
- terms that forbid betting use;
- per-session watermarking;
- **a default delay of 60 s on public live data for non-verified matches**, which organisers can lift for verified seasons;
- no win-probability bar on self-scored matches;
- an admin signal for heavy foreign viewing of obscure matches.

**Minors (DPDP):**
- **public pages show initials only, with no photo,** for under-18s without guardian consent;
- guardian consent is collected at the claim step;
- academies attest consent in bulk;
- minors are excluded from public boards at query time.

**Guest phone numbers:** stored hashed until the person claims them, with a "not my number? remove" link. The claim invite goes by SMS or WhatsApp (opt-in rules apply).

**Cricsheet data is ODC-BY:** attribution goes in a repo NOTICE and on the export page. Confirm on cricsheet.org before shipping.

**Message costs:**
- each new WhatsApp message needs an en + hi utility template with Meta approval, and each send costs money;
- SMS can't carry per-match links (DLT rules);
- **push and email go first**, WhatsApp only for opted-in users, with a per-org monthly message cap and a cost model before launch.

---

## 7. Phases (final)

### Slice 1: win the first city (~8 weeks)

| # | Ships | Wk |
|---|---|---|
| S1.1 | Core delivery fold + Cricsheet oracle suite. The checks: next-ball strike rotation, legal balls per over, wickets, outcome/margin, target, super over. 50–100 curated edge matches in the repo, plus a nightly pinned download of 500+ | 1.5 |
| S1.2 | `matches`/`match_events`/`match_live_state` + grants/RLS + write route; `team_managers`; `fixture:scorer`; `fixture_results.source`; NRR fixes | 1 |
| S1.3 | Scoring pad (own minimal layout): start in 60 s, one-tap balls, wicket and over sheets, undo/edit-any-ball, auto-detect prompts, house-rule presets, QR handover (clean path), in-app-browser blocker, shell precache + match-day prep | 2.5 |
| S1.4 | Situations: interrupt, revise overs/target (manual), no-result, abandoned, walkover, super over, restart (attempt+1) | 0.5 |
| S1.5 | `apps/live` + public live page that **works perfectly in WhatsApp's browser**, live OG preview, scorecard, worm, indexed scorecard page, 60 s betting delay | 1.5 |
| S1.6 | **Growth loop:** result poster + Player of the Match / Fighter card with explanation lines, one-tap WhatsApp share; basic career page + "previous career" block | 1 |
| S1.7 | Play Store TWA listing; the "auction → score your season" prompt; entitlement hook (no-op); ground QR | 0.5 |

**Modes in slice 1:**
- auction seasons;
- tournaments without auction: organiser-assigned teams, which already works via `assignTeam`. Only a **minimal** auction hide in navigation and the season road is included; the `StageKey "auction"` must stop blocking.
- **Quick match:** see decision D1 in §8.

### Slice 2: depth (~6 weeks, after the city traction check)

- Forced takeover + quarantine.
- Trust levels + integrity graph + confirmation pages.
- Season awards and leaderboards with qualification.
- Full `team_formation` (team entry by link/code: a new approval flow).
- Match-day board; officials; push follow.
- OBS overlay + board with **sponsor slot**: the first paid SKU.
- Manhattan, wagon wheel, commentator.

### Slice 3: grow

- Browser-based "go live on YouTube with our scoreboard burned in". Streaming is CricHeroes' clearest paid product, and an OBS-only overlay reaches about 2% of users.
- City boards once density exists.
- "Looking for opponent" posts.
- Second city.

### Slice 4+: other sports

- Order: rally (badminton/TT/pickleball) → kabaddi (its own go-to-market bet) → timed → placement.
- The demand gate (`demo_requests.sport`) picks the order.
- **Not part of beating CricHeroes.** No team leaves CricHeroes because we also do pickleball.

**Estimate honesty:** a full `team_formation` touches about 170 files under seasons and about 60 navigation references. That is why it moved to slice 2 at about 3–4 weeks.

---

## 8. Decisions: ACCEPTED 2026-10-08

On 2026-10-08 the founder replied "go with your recommendations but full scale". That means:

- **Every recommendation below is accepted** as written.
- **The whole programme is approved,** not only slice 1: slices 1 to 3, then the other sports.
- Building is still sequenced as slice 1 → 2 → 3 → 4+, so the first city launches as early as possible.
- Mockups come first.

D1 is accepted in a specific form: quick match ships in slice 1 using a minimal personal club.

| # | Decision | Recommendation |
|---|---|---|
| D1 | **Quick match in slice 1?** It needs `organizations.kind = personal` (plus filters in roles, admin and listings) and a share token, because seasons default to private. Cross-org persistent teams are a separate, later design | Yes, minimal: a personal "club" for each person, hidden from directories. Promote it to a real club later via the existing move-tournament path |
| D2 | Who may score | Organiser + staff + appointed scorers + team managers of either side (unverified until confirmed or watched) |
| D3 | Player of the Match rule | Top score, but a winning-side player in the top 3 wins it; plus Fighter of the Match |
| D4 | Organiser override | Allowed on any match; the system pick is always shown beside it |
| D5 | Trust gate for boards | Any one of: neutral scorer / confirmed / watched live by ≥N devices / no dispute in 48 h. Backfilled matches need confirmation |
| D6 | Betting delay | 60 s for non-verified public matches by default |
| D7 | Pricing to test first | Per-tournament organiser fee after one free tournament, plus sponsor slots on the overlay. **Not** per-match unlocks or viewer premium |
| D8 | Ads on the public live page | Undecided. Never in the pad |
| D9 | Play Store TWA in slice 1 | Yes |
| D10 | First city | The city with the most auction seasons |
| D11 | Minors default | Initials, no photo, off boards, until guardian consent |
| D12 | NRR rules for new seasons | All-out uses quota: on. Exclude no-results: on |

---

## 9. What the reviews changed (audit trail)

| Was (PLAN / B2) | Now | Why |
|---|---|---|
| Reuse the auction engine with rooms; "sharding is a config change" | Web-tier writes + new stateless `apps/live` | The engine is auction-typed throughout and holds one global lock (`single-writer.ts:59-60`); blast radius on auction nights |
| `voids_seq`/`amends_seq`; `person_id` | By `event_id`; by `registration_id` | Offline voids have no seq; lineups and careers key on registrations |
| 15-state fixture status | Coarse status + derived `matches.phase` | Closed CHECK, terminal `completed`, ~18 readers |
| abandoned = started washout | `no_result` = started, `abandoned` = never started | Existing schema meaning |
| NRR fix by writing quota into `balls` | Separate `nrr_balls` + two season rules | Would corrupt the overs display; the no-result-in-NRR bug was not in the plan |
| Guests claim + merge requests | Club-only people + `attachPhoneToClubOnly`; no merges | Founder rule: nothing ever merges |
| Owners score / captains confirm | New `team_managers` | No owner identity exists outside auctions |
| "Hidden personal org, no schema change" | `organizations.kind` + filters + share token | Every org owner becomes an organiser in navigation; private seasons 404 |
| Pad < 150 KB | Own layout, ≤ 60 KB over baseline, core subpath export | The shell alone is 153 KB |
| Offline "never lose a ball" | Precached shell + in-app blocker + TWA + persist + honest iOS limits | The SW caches no pages; iOS has no Background Sync; WhatsApp WebView storage |
| Confirm required, 48 h | Confirmation is one of four upgrade signals | Losers don't confirm; two SIMs can collude |
| 16 weeks to complete cricket | 8-week city slice, then depth | Growth loop and go-to-market first |
| Overlay only, no streaming | Overlay + sponsor slot first; browser YouTube streaming in slice 3 | Streaming is the competitor's clearest revenue |
| Multi-sport in the main line | After the first city | Doesn't drive switching |
| "CricHeroes paywalled stats" as the headline | Verify hands-on first | Sources conflict |
| — (missing) | Go-to-market, betting defence, minors, message cost, battery, house rules, scorer incentives, Play Store | Review findings |

---

**Mockup canvas (2026-10-08):** https://claude.ai/artifact/3YAyUNSVrCM3LAp1jtNL4j

It holds 23 screens:
- scorer start;
- the pad, which is interactive;
- every situation;
- the viewer live page, scorecard and charts;
- result, Player of the Match and confirmation;
- the organiser match-day board;
- overlay, poster and link preview;
- career and season awards.

---

## 10. Addendum 2026-10-08: match conditions, shot map, player insights (founder feedback)

The founder asked for three things:
- match type (day or night), ball type and ground type;
- where each shot went and where each batter got out;
- insights such as "strong in which area, against which type of bowler".

These belong in **slice 1**, because data that was never captured can't be filled in later.

### 10.1 What gets captured

| Data | Where it comes from | Stored on |
|---|---|---|
| Time of play: day / day–night / night | Prefilled from the kickoff time and `grounds.floodlights` | `matches.conditions` (jsonb) |
| Ball: leather (red/white/pink) / tennis / tape / rubber | Season rule | `matches.conditions` |
| Ground: full / half / box / indoor | Prefilled from the ground (`grounds.indoor`) | `matches.conditions` |
| Pitch: turf / matting / astroturf / cement | `grounds.surface` (turf, matting, astroturf, concrete already exist) | `matches.conditions` |
| A condition change mid-match (lights on, ball changed) | ⋯ menu, applies from the next over | `conditions_changed` event |
| Batting hand | `batting_style` (existing column). If unknown, asked once at the crease | Registration snapshot; suggested to the profile |
| Bowling style | `bowling_style` (existing 8 keys). If unknown, asked once at the bowler's first over | Registration snapshot; suggested to the profile |
| Shot direction | The scorer taps 1 of 8 zones after a scoring shot (setting: every scoring shot / boundaries only / off). Mirrored for left-handers | `ball` event `shot: { angle, zone }` (optional) |
| Where caught or run out | Pin on a mini field in the wicket sheet (optional) | `wicket.where: { x, y }` |
| Phase | Derived from the over and format: powerplay / middle / death | Projection |

Notes:
- **Shot depth is not asked.** It comes from the runs: a 4 or 6 reaches the rope; 1–3 are inside or outside the circle by runs.
- **Distance is not captured.** No screen may show metres.
- A style set by the scorer goes on the season registration (the snapshot), and the player sees "Scorer set your bowling style: off-spin. Right?" Scorers never overwrite a profile value the player set themselves.

### 10.2 The analytics projection

`ball_facts` has one row per delivery, written when a match is finalised. Its columns:

- batter and bowler registration;
- batter hand and bowler style;
- phase and conditions (as they were on that ball);
- zone, runs, extras;
- dismissal kind and where.

**Every insight is a GROUP BY over `ball_facts`**, filtered by the trust gate: only verified or confirmed matches. Rules:

- Insights always state their sample: "418 balls in 18 matches".
- Any slice under 60 balls is labelled "small sample". Players are not ranked on it.
- Minors' insights follow the minors rule (§6).

### 10.3 Screens

On the canvas pages Scorer, Insights and Organiser:

- conditions step;
- shot map sheet (interactive in the pad);
- bowler style asked once;
- wicket with catch location;
- over-end matchup hint;
- **batter insights:** zones and wagon wheel; vs bowling type; by phase; by conditions; how and where out;
- **bowler insights:** where batters score off her; wicket types; economy by phase; vs LHB/RHB; by ball type;
- **"Know your opponent"** captain's brief, marked **PRO**. It is the clearest paid feature: organisers and captains pay for preparation, players keep their own stats.

### 10.4 Phasing change

| Slice | What moves into it |
|---|---|
| 1 | Conditions, shot map, catch pin, ask-once styles (capture only) and the wagon wheel on the live page and poster |
| 2 | `ball_facts`, batter and bowler insight pages, leaderboard filters by conditions |
| 3 | Captain's brief (PRO), broadcast "STAT" cards on the overlay |

**Estimate:** +1 week on slice 1 (pad sheet, conditions step, events); +1.5 weeks on slice 2.

### 10.5 Design direction (v2 canvas)

The first draft was rated 4–5 out of 10. v2 reuses the auction room's language:

- navy floodlight background;
- gold rim on the one card that matters;
- Clash Display for every number;
- spaced caps for labels;
- a two-line gold primary button;
- real player photos with the branded placeholder art;
- the countdown ring reused as "balls left".

There is one kit for all live screens. Organiser screens stay in daylight. v1 is kept on its own canvas page for comparison.


## As built

This section records implemented departures authorised during execution. The binding details and their evidence are in [exec/01-contracts.md](exec/01-contracts.md) and [exec/EXEC-LOG.md](exec/EXEC-LOG.md). C46 and Milestone 10 passed full verification. C47–C56 have passed their gates, including the full final verification sweep.

- The pinned Cricsheet audit retains all 7,018 matches as its denominator. The human-approved exclusion ceiling is 1.0%, replacing 0.5%. The completed C09 audit reports 6,971 passes, zero failures and 47 unique exclusions (0.669706%). Source reconstruction is explicit: 4,905 passing matches use 14,986 audited inferred end adjustments, with 262 additional source-normalisation records. These are not unaided ordinary-rotation proofs. Official miscounted overs, retirement/replacement and source-profile rules are documented; unexpected errors never become exclusions. Committed curated fixtures remain byte-pinned and prove all six assertion classes.
- Accepted history owns correction attempts, whole-match voids and provenance. Known player styles become canonical start-time events; missing styles are asked during play. Later profile edits do not backfill historical attribution. The existing run stepper supports seven through ten, and innings continuation is reachable explicitly.
- Public live scores, scorecards, charts, results and overlays use the same eligible delayed representation. Missing historical sidecars remain unavailable. Canonical score traces carry penalty, wicket and miscount adjustments. Current trust, tenant access and historical minor/privacy gates also govern insights and dismissal denominators. Whole-match voids withdraw fresh representations; an already loaded terminal display stays until reload under the recorded publication amendment.
- Notifications are durable after commit, resolved through recipient-only inbox links without persistent private bearer links. Toss reminders fire once and follow effective corrected tosses. Awards use WhatsApp without an SMS fallback; external provider approval is not claimed.
- Result overrides preserve authority and reasons, publication ordering and representation identity. Opposing-manager confirmations retain immutable revision history and restart their 48-hour window; excluded status is sticky, with platform moderation recorded. Qualified cross-club overlap remains read-only. Guest claims preserve registration, person and finalized-fact identity.
- Quick matches reuse persistent club teams and annual competition participation. Tournament moves include every team-entry status. Migration 0123 adds nullable scorer-person award identities; other awards retain registration identity. Overrides require actual eligible participation. Null picks are valid; absent emerging eligibility yields no automatic pick, absent best-N uses all matches, and optional award configuration is durable and frozen.
- Ball facts use documented primary-extra and sole-fielder rules. Condition averages combine fact numerators with separately aggregated canonical dismissal-time condition snapshots under identical eligibility gates. Unknown historical attribution stays unavailable until regeneration; facts are neither duplicated nor fabricated.
- Captain briefs require Pro/association entitlement and same-tenant scope. Broadcast entries and sixty-ball known-style statistics use eligible historical facts, exclude the current fixture and do not invent statistics.
- The pinned Postgres listener needs its own physical connection. The authorized live-service limit is two system-role connections: one dedicated LISTEN connection with no idle timeout and one bounded reader. Transactional notifications, delayed publication, revocation, bounded rooms and shutdown are proved; ordinary HTTP polling remains available. Websocket activation uses the exact opt-in environment path.
- The current reference canvas has 28 named product artboards, including two labelled 21; its older 23-screen introduction is stale. Screens are checked in both themes at phone/laptop sizes where applicable, with native-size transparent overlay and intrinsic canonical preview/poster images. The empty “This over” row has a semantic group role. UI4 metadata is completed on actual controls; the explicit human takeover uses existing API-4 authorization, reloads canonical history before enabling scoring and protects unsent deliveries.
- Android app-link metadata and TWA instructions are implemented. Signing certificates, the Play listing and publication require operator-owned release credentials; no store publication is claimed.
- Validation uses the isolated four-role database. The populated auction-board regression uses a documented logical clock above retained events and still proves the unchanged ten-row order and exclusion. Public 404 diagnostics preserve the original navigation/status/timing checks without a speculative application repair.
- The human workflow override defers implementation commits until the end and requests no PR, push or merge. Mandatory blocker-log commits are retained. Final local completion evidence is recorded in exec/EXEC-LOG.md; all remaining gates passed.

The C46 live-service bearer test now reuses one canonical timestamped snapshot. A deterministic held-reader regression separately proves timestamp and trust changes at unchanged sequence publish once, identical snapshots do not, and denied peers receive nothing. Production full-frame deduplication is unchanged.


## As built: sports

All five scoring families use accepted immutable history for the private pad, server replay, corrections, restart, public publication and explicit finalization. Unknown catalogue keys remain unsupported rather than inheriting cricket. Names and public state pass the same current access, historical privacy and trust-based delay gates across server rendering, HTTP polling and live sockets. Family panels use their own score units and both themes.

| Family | Existing sports | Implemented behavior |
| --- | --- | --- |
| Delivery | Cricket, box cricket | Canonical deliveries, extras, wickets, quotas, retirement, targets, super overs and honest player attribution; cricket awards and career facts. |
| Rally | Badminton, table tennis, pickleball, volleyball | Actual players, points, games/sets and rubbers; singles/doubles, configured team ties, side-out or rally scoring, service, ends, deuce/caps, volleyball substitutions and explicit finish. Frozen unscored awards; no fabricated cricket player facts. |
| Raid | Kabaddi | Approved starting mat, halves and canonical clock, actual raiders/defenders, revivals, all-outs, super tackles, bonuses, cards and substitutions; kabaddi match awards and supported season awards. |
| Timed | Football, hockey, basketball | Approved active/bench players and frozen roles; periods, canonical running/stopped clocks, goals/points, actual scorer/assist attribution, cards, fouls and substitutions. Configured football/hockey shootouts stay separate from regulation goals. |
| Placement | Battle royale | All scheduled squads, one to one hundred configured rounds, exact playing-roster kills including zeroes, frozen round placement points and aggregate ranks/standings. Scored provenance refuses typed overwrite; only actual top-fragger awards. |

Timed presets are football 2×45 minutes with optional shootout, hockey 4×15 minutes with optional shootout, and basketball 4×10 minutes. Basketball regulation ties are supported; overtime is not invented. The existing catalogue has no futsal pack, and the recorded Astra amendment does not create one. Hockey is explicitly unscored for awards. Football penalty saves/misses are untracked because no canonical in-play event records them; failed shootout attempts never stand in for those facts. Clean-sheet awards use actual canonical appearances, known frozen roles and zero regulation goals conceded across the whole match. Basketball awards use actual points minus fouls. Timed, rally and placement season awards remain unavailable.

Lobby standings sum each accepted round's placement points and kills rather than adding a fictitious overall placement bonus. Aggregate kills may exceed one hundred without relaxing the existing typed single-round limit. Missing, malformed or mismatched scored history fails closed. Top fragger uses actual cumulative kills, better aggregate team placement, then registration identity; no positive kills yields a null automatic pick. Multi-team authority requires a single explicit represented squad when ambiguous, and confirmation requires current managers of every other participating squad.

Each family retains durable local scoring, canonical resume/claim and device ownership, undo/correction, controlled restart and protected finalization. Clocks use released canonical anchors without synthetic tick events. Complete accepted lobby setup is published as a zero-round live snapshot for prompt first-round polling; it does not invent play or satisfy the genuine-round trust minimum. Public interfaces have no fictional home/away sides for lobbies, raw kill attribution, private contacts or event history. Actual player statistics remain independent of unavailable award tables.

C54 browser acceptance covers the unchanged typed lobby flow, offline scored rounds, a real second viewer, both themes, phone/laptop layouts, exact standings and top fragger. C55 covers one completed real journey per family in both themes with accessibility checks. Final C56 gate results and the human's single-commit/no-PR workflow override are recorded in exec/EXEC-LOG.md; no remote CI or deployment is claimed.
