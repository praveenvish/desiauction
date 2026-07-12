# X1 — FOUNDER FIVE-SECOND TEST · RESEARCH OPERATIONS MANUAL

> Lead UX Researcher · v1.0 · 2026-07-11 · Phase 0B, activity VA-1 judging (Evidence Plan X1; discharges Review Board conditions G1, G3, G4)
> **Pre-registration notice:** §12–§14 (decision rules, success/failure, exit criteria) are locked the moment the first participant sits down. They may not be edited afterward, for any reason, including "the participant misunderstood." A misunderstood participant is data.
> **Self-containment:** this manual assumes the facilitator has never seen DesiAuction. Everything needed is written here.

---

## 1 · RESEARCH PLAN

### 1.1 What is being tested
An interactive prototype of a live cricket player-auction product, served locally: three web pages — a projector **Stage** (`stage.html`), a mobile **Owner Room** (`owner.html`), an operator **Cockpit** (`cockpit.html`) — with two visual directions, **A** ("Floodlight": dark, electric accent) and **B** ("Maidan": green, warm gold), switchable via a ⚙ button on each page. A simulated auction runs by itself. Nothing is real; no money moves.

### 1.2 The only three questions
1. **Five seconds:** what kind of product do people believe this is — and does it read as exceptional?
2. **Five minutes:** do people trust it — with attention, and with (simulated) money?
3. **Forty-eight hours:** what survives in memory?

Everything else recorded is secondary and marked as such.

### 1.3 Study design
- **First exposure is between-subjects**: each participant's five-second test shows **one** direction only (their first impression is unrepeatable; it is the purest data this study collects). Half see A first, half B.
- **Comparison is within-subjects, afterwards**: both directions shown side-by-side later in the session for preference and price-anchor data (secondary evidence; contaminated by first exposure, and logged as such).
- One participant at a time. No audiences. ~30 minutes per session + 5-minute 48-hour call.
- Sessions in the participant's preferred language (Hindi / Hinglish / English). Key probes are provided bilingually in §4.

### 1.4 Participant groups

| Group | n | Why | Expected bias | Compensation for bias |
|---|---|---|---|---|
| Tournament organizers (have run/helped run one) | 3 | The buyer; H4/H5 primary | Courtesy toward founder; feature wishlists | Brutal-honesty framing (§4.1); behavioral metrics outrank statements; wishlist items logged but excluded from verdicts |
| Team owners / past auction bidders | 3 | The money interaction; H3 precursor evidence | Bravado ("I'd never mis-tap") | Judge what their thumbs do, not what they say; timing data decides |
| Club players | 2 | The ceremony is about them; H7 dignity | Excitement inflation (it's *their* fantasy) | 48-h recall is the corrective; novelty decays, memory doesn't |
| General users (no cricket admin involvement) | 2 | Category-recognition control: can a stranger tell what this is? | None specific | — |
| **Founder** | 1 | Constitutionally required (Evidence Plan B1: "recorded founder five-second review") | Maximal — knows everything | Logged as `P-F`, **excluded from all neutral-participant thresholds**; their session runs first as pilot |
| Engineers / designers / PMs | 0 | Deliberately excluded from X1 | They pattern-match to SaaS aesthetics (Linear-familiarity) and would inflate/deflate H5 for reasons irrelevant to organizers in Sitapur | If one is available, run as unlogged protocol rehearsal only |
| Sponsors | 0 | Deferred to VA-4 (they judge from the Stage in a commercial frame) | — | — |

**Total: 10 neutral + founder.** Minimum viable if recruiting is hard: 6 neutral (2 organizers, 2 owners, 1 player, 1 general) — thresholds in §12 are expressed as fractions, not absolute counts, for this reason. Recruiting difficulty itself is logged (it is evidence for A-CU1 in the Evidence Plan register).

**Compensation:** chai/snacks + ₹200–500 honorarium or equivalent courtesy. Say it's for their time, not their praise.

---

## 2 · FACILITATOR GUIDE (minute-by-minute)

### 2.0 One-time prep (before any session — this IS Review Board G3/G4; do it on camera)
1. Start the server: `cd desiauction-next/prototypes/va1 && python3 -m http.server 8477`.
2. Note the laptop's LAN IP (`ipconfig getifaddr en0` on macOS) → phone URL is `http://<IP>:8477/owner.html`. Laptop and phone must share Wi-Fi. **Note: the phone's auction is its own simulation — it is NOT synced with the laptop's Stage. Never imply they are one auction.**
3. **Warm-up exercise (G3), recorded:** on the phone, ride a marquee duel past ₹5L and place one **held** bid (button says "HOLD TO CONFIRM"; press ~1s until it commits) — confirm the fill animation runs and the bid lands. On the Cockpit, open a lot with `O` and close one by **holding Space** ~1s. Trigger one **Disconnect** from the ⚙ drawer on the phone and watch the three-step "Signal lost → Rejoining → Caught up" sequence complete. Let one lot pass unsold (⚙ → "Unsold next"). Let the Stage reach its **rest state** ("Next on the block…"). If ANY of these misbehaves, stop: file it, fix the instrument, restart prep. No participant sees a broken instrument.
4. **Real-device check (G4):** on the phone, confirm the Owner Room lays out correctly at native width (no horizontal scroll, bid button fully visible above the home bar). In Chrome on the laptop, with the window **focused and visible**, open devtools → Performance → 6× CPU throttle → play one SOLD ceremony → confirm no visible stutter; note the ⚙ drawer's fps only when the drawer is closed again afterward (measure via devtools, not the drawer, during ceremonies).
5. Print/copy: this manual §4–§8; one observation sheet (§5) per participant; the screen-cover card (any opaque A4 sheet).
6. Recording: position a phone camera over the participant's shoulder capturing screen + hands; start QuickTime screen recording on the laptop. Test both.

### 2.1 Per-session reset (every participant, no exceptions — this IS Review Board CF-3/G1)
- Open a **fresh incognito window** (⌘⇧N). Prior direction/motion settings cannot leak into incognito.
- In the incognito window, open `http://localhost:8477/stage.html`. Click ⚙ once: verify **Direction** matches this participant's assignment (§2.2) and **Motion = Full**. Close the drawer. (For one designated participant per direction, set Motion = Reduced instead — §7 metric M-11.)
- Wait for a **live duel state**: a lot open, ≥2 bids on the board, timer above 10 seconds. (The demo runs itself; this occurs within ~30s of a lot opening.) **Check the countdown ring color at lot open — it must not be amber early** (Review Board NC-2); if it is, screenshot it, note it, reload.
- Cover the screen with the card **before** the participant enters.

### 2.2 Assignment table (fill before recruiting)

| P# | Group | First direction | Motion | 48h call scheduled |
|---|---|---|---|---|
| P-F | Founder (pilot) | A | Full | — |
| P1 | Organizer | A | Full | ☐ |
| P2 | Owner | B | Full | ☐ |
| P3 | Player | A | Full | ☐ |
| P4 | General | B | Full | ☐ |
| P5 | Organizer | B | Full | ☐ |
| P6 | Owner | A | Full | ☐ |
| P7 | Player | B | Reduced | ☐ |
| P8 | General | A | Reduced | ☐ |
| P9 | Organizer | A or B (balance) | Full | ☐ |
| P10 | Owner | A or B (balance) | Full | ☐ |

### 2.3 Session clock (target 30 min)

| Minute | Step |
|---|---|
| −5 | Reset per §2.1. Screen covered. Recorder on. |
| 0–2 | Welcome + consent (§3.1). Participant seated in front of covered screen. |
| 2–4 | **Five-second test** (§6). First reactions captured verbatim. |
| 4–5 | Five-second follow-up probes (§6.4). |
| 5–10 | **Free exploration** of the Stage (§3.3): hand over nothing, assign nothing, say nothing. Observe. |
| 10–17 | **Task block** on the phone — Owner Room (§4.3): orient → bid → outbid moment → disconnect recovery → SOLD observed. |
| 17–20 | **Trust test** (§4.4) back on the Stage/order book. |
| 20–23 | **Direction comparison** (§4.5): show the other direction; preference + price anchors. |
| 23–28 | Post-session interview (§8). |
| 28–30 | Close (§3.5). Schedule the 48-hour call *now*, in their calendar/WhatsApp. |
| +48h | Recall call (§9), 5 minutes. |

Organizer-group participants get one extra block if time allows (swap §4.5 to minute 26): two minutes seated at the **Cockpit** with the single instruction "run the next lot" — first-touch data for H4 (full naïve-operator testing remains VA-2's job).

---

## 3 · MODERATOR SCRIPT (spoken verbatim; ✋ = moderator silence, count 5 in your head before any prompt)

### 3.1 Welcome & consent
> "Thanks for giving me half an hour. I'm going to show you something on this screen and ask what you think. Two important things. First — **I did not design this**, so you cannot hurt my feelings; the more bluntly you speak, the more useful you are. Second — there are no wrong answers and no trick questions; if something confuses you, the thing is wrong, not you.
> I'd like to record the screen and your voice so I don't have to take notes from memory. The recording stays with us, it's never published. Is that okay? *(wait for yes)*
> I'll also call you for five minutes the day after tomorrow — I'll ask what you remember. Can I? *(schedule it)*
> One rule for me: I'm mostly going to stay quiet. If I don't answer a question, I'm not being rude — your guess is exactly what I need."

Hindi (use if preferred): «मैंने इसे design नहीं किया है — इसलिए बेझिझक बोलिए। कोई ग़लत जवाब नहीं है। अगर कुछ समझ न आए, तो ग़लती इस चीज़ की है, आपकी नहीं।»

### 3.2 Five-second test lead-in
> "I'm going to show you a screen for just five seconds, then hide it again. Don't try to read everything — just look. Ready?"

*(Uncover. Count exactly 5 seconds on a phone stopwatch. Cover.)*

> "Tell me everything going through your head — first thing first."
✋ *(Write verbatim. Do not react. Do not nod at "good" answers. When they stop:)* "What else?" ✋ *(When they stop again, move to §6.4 probes.)*

### 3.3 Free exploration lead-in
> "Now it's yours to watch or touch — whatever you'd naturally do. Think out loud if you can. I'll just watch."
✋ *(Five minutes. Intervene only for a technical failure. If asked "what should I do?" — )* "Whatever you'd naturally do."
*(If asked "what is this?" — )* "What do you think it is?"

### 3.4 Transitions
Into tasks: > "Now I'll hand you this phone and ask you to do a few small things on it. Same rules — think out loud."
Between tasks: > "Okay. Next one." *(Never "well done", never "good", never "yes exactly". If a task fails: )* "No problem. Next one." *(Log the failure; do not rescue unless they're stuck >90 seconds, then: )* "Let's leave that one. Next."

### 3.5 Closing
> "Last question before we stop: if a friend asked you tomorrow what I showed you today, what would you tell them, in one or two sentences? ✋
> That's everything. Thank you — this was genuinely useful. I'll call you day after tomorrow for five minutes, as agreed."

**The moderator must never:** explain what a screen means, sell, teach, correct a wrong guess, encourage, justify a design choice, or reveal which direction "is ours." If the participant asks any why-question about the design, the answer is: "Good question — noting it."

---

## 4 · PARTICIPANT SCRIPT (exact task wording)

### 4.1 Ground rules (given verbally in §3.1 — nothing written is handed over; reading instructions changes first impressions)

### 4.2 Five-second test — no participant instructions beyond §3.2

### 4.3 Task block (Owner Room on the phone; read one at a time)
- T1 · Orient: "Take this phone. Take your time. **Tell me where you are and what's happening.**" — *(clock stops at a correct articulation: they name a player/auction/bid)*
- T2 · Bid: "**When you're ready, take part.**" — *(deliberately not 'press the bid button'; whether they find it IS the data)*
- T3 · Outbid: *(wait until a rival overtakes them — the simulation will)* "**What just happened?**"
- T4 · Recovery: *(moderator opens ⚙, taps Disconnect, closes drawer — silently)* ✋ "**What's going on? … Where do things stand now?**" — *(clock: from reconnect to participant correctly stating their purse and who leads)*
- T5 · Ceremony: *(wait for a SOLD to occur naturally)* ✋ *(capture reaction — face, words, posture — BEFORE asking)* "**What was that moment? Was it too much, about right, or too little?**"
- T6 · Return: "**Get back to where you can bid again.**"
- T7 · Natural end: "**Do whatever you'd do next if this were your team's real auction night.**" ✋

Hindi task cores: T1 «बताइए आप कहाँ हैं और क्या हो रहा है?» · T2 «जब तैयार हों, हिस्सा लीजिए।» · T4 «अब चीज़ें कहाँ हैं?» · T5 «वो क्या था? ज़्यादा था, ठीक था, या कम?»

### 4.4 Trust test (Stage, laptop)
> "Earlier this auction sold some players. **Using only what's on this screen, tell me: who bought [pick a name from the order book], for how much — and how sure are you that that's final?** Say it like you're settling an argument between two friends." — *(stopwatch from question end to confident answer; note WHAT they point at — the order book, the amount, anything they call proof)*

### 4.5 Direction comparison
*(Open the other direction in a second incognito window; place windows side by side at a similar auction moment.)*
> "Same product, two looks. **No right answer: which one would you trust with your team's money, and why?** … **If a tournament ran on the left one, what would that cost the organizer? And the right one?**" — *(the price-anchor delta between directions is metric M-9)*

---

## 5 · OBSERVATION SHEET (one per participant; timestamped rows; verbatim before interpretation)

```
P#: ____  Group: ____  First direction: A / B  Motion: Full / Reduced  Date: ____
Recording file(s): ______________________

| Time | Task/Phase | Action observed | Confusion? | Success/Fail | Unexpected behavior | VERBATIM quote | Moderator note (interpretation — keep separate) | Evidence ID |
|------|-----------|-----------------|------------|--------------|--------------------|----------------|--------------------------------------------------|-------------|

Five-second first words (verbatim, in order): ______________________________
Premium-class word used unprompted? (TV / IPL / professional / premium / broadcast / "बड़ा"/"असली" equivalents): YES → word: ____ / NO
Product correctly identified? (player auction / sports bidding): YES / NO / PARTIAL: ____
SOLD moment spontaneous reaction (before any question): smile / lean-in / exclamation / silence / other: ____
Dignity check: any moment participant laughed AT a person on screen or seemed embarrassed BY the interface? YES (describe) / NO
Timer color at each lot open (NC-2 watch): normal / amber-early (screenshot!)
```

---

## 6 · THE FIVE-SECOND PROTOCOL (exact)

1. Screen covered before participant enters. Stage shows a **live duel** (≥2 bids, timer >10s) in the participant's assigned direction. Motion per assignment.
2. Moderator reads §3.2. Starts stopwatch on uncover. **Exactly 5.0 seconds.** Cover again.
3. **Capture phase (most important 60 seconds of the study):** verbatim, in order, no reactions from moderator. First words are gold; write them exactly, in the language spoken.
4. **Follow-up probes** (open-ended, in this order, ✋ between each):
   - "What kind of thing is this?" *(product identification — M-1)*
   - "What was happening on it?" *(attention legibility — H1/M-2: credit only player + price/bid + someone leading; partial credit logged as partial)*
   - "Who do you think it's for?"
   - "What would you have done next if I hadn't covered it?"
5. No multiple choice. No "did it look premium?" — the premium words must arrive on their own or not at all.

---

## 7 · METRICS FRAMEWORK

**Behavioral (primary — decides verdicts):**

| ID | Metric | How measured |
|---|---|---|
| M-1 | Product identification ≤5s | §6.4 probe 1, correct/partial/incorrect |
| M-2 | Attention legibility | §6.4 probe 2: player+price+leader named |
| M-3 | Unprompted premium-class vocabulary | §5 checkbox, word recorded, ≤10s of reveal |
| M-4 | Time to first understanding (T1) | Stopwatch, phone handoff → correct articulation |
| M-5 | First tap correct (T2) | First touch is the bid button: Y/N; wrong-tap count |
| M-6 | Tap-to-bid time under contest | From "take part" to committed bid |
| M-7 | Recovery comprehension time (T4) | Reconnect → correct purse+leader statement |
| M-8 | Trust-test settle time (§4.4) | Question end → confident, correct answer; artifacts cited |
| M-9 | Premium price anchor (§4.5) | ₹ figure per direction; delta |
| M-10 | SOLD spontaneous reaction rate | §5 checkbox per ceremony observed |
| M-11 | Reduced-motion parity (P7/P8 only) | Their M-1..M-8 vs full-motion cohort; ceremony meaning intact (T5 answer) |
| M-12 | Dignity events | Count (target: zero) |

**Opinion (secondary — corroborates, never decides alone):** ceremony too-much/right/too-little; direction preference + why; trust rating if volunteered; §8 answers.

**Moderator interpretation (tertiary — hypothesis fuel only):** the separate column in §5; never enters the decision matrix.

---

## 8 · POST-SESSION INTERVIEW (neutral; ✋ after each; verbatim)

1. "What stood out?"
2. "What confused you?"
3. "Walk me through what you'd expect to happen next, after what you saw."
4. "Was there anything that made you trust it? What, exactly?"
5. "Anything that made you hesitate?"
6. "What will you remember from today?"
7. *(organizers only)* "What would running your tournament on this involve, as you understand it?"
8. *(owners only)* "Auction night, your money, this phone in your hand — what worries you?"

Banned forms: "Did you like…", "Wasn't it…", "How premium…", anything naming a feeling before the participant does.

---

## 9 · 48-HOUR RECALL (phone call, 5 min, verbatim)

1. "What do you remember from what I showed you?" ✋ *(everything unprompted first)*
2. "Is there one image that stayed with you?"
3. "If you had to describe it to someone in one sentence, what would you say?"
4. "If you saw it again among other apps, what would you recognize it by?"
5. "What feeling is left, if any?"

Score afterwards (not during): ceremony/gold moment recalled Y/N · any trust artifact (receipt, exact money, order book, "it recorded everything") recalled Y/N · description matches "live auction of players" Y/N · recognizable-by answer names something distinctive (light/color/name-on-screen) Y/N.

---

## 10 · EVIDENCE LEDGER TEMPLATE (append rows to Evidence Plan §11 after synthesis)

```
| Evidence ID | Participant | Scenario | Observation (verbatim/behavioral) | Type (behavior/opinion/interpretation) | Confidence (high/med/low) | Supports | Contradicts | Open questions |
|---|---|---|---|---|---|---|---|---|
| E-X1-001 | P1 | Five-second, Dir A | "..." | behavior | high | H5, A-V1 | — | — |
```

Rules: no row without a participant ID; verbatims quoted in original language with translation; one observation per row; `Supports/Contradicts` cite H1–H10 / EP / XC / register IDs only.

---

## 11 · BIAS CONTROL PLAN

| Bias | Defense |
|---|---|
| Founder bias | Founder's own session is `P-F`, run first as pilot, excluded from every threshold; during neutral sessions the founder either moderates from script only or observes silently — never both comments and moderates |
| Builder bias | The builder wrote this protocol before any session; criteria locked (§12); builder receives raw verbatims, not summaries; any deviation from script is logged on the sheet |
| Moderator bias | Verbatim-first logging; ✋ silence rule; banned-phrase list (§8); interpretation quarantined to its own column |
| Confirmation bias | Decision rules pre-registered (§12); contradicting evidence gets its own ledger column and MUST be filled per participant (write "none observed" explicitly) |
| Courtesy bias | "I did not design this" (§3.1 — true); honorarium framed as payment for time; behavioral metrics outrank opinions by construction (§7); friend-question (§3.5) elicits the social answer they'd actually give |
| Novelty bias | The 48-hour recall is the decisive memory instrument; day-of "wow" is logged as opinion, not evidence of memorability |
| Order effects | First exposure between-subjects; comparison explicitly labeled secondary; direction order balanced (§2.2) |
| Recency effects | Interview asks "stood out" before "remember"; recall call is unprompted-first |
| Groupthink | One participant per session, no spectators; participants asked not to discuss with each other until after their 48-h call |
| Expectation bias | Participants never told what the product is, who made it, or that two "versions" exist until §4.5 |

---

## 12 · DECISION MATRIX (pre-registered; locked at first session)

| # | Rule | Threshold | Consequence if failed |
|---|---|---|---|
| D-1 | Product identification (M-1) | ≥70% of neutral participants correct/partial | **Do not redesign.** Investigate first: run 3 more five-second tests varying only the auction state (duel vs opening) to isolate whether the state, not the design, is illegible |
| D-2 | Premium vocabulary (M-3), per direction, first-exposure only | ≥3 of 5 first-exposure participants (or ≥60% if n≠5) | That direction fails H5. One iteration permitted (VA-1 activity spec), then 5 fresh participants. Both directions failing = B1 blocked, escalate to founder |
| D-3 | Attention legibility (M-2) | ≥4 of 5 (≥80%) name player+price+leader | H1 fails → the Stage hierarchy is wrong; iterate Stage only, re-run five-second component only |
| D-4 | Trust settle (M-8) | ≥60% settle in <30s citing an on-screen artifact | **HOLD VA-2** (per study charter); the trust rendering isn't working — investigate what they looked for and didn't find |
| D-5 | Bid interaction (M-5/M-6) | ≥80% first-tap correct; median tap-to-bid <10s in X1's low-pressure setting | H3 precursor fails → fix Owner Room before VA-2 (VA-2's <3s criterion presumes basic findability) |
| D-6 | Recovery (M-7) | All participants who see the disconnect can state purse+leader within 30s of reconnect | H9 perception fails → EP-10's narration is not landing; revise copy (content, not constitution) |
| D-7 | Ceremony judgment (T5) | Majority "about right"; ≥50% spontaneous reactions (M-10) | "Too much" majority → dial ceremony, retest; "too little"/silence majority → H2 fails, escalate (this challenges VA-0 §10 and may justify a constitutional amendment — the ONLY rule here that can) |
| D-8 | Memory (48h) | ≥70% recall the ceremony or a named screen moment; ≥50% ALSO recall a trust artifact | Below first bar → no memorable center: brand problem, founder review of VA-0 §5. Below second → trust is invisible: EP-3 rendering review |
| D-9 | Divergent memory | If recalls are mostly non-overlapping across participants | Log "brand lacks a memorable center" as a Critical finding regardless of D-8 pass |
| D-10 | Dignity (M-12) | Zero events | Any event = immediate Critical finding, fix before any further session |
| D-11 | Direction verdict (H6) | One direction wins BOTH first-exposure M-3 rate AND preference+price anchor | Split verdict → per register: iterate and retest; do not average a winner into existence |
| D-12 | Reduced-motion parity (M-11) | P7/P8 within range of cohort on M-1..M-8; T5 meaning intact | Fail → XC-8 violation; motion system revision before UI build |

**Global rule:** a single participant's behavior never triggers a redesign; three participants' converging behavior does. One participant's behavior CAN trigger an investigation.

## 13 · SUCCESS / FAILURE CRITERIA (study level)

**X1 succeeds** if: sessions run per protocol (deviations logged), ≥6 neutral participants completed including ≥2 organizers, all D-rules evaluated with evidence rows, and verdicts recorded for H1, H2, H5, H6, H7 (human half), H8 (perception), H9 (perception) — **whatever those verdicts are**. A disproven hypothesis is a successful study.

**X1 fails** if: criteria are edited after start; verdicts are asserted without ledger rows; moderator deviations go unlogged; or fewer than 6 neutral participants complete (→ recruit further before claiming anything; log recruiting difficulty as A-CU1 evidence).

## 14 · EXIT CRITERIA FOR X1

X1 is complete when ALL of the following are in the repo:
1. Observation sheets + recordings archived for every participant (`docs/phase-0b/x1-evidence/`).
2. Evidence Ledger rows appended to `EVIDENCE_PLAN.md` §11 with participant attribution.
3. The Decision Matrix (§12) evaluated row by row, each with cited evidence IDs.
4. A one-page X1 synthesis (§15 framework) with verdicts for the seven hypotheses above.
5. 48-hour calls completed (or logged as unreachable after 2 attempts).
6. Either **B1 declared cleared** (D-2 + D-3 + D-7 pass in at least one direction, founder five-second review recorded) **or** the iteration path invoked with its scope named.

## 15 · ANALYSIS FRAMEWORK (after ALL sessions; never during)

1. **Facts:** transcribe verbatims + metric values per participant. No adjectives.
2. **Patterns:** only observations appearing in ≥3 neutral participants graduate to patterns. Two participants = "candidate pattern (n=2)". One = open question.
3. **Hypotheses:** explanations for patterns, phrased falsifiably, each with "what would test this."
4. **Recommendations:** only from patterns, each tagged with its target — **VA-0 amendment** (requires founder sign-off; D-7 is the likeliest source), **prototype fix** (before VA-2), or **protocol fix** (before more sessions).
5. Anecdote firewall: any sentence in the synthesis citing a single participant must carry `(n=1, open question)` inline.

---

*The goal is not to prove the product is good. The goal is to discover whether it actually is. — X1 protocol v1.0, locked at first session.*
