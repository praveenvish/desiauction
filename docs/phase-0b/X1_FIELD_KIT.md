# X1 FIELD KIT — FOUNDER EXECUTION PACKAGE
*Print this or keep it open. It is self-contained: if every other document is left behind, this kit runs the study.*

**The whole study in one line:** show a stranger the screen for 5 seconds → let them explore for 5 → give them 7 small tasks on a phone → ask 8 neutral questions → call them in 48 hours → write down only what actually happened.

---

## 0 · ONE-TIME PREP (do once, before any participant — ~30 min)

```
□ Laptop + one Android phone charged; both on the SAME Wi-Fi
□ Terminal: cd ~/Desktop/desiauction-next/prototypes/va1 && python3 -m http.server 8477
□ Laptop test: open http://localhost:8477/stage.html — auction runs by itself
□ Get laptop IP: ipconfig getifaddr en0   → phone URL: http://<IP>:8477/owner.html
□ Phone test: Owner Room loads, no sideways scrolling, green Bid button fully visible
□ WARM-UP (record it on your phone camera):
   □ On phone: wait for a big-money duel (₹5L+), press-AND-HOLD the bid button ~1s
     until it fills and commits — it must place the bid
   □ On laptop cockpit (localhost:8477/cockpit.html): press O to open a lot,
     then HOLD the Space bar ~1s on "Hold to close lot" — lot must close
   □ On phone: tap ⚙ → Disconnect → watch 3 steps appear:
     "Signal lost → Rejoining → Caught up" — all three must show
   □ Tap ⚙ → "Unsold next" → next player must pass quietly, nothing red
   □ On laptop stage: let a lot finish and wait — screen should rest calmly
     showing "Next on the block…"
   □ ANY of these broken? STOP. Do not run sessions. Fix first.
□ Speed check: laptop Chrome (window visible, clicked-on) → let one gold SOLD
  ceremony play — must look smooth, no stutter
□ Print: 1 workbook (§4) per participant + cheat sheet (§2)
□ Recording setup test: phone camera on stand behind participant's shoulder
  (captures screen + hands) + QuickTime screen recording on laptop. Test both once.
□ Chai/snacks + ₹200–500 per participant ready
```

## 0.5 · WHO SITS WHEN (fill names in; don't rearrange letters)

| P# | Who | First look | Motion | Name / phone |
|----|-----|-----------|--------|--------------|
| P-F | You (founder) — practice run, counts separately | A | Full | — |
| P1 | Organizer | A | Full | |
| P2 | Owner-type | B | Full | |
| P3 | Player | A | Full | |
| P4 | Anyone (no cricket-admin ties) | B | Full | |
| P5 | Organizer | B | Full | |
| P6 | Owner-type | A | Full | |
| P7 | Player | B | **Reduced** | |
| P8 | Anyone | A | **Reduced** | |
| P9 | Organizer | A | Full | |
| P10 | Owner-type | B | Full | |

*Minimum to finish the study: P1–P6 done, including 2 organizers.*

---

## 1 · SESSION CHECKLIST (run down this list every single time)

**BEFORE participant enters:**
```
□ Room quiet, one chair in front of laptop, no spectators
□ Fresh INCOGNITO window (⌘⇧N) — every participant, no exceptions
□ Open http://localhost:8477/stage.html in the incognito window
□ Click ⚙ once: Direction = this participant's letter (table above)
                Motion = Full (or Reduced for P7/P8)
□ Close the ⚙ drawer
□ Wait until: a player is up, at least 2 bids showing, timer above 10
□ GLANCE: timer ring normal color at start? (If orange/amber right at lot
  start: screenshot it, note it, reload page)
□ Cover the screen with a sheet of paper
□ Phone: open http://<IP>:8477/owner.html in Chrome incognito, ⚙ same
  direction, leave it face-down on the table
□ Start BOTH recordings (camera + QuickTime)
□ Workbook page 1: write P#, date, direction, motion
```

**DURING (follow the timer, §5):**
```
□ Welcome + consent said word-for-word (§2 cheat sheet)
□ Five-second test done (exactly 5.0s on stopwatch)
□ First words written VERBATIM before anything else
□ 4 follow-up probes asked
□ Free exploration — 5 min, you stay silent
□ Phone tasks T1–T7 (§2 exact lines)
□ Trust test on laptop
□ Two-looks comparison (second incognito window)
□ 8 interview questions
□ Friend-question close
□ 48-hour call scheduled IN THEIR PHONE before they leave
```

**AFTER participant leaves:** → §8 post-session checklist.

---

## 2 · MODERATOR CHEAT SHEET (the one page to keep in hand)

**SAY (word-for-word):**
- Opening: *"Thanks for giving me half an hour. I'm going to show you something and ask what you think. Two things: **I did not design this** — so be blunt, you can't hurt my feelings. And there are no wrong answers — if something confuses you, the thing is wrong, not you. I'll record the screen and your voice — stays with us, never published. Okay? I'll also call you for five minutes day after tomorrow. One rule for me: I'll mostly stay quiet — if I don't answer, your guess is exactly what I need."*
- Before 5-sec: *"I'll show you a screen for five seconds, then hide it. Don't try to read everything — just look. Ready?"*
- After 5-sec: *"Tell me everything going through your head — first thing first."* … *"What else?"*
- The 4 probes: *"What kind of thing is this?" · "What was happening on it?" · "Who do you think it's for?" · "What would you have done next?"*
- Exploration: *"Now it's yours — watch it or touch it, whatever you'd naturally do. Think out loud. I'll just watch."*
- Tasks (one at a time):
  T1 *"Take this phone. Tell me where you are and what's happening."* «बताइए आप कहाँ हैं और क्या हो रहा है?»
  T2 *"When you're ready, take part."* «जब तैयार हों, हिस्सा लीजिए।»
  T3 (after a rival outbids them) *"What just happened?"*
  T4 (YOU silently tap ⚙→Disconnect→close drawer) *"What's going on? … Where do things stand now?"* «अब चीज़ें कहाँ हैं?»
  T5 (after a SOLD — watch their face FIRST) *"What was that moment? Too much, about right, or too little?"* «वो क्या था? ज़्यादा, ठीक, या कम?»
  T6 *"Get back to where you can bid again."*
  T7 *"Do whatever you'd do next if this were your team's real auction night."*
- Trust test (laptop): *"Using only what's on this screen: who bought [name from the strip at the bottom], for how much — and how sure are you that it's final? Say it like you're settling an argument between two friends."*
- Comparison: *"Same product, two looks. No right answer: which would you trust with your team's money, and why? … If a tournament ran on the left one, what would that cost the organizer? And the right one?"*
- Close: *"If a friend asked tomorrow what I showed you, what would you tell them in one or two sentences?"*

**NEVER SAY:** what the product is · what anything on screen means · "did you like it" · "premium/beautiful/exciting" or ANY feeling-word before they say it · "yes exactly / good / well done" · why anything was designed some way · which look "is ours."

**IF THEY ASK YOU SOMETHING:** *"What do you think it is?"* / *"Whatever you'd naturally do."* / *"Good question — noting it."*

**SILENCE RULE:** after every question — count 5 in your head before speaking again. Their silence produces the answer; yours doesn't spoil it.

**COMMON MISTAKES:** rescuing a stuck participant too early (wait 90s, then "Let's leave that one — next") · nodding at answers you like · explaining the disconnect ("don't worry, it's simulated") — say nothing, that's the test · writing summaries instead of their exact words.

**EMERGENCY LINE (anything breaks):** *"One moment."* — fix silently or move to the next block. Never apologize for the product.

---

## 3 · PARTICIPANT PACKET (everything the participant gets)

Participants receive NOTHING written before the session (reading changes first impressions). They receive verbally: the opening script (§2), chai/snack, honorarium at the end (*"for your time — not your praise"*), and the 48-hour call booking. If someone insists on a written note afterwards:

> *"You looked at an early test version of a sports-tournament tool and told us what you saw. Nothing was real; no money moved. We'll call once, day after tomorrow, for five minutes. Thank you."*

---

## 4 · OBSERVATION WORKBOOK (print one per participant; write big, write verbatim)

```
P# ____  Group ____________  Direction A / B   Motion Full / Reduced
Date _______  Start time _______  Recording files: cam ____________ screen ____________
Reset done: incognito □  direction verified □  motion verified □  duel live □  ring color ok □
Deviations from script (write ANY, even small): _none □_ or: ______________________________

── FIVE-SECOND TEST ────────────────────────────────────────────
First words (exact, in order):
____________________________________________________________________
____________________________________________________________________
"What else?": ______________________________________________________
Probe 1 what-is-it: ________________________________________________
Probe 2 what-was-happening (player? price? who's winning?):
____________________________________________________________________
Probe 3 who-for: ___________________________________________________
Probe 4 do-next: ___________________________________________________
Premium-type word used on their own? NO □  YES □ word: _____________
Understood it's a player auction?  YES □  ROUGHLY □  NO □

── FREE EXPLORATION (5 min) ────────────────────────────────────
What they did first: _______________________________________________
Quotes (exact):
____________________________________________________________________
____________________________________________________________________
Confusion moments: _________________________________________________
Unexpected: ________________________________________________________

── PHONE TASKS ─────────────────────────────────────────────────
T1 orient      time to "gets it": ____s   quote: __________________
T2 bid         first tap was Bid button? Y □ N □  wrong taps: ___
               "take part"→bid placed: ____s
T3 outbid      what they said: _____________________________________
T4 disconnect  reaction (exact words): _____________________________
               reconnect → states purse+leader: ____s  correct? Y/N
T5 ceremony    face/body BEFORE question: smile □ lean-in □ said
               something □ (what: ______________) nothing □
               too much □  about right □  too little □
T6 return      managed alone? Y □ N □
T7 natural     what they did: ______________________________________
Any moment they laughed AT a person on screen / seemed embarrassed
BY the screen?  NO □  YES □ describe: ______________________________

── TRUST TEST ──────────────────────────────────────────────────
Time to confident answer: ____s   Correct? Y □ N □
What they pointed at as proof: _____________________________________
"How sure it's final" (their words): _______________________________

── TWO LOOKS ───────────────────────────────────────────────────
Trust-with-money choice: A □ B □   why (exact): ____________________
Price guess — A: ₹________   B: ₹________

── INTERVIEW (exact words, short) ──────────────────────────────
1 stood out: _______________________________________________________
2 confused: ________________________________________________________
3 expect next: _____________________________________________________
4 made you trust: __________________________________________________
5 made you hesitate: _______________________________________________
6 will remember: ___________________________________________________
7 (organizer) running yours on this: _______________________________
8 (owner) auction-night worries: ___________________________________
Friend-question answer: ____________________________________________

── 48-HOUR CALL (date ____ time ____) ──────────────────────────
Remembers (unprompted): ____________________________________________
One image: _________________________________________________________
One sentence: ______________________________________________________
Would recognize by: ________________________________________________
Feeling left: ______________________________________________________
After call, tick: gold/SOLD moment recalled □  money/record/proof
recalled □  said "player auction" □  named something distinctive □
```

---

## 5 · SESSION TIMER (keep phone stopwatch running from welcome)

```
00:00  Welcome + consent (screen stays covered)
02:00  Five-second test (5.0s exactly) → verbatim capture
04:00  The 4 probes
05:00  Free exploration — YOU ARE SILENT
10:00  Hand phone → T1, T2, T3
14:00  T4 disconnect (you trigger it silently)
16:00  T5 ceremony, T6, T7
17:00  Trust test (back to laptop)
20:00  Two-looks comparison
23:00  Interview (8 questions)
28:00  Friend question + book the 48h call in their phone
30:00  They leave → §8 immediately, before anything else
```
Running long? Cut §5-min exploration to 3 and drop task T6 — never cut the five-second capture, T4, T5, or the trust test.

---

## 6 · FACILITATOR FAQ

| Situation | Do this |
|---|---|
| Participant asks for help | *"Whatever you'd naturally do."* Wait 90s. Then: *"Let's leave that one — next."* Log it as a fail — a fail is good data. |
| Participant confused/frustrated | Stay calm, don't rescue, don't apologize for the product. Confusion IS the finding. If they're genuinely upset: end tasks, go to interview, log deviation. |
| Prototype breaks mid-session | *"One moment."* Reload the page (same incognito window, re-check ⚙). Log deviation + what broke + timestamp. If broken twice: end tasks, run interview on what they saw, log session as partial. |
| Recording fails / forgot to start | Continue; write DOUBLE verbatims. Log deviation "no recording from __ to __". Never re-stage a moment for the camera. |
| Session runs long | Use §5 cut order. Never rush the five-second capture. |
| Participant skips / won't answer a question | *"No problem."* Write "declined". Never rephrase into a leading version. |
| You accidentally explain/defend something | It happens. Write EXACTLY what you said in the deviations box. That answer from that participant is tainted for that topic — the sheet says so, the Board decides. |
| Phone battery dies | Swap to any Android phone on the Wi-Fi → same URL, incognito, re-check ⚙. Log deviation. |
| Wi-Fi/internet drops | The prototype runs locally — laptop pages survive. Phone needs the laptop's Wi-Fi only (no internet needed beyond fonts already loaded): reconnect Wi-Fi, reload. If fonts look wrong after reload (no internet), log "fallback fonts" — it matters for the look-judgment tasks. |
| Participant recognizes it / heard about it from a friend | Ask what they heard, write it down, run the session anyway, flag sheet "prior exposure". |
| They want to keep playing afterwards | Let them! Off the clock, after the interview. Anything interesting they say goes in "unexpected". |

---

## 7 · EVIDENCE PACKAGING GUIDE

```
Folder:  desiauction-next/docs/phase-0b/x1-evidence/
Sheets:  P1.md, P2.md … P-F.md        (typed from workbook, same headings)
Photos:  P1_photo1.jpg …               (only if something on screen needed capturing)
Recordings (NOT in git — too big):
         one folder on this laptop or Drive:  X1-recordings/
         files: P1_cam.mp4, P1_screen.mov …
         put the exact path/link on the sheet's "Recording files" line
Dashboard: update x1-evidence/DASHBOARD.md counts after every session
Commit after EVERY session (this is the chain of custody):
         git add docs/phase-0b/x1-evidence/
         git commit -m "X1 evidence: P3 session complete (organizer, dir A)"
48h update = second commit: "X1 evidence: P3 48h recall added"
Never edit a sheet after its commit except to ADD the 48h section or a
correction marked  [CORRECTION added <date>: …]  — never silently rewrite.
```

## 8 · POST-SESSION CHECKLIST (the 5 minutes right after they leave)

```
□ Stop both recordings; rename files to P#_cam / P#_screen
□ Read the workbook top to bottom NOW — fill gaps from fresh memory
  (mark anything reconstructed with "(from memory)")
□ Quotes legible and in the language actually spoken
□ Deviations box honest (empty box = you're claiming a perfect session)
□ Type sheet → x1-evidence/P#.md
□ Recording paths pasted onto the sheet
□ Photos renamed and moved
□ DASHBOARD.md counts updated
□ git commit (message format in §7)
□ Backup recordings folder to Drive/pendrive
□ 48-hour reminder set in YOUR phone (exact time agreed)
□ Do NOT discuss findings with anyone yet — including yourself in writing;
  no conclusions until all sessions finish
```

## 9 · 48-HOUR FOLLOW-UP SCRIPT

**Phone (preferred), exact wording:**
> "Hi ___, as promised — five minutes about the thing I showed you. No right answers, whatever comes to mind.
> 1. What do you remember from it? *(let them finish fully — "what else?" once)*
> 2. Is there one image that stayed with you?
> 3. If you described it to someone in one sentence, what would you say?
> 4. If you saw it again among other apps, what would you recognize it by?
> 5. Any feeling left from it?
> That's all. Thank you — really useful."

**WhatsApp (fallback only if calls fail twice; copy-paste):**
> "Hi ___! As promised, 2-minute follow-up on what I showed you — reply in voice notes if easier: 1) What do you remember from it? 2) One image that stayed with you? 3) How would you describe it to a friend in one sentence? 4) What would you recognize it by? 5) Any feeling left?"

Unreachable? Two attempts on different days, then write "unreachable ×2" on the sheet and commit.

## 10 · RESEARCH DASHBOARD (live copy at `x1-evidence/DASHBOARD.md` — update after every session)

| Measure | Target | Now |
|---|---|---|
| Neutral participants completed | 6–10 | 0 |
| — organizers | ≥2 | 0 |
| — owner-types | ≥2 planned | 0 |
| — players / general | 2 + 2 planned | 0 |
| Founder pilot (P-F) | 1 | 0 |
| Sheets typed & committed | = sessions | 0 |
| 48-hour recalls done | = sessions | 0 |
| Recording backups | = sessions | 0 |
| Open deviations (unlogged = 🔴) | 0 unlogged | — |
| Reduced-motion sessions (P7, P8) | 2 | 0 |
| **Packet status** | PACKET COMPLETE when ≥6 neutral (≥2 org) + P-F, all sheets + 48h done | **EMPTY** |

---

# TOP 10 EXECUTION MISTAKES THAT INVALIDATE THE RESEARCH

1. **Skipping the fresh incognito window.** Leftover settings silently change what the participant sees — their first impression is of the wrong thing, and you can't rerun a first impression. *Prevent:* it's the first checkbox, every time. *Recover:* if discovered mid-session, finish the session, mark the sheet "wrong direction/motion — five-second data void"; their task data may still count.
2. **Explaining the product before the five-second test.** One sentence ("it's for cricket auctions") destroys the study's first question. *Prevent:* the welcome script contains zero product words — read it, don't improvise. *Recover:* log exactly what you said; that participant's identification data is void; tasks still usable.
3. **Nodding, smiling, or "exactly!" at answers you like.** Participants steer toward whatever pleases you; every answer after that is about you. *Prevent:* flat face, count-5 silence, pen in hand. *Recover:* log it; treat subsequent opinions from that participant as low-confidence; behaviors still count.
4. **Rescuing a struggling participant.** You erase the exact failure the study exists to find. *Prevent:* 90-second rule taped to the laptop. *Recover:* log at what second you intervened; the task is a fail with a footnote, not a success.
5. **Writing summaries instead of exact words.** "She liked the gold screen" is your opinion; "अरे वाह, TV जैसा!" is evidence. *Prevent:* quote marks in the workbook; write in their language. *Recover:* within the hour, reconstruct from the recording — verbatim from tape is fine; from memory, mark "(from memory)".
6. **Running the comparison before the five-second test, or showing both looks early.** First exposure is the purest data point; contaminated order can't be undone. *Prevent:* the timer's order is fixed; comparison is always minute 20. *Recover:* mark five-second data void for that participant; recruit a replacement for their slot's direction.
7. **Skipping the 48-hour call.** Memory is the strongest evidence this study collects; day-of enthusiasm is the weakest. *Prevent:* book the call in THEIR phone before they leave + reminder in yours. *Recover:* call late (mark actual gap, e.g., "72h"); if unreachable ×2, write it — an incomplete truthful packet beats a padded one.
8. **Fixing or polishing the prototype between sessions.** Participants stop seeing the same thing; results can't be pooled. *Prevent:* no code/design changes until ALL sessions finish — only restarts of the same build (note the commit: baf6278+). *Recover:* if something was changed, log it; sessions split into "before/after" groups and the Board judges them separately.
9. **Analyzing out loud mid-study.** "Everyone loves B so far" biases how you moderate the rest (and what you notice). *Prevent:* §8's last checkbox — no conclusions, not even in your head-notes, until sessions end. *Recover:* write down the moment you noticed yourself doing it; hand the Board your raw sheets and let it weigh order effects.
10. **Testing only friends who'll be kind.** Ten polite cousins = zero evidence. *Prevent:* the quota table needs 2 strangers (P4, P8) and real organizers; the "I didn't design this — be blunt" line, honorarium framed as payment for time. *Recover:* if the panel turns out all-friendly, recruit 2–3 cold participants before calling the packet complete; note recruitment source per participant on the sheet.

*Kit v1.0 · 2026-07-12 · operational rendition of X1_RESEARCH_PROTOCOL.md — the protocol governs; this kit executes.*
