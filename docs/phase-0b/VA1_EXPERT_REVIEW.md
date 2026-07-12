# VA-1 EXPERT DESIGN REVIEW BOARD — Browser-First Review

> Phase 0B artifact · 2026-07-12 · reviews `prototypes/va1/` (build baf6278 + committed fixes) in a live browser
> Method: direct observation only — pages operated, controls clicked, keyboard driven, events dispatched, contrast computed from actual token values, source inspected. **No simulated users. No invented reactions.** Where a conclusion needs humans: REQUIRES HUMAN VALIDATION. Where the channel couldn't observe: INSUFFICIENT EVIDENCE.
> Evidence base: two browser sessions (Direction A full pass, earlier, screenshots on record; Direction B full pass + interaction probes, this session), plus code inspection and WCAG arithmetic.

---

## 1 · Executive summary

The prototype is functionally solid under expert interrogation: the auction loop, purse arithmetic, anti-snipe, ceremonies (both directions), narrated recovery, double-fire defense, keyboard gavel, and focus-visible all behaved correctly when operated. The board found **no Critical defects**. It found **two High issues that must be fixed before human sessions** (a Direction-B layout collision at the heart of the judged surface, and reduced-motion silently disabling the large-bid confirmation — an accessibility-vs-money-safety conflict), plus a cluster of Medium issues that are cheap now and expensive after humans see them (contrast tokens below AA, silent hold-cancel, focus-dependent keyboard conduct, "₹0" as an idle money display). Verdict: **READY WITH MINOR FIXES** — fix, freeze, then test humans.

## 2 · Independent reviewer reports

### Reviewer 1 — Chief Product Officer
- **F-CPO-1 · Medium · Information Architecture** · Cockpit, desktop, idle state. *Observed:* center panel reads "No lot on the block" with a huge **"₹0"** beneath (screenshot, Dir B idle). *Why:* the product's constitution treats money display as fact; ₹0 is not a fact here, it's a null. An operator glancing pre-auction sees a money value with no referent. *Experiment:* render the idle money as absence ("—") in a 1-line change, confirm no operator mis-read in X1's cockpit block.
- **F-CPO-2 · Low · Copy** · Stage, order book. *Observed:* unsold entries read "passes" in muted type (Dir A session, Lot 08 frame). Correct and dignified. *Why:* recorded as a positive check against the dignity requirement — no action needed.
- **F-CPO-3 · REQUIRES HUMAN VALIDATION** · Whether Direction B's "heritage" reading communicates *tournament seriousness* better than A's "broadcast" reading to actual organizers. Expert opinion is split (see §3 conflicts) and worthless here.

### Reviewer 2 — Head of Design
- **F-HD-1 · High · Visual** · Owner Room, Direction B, live lot. *Observed:* "Rohit Deshmukh" in the serif display collides with/underruns the countdown ring (screenshot ss_6566pjg10); the same name clears the ring in Direction A. Longer real names will collide worse. *Why:* this is the primary judged surface in X1; a layout bug will read as "Direction B is broken," contaminating H6 with noise that isn't a design-language property. *Experiment:* clamp/scale or wrap the name (instrument fix), re-render the same lot in both directions.
- **F-HD-2 · Medium · Consistency** · Stage + Owner + Cockpit, Direction B. *Observed:* B's everyday accent IS gold (#E8C46A) — live bid amount, countdown ring, primary buttons — while ceremony gold (#F1D48A/#B98A2F) is a near-identical warmer tier (Stage-B live frame vs B ceremony frame). *Why:* "gold is earned, never decorative" is chromatically enforced in A (volt ≠ gold) and diluted by construction in B; if B wins X1, the law needs a B-compatible enforcement. *Experiment:* show both B frames side by side to the founder at X1 prep — can he tell the earned gold from the ambient gold in 2 seconds?
- **F-HD-3 · Low · Visual** · Cockpit, both directions, disabled primary. *Observed:* disabled "Open next lot" retains high saturation (A: olive-volt, ss_30233ggr9; B: full gold, ss_343841uds) — reads closer to enabled than disabled. *Why:* the operator's one-decision panel must never be ambiguous about what is pressable. *Experiment:* watch the X1 organizer cockpit block; if any participant presses it while disabled, fix.
- **F-HD-4 · Cosmetic · Visual** · Stage, both directions. *Observed:* money mid-roll frames (₹1.02L, ₹7.58L) — the rolling number works as designed; no typographic defects observed at any size, including Devanagari at ticker size.

### Reviewer 3 — Senior UX Designer
- **F-UX-1 · Medium · Interaction** · Cockpit, keyboard conduct. *Observed:* after page navigation, `O` silently did nothing (phase stayed Ready); after one click inside the page, the identical keypress worked (probe: `focused: BODY`, then phase → Live). Root cause: keystrokes require document focus; nothing indicates focus state. *Why:* a real operator will alt-tab mid-auction and return; a silently dead keyboard during a live lot is an operator-panic scenario. *Experiment:* X1 cockpit block — have the organizer switch apps once and return; if they stall, the instrument needs a focus indicator before VA-2.
- **F-UX-2 · Medium · Interaction** · Owner + Cockpit hold-to-commit. *Observed:* releasing a hold before completion cancels with **zero feedback** — fill resets silently (gavel probe: 950ms hold + release = nothing; 2.5s hold = lot closed). *Why:* a user who "held long enough" by feel and got nothing cannot tell whether the system failed or they did — during the money moment. *Experiment:* count silent-cancel events in VA-2 timing data; ≥2 occurrences → add a released-too-early cue.
- **F-UX-3 · Low · Interaction** · Owner Room, rapid input. *Observed:* two pointer-downs 60ms apart produced exactly one bid; second rejected by the leader guard (probe: recent rows 1→2, "You lead at ₹2.25L", disabled). Double-fire defended. Positive check.
- **F-UX-4 · Low · Interaction** · Stage/Owner ⚙ drawer in driven mode. *Observed (code + logic):* simulate buttons call `wire.local()` which is null when a Cockpit drives — silent no-ops. *Why:* facilitator confusion in multi-tab demos. *Experiment:* one press on a driven tab at X1 prep; gray the buttons if it confuses.
- **F-UX-5 · Medium · Interaction** · Owner Room, hold threshold. *Observed:* button correctly flips to "HOLD TO CONFIRM" past ₹5L in a live duel (ss_0121fse7s, "Bid ₹8.25L"); the **touch**-hold commit on a real phone remains unexercised by anyone. *Why:* EP-6's constitutional bet; scheduled field-kit warm-up item. INSUFFICIENT EVIDENCE until the device exercise.

### Reviewer 4 — Accessibility Specialist
- **F-AX-1 · High · Accessibility** · Owner Room, reduced-motion mode. *Observed (code, `owner.ts`/`shared.ts`):* `needHold = price ≥ 5L && !reduced()` and `holdButton.start(): if (reduced()) { onCommit(); return; }` — **reduced-motion users get one-tap commits on large bids; the hold safeguard is bypassed entirely.** *Why:* users most likely to need reduced motion lose the money-error protection, and P7/P8's X1 sessions would test a different interaction than everyone else's. The fill *animation* is motion; the *time requirement* is not — the accessibility accommodation was applied to the wrong layer. *Experiment:* keep the time gate under reduced motion with non-animated progress (numeral), verify with one reduced-motion participant.
- **F-AX-2 · Medium · Accessibility** · All surfaces. *Measured (WCAG arithmetic on actual tokens):* Direction A `--text-faint` #5A6578 on #07090F = **3.38:1** — fails AA (4.5:1) at normal sizes; used for "Base price" labels, queue prices, hints. Direction B faint #7E8F7F on #0B2E24 = **4.28:1** — marginal fail. Dim tiers pass (A 7.06:1, B 5.46:1); volt/gold accents pass (14–15:1). *Why:* doc 13 declares AA a launch gate; the faint tier fails it in both directions today. *Experiment:* nudge two token values to ≥4.5:1, re-render.
- **F-AX-3 · Low · Accessibility** · Owner Room, keyboard. *Observed:* Tab focuses the bid button with a visible 2px accent `:focus-visible` outline (probe: matches true, 2px solid). Positive check.
- **F-AX-4 · INSUFFICIENT EVIDENCE** · Screen-reader announcement quality (live-region coalescing under bid storms) — not judgeable from this channel; structural wiring present (`#a11y` polite region, role=timer). One VoiceOver pass at X1 prep.
- **F-AX-5 · Low · Accessibility** · Touch targets. *Observed:* bid button generous; ⚙ toggle 38px — under the 44px guideline, facilitator-only control. *Experiment:* one mis-tap observation at prep decides.

### Reviewer 5 — Frontend Performance Engineer
- **F-PE-1 · Medium · Performance** · Hold-to-commit under frame starvation. *Observed:* with the window occluded (remote control), a 950ms real-time hold failed to commit — commit fires on the first rAF after the 700ms threshold, and frames arrived at multi-hundred-ms intervals; 2.5s succeeded. *Why:* commitment is elapsed-time-checked but frame-delivered; on a janky low-end phone the fill lags wall time and an on-time release produces F-UX-2's silent cancel. *Experiment:* at the field-kit device check, run one held bid under 6× CPU throttle; measure fill lag.
- **F-PE-2 · Low · Performance** · fps instrumentation. *Observed:* meter read 4–5 fps under remote control (occluded-window rAF throttling; a JS rAF probe also timed out) — readings invalid in that state; the meter also lives inside the drawer, which overlays the ceremony it would measure. *Why:* H10 needs numbers this channel cannot produce. INSUFFICIENT EVIDENCE; real-device measurement scheduled.
- **F-PE-3 · Low · Performance** · Layout stability. *Observed:* no cumulative layout shift across ~20 screenshots (tabular numerals hold money width; ceremony is a full overlay; order-book entries animate in place). One transient: a single frame showed the countdown arc in closing-amber at ~20s (unreproduced across two sessions; NC-2 watch continues).
- **F-PE-4 · Low · Technical** · One DOM read showed `#cur` lagging authoritative state ("₹2L" vs button's "₹2.25L", 600ms post-bid); unreproduced, possibly probe-timing. *Experiment:* escalate only if an X1 participant reads a stale number aloud.

### Reviewer 6 — CTO
- **F-CTO-1 · Medium · Engineering** · Cross-device capability. *Observed (code):* sync is BroadcastChannel — same browser profile only; VA-2's 6–8 phones cannot join. Known (Review Board CF-2), re-confirmed; ruling still open. *Experiment:* the ~50-line LAN relay decision before VA-2 scheduling.
- **F-CTO-2 · Low · Engineering** · Quarantine + hygiene. *Observed:* `prototypes/` imports nothing and nothing imports it; strict tsc clean; committed bundles run without tooling; **zero console errors across both directions and all three pages over two sessions.** Positive check.
- **F-CTO-3 · Low · Technical** · Driver takeover. *Observed (code + prior fix):* follower drops its local sim via `stop()` on takeover; not re-exercised multi-tab this session. *Experiment:* one two-tab check at X1 prep.
- **F-CTO-4 · Cosmetic · Technical** · The `still` ceremony variant is runtime-selected by `reduced()`; forced-DOM probes bypassed it — instrument note for anyone reading probe transcripts; no product implication.

## 3 · Merged findings register

| ID | Sev | Class | One-line | Action before humans? |
|---|---|---|---|---|
| F-HD-1 | **High** | Visual | Owner-B name/ring collision on the judged surface | **Fix** |
| F-AX-1 | **High** | Accessibility | Reduced motion removes the large-bid hold safeguard | **Fix** (P7/P8 validity + money safety) |
| F-AX-2 | Medium | Accessibility | Faint text tier fails AA both directions (3.38 / 4.28:1) | **Fix** (two token values; 13 declares AA law) |
| F-CPO-1 | Medium | IA | Idle Cockpit renders "₹0" as a money fact | **Fix** (1 line) |
| F-UX-1 | Medium | Interaction | Keyboard conduct silently dead without page focus | Watch X1 cockpit block; fix if operator stalls |
| F-UX-2 | Medium | Interaction | Early hold-release cancels with zero feedback | Watch VA-2 timing data |
| F-PE-1 | Medium | Performance | Hold fill lags wall-time under frame starvation | Device-check measurement |
| F-HD-2 | Medium | Consistency | B's ambient gold dilutes "gold is earned" | Founder 2-second check; decide only if B wins |
| F-CTO-1 | Medium | Engineering | No multi-device path for VA-2 | Ruling before VA-2 |
| F-UX-5 | Medium | Interaction | Touch-hold unexercised on real phone | Field-kit warm-up (scheduled) |
| F-HD-3 / F-AX-5 / F-UX-4 / F-PE-2 / F-PE-3 / F-PE-4 / F-CTO-3 | Low | — | disabled-primary reads enabled · 38px toggle · driven-mode no-op buttons · fps invalid remotely · amber transient · stale read ×1 · takeover re-check | Watch/prep items |
| Positive checks | — | — | dignity rendering · double-fire defense · focus-visible · quarantine/zero-errors · layout stability | — |

**Duplicates:** F-PE-1 and F-UX-2 share one root (frame-delivered commit) — kept as mechanism vs symptom. A Head-of-Design "faint labels feel weak" note merged into F-AX-2 (same tokens).
**Conflicting opinions:** CPO vs HD on B's ambient gold — law-dilution flaw vs heritage-trust feature: unresolvable by experts, it *is* H6 → REQUIRES HUMAN VALIDATION. UX vs PE on hold friction at duel peak: it is H3 → REQUIRES HUMAN VALIDATION.

## 4 · Priorities

**Top issues:** 1 F-HD-1 · 2 F-AX-1 · 3 F-AX-2 · 4 F-CPO-1 · 5 F-UX-1 · 6 F-CTO-1 · 7 F-UX-2 · 8 F-PE-1 · 9 F-HD-2 · 10 F-UX-5 · then Lows.
**Quick wins (≤ a few lines each, before freeze):** name clamp (F-HD-1) · keep time-gate under reduced motion (F-AX-1) · two contrast tokens (F-AX-2) · idle "—" (F-CPO-1) · optionally disabled-opacity (F-HD-3).
**Long-term (evidence-gated, post-X1):** B gold-law enforcement if B wins · hold-cancel feedback · conduct-surface focus indicator · VA-2 relay.

## 5 · Evidence still missing (beyond this channel)

Mobile-viewport rendering (extension window-resize ineffective twice — INSUFFICIENT EVIDENCE; real phone at prep) · real fps under throttle · screen-reader pass · touch-hold on device · end-of-pool Stage rest frame · and everything human — premium, trust, memory, excitement, ceremony judgment — REQUIRES HUMAN VALIDATION (X1/VA-2).

## 6 · Readiness assessment

# **READY WITH MINOR FIXES**

No Critical findings; the interaction core survived adversarial operation (double-fire, gavel, recovery, focus). Blocking-for-humans items are exactly four small fixes — **F-HD-1** (a judged-surface layout bug that would masquerade as a design-direction failure), **F-AX-1** (money safety removed for the two scheduled reduced-motion participants), **F-AX-2** (spec-declared AA violations), **F-CPO-1** (a false money fact on the operator's screen) — plus the standing **F-CTO-1** ruling before VA-2. Apply the four fixes, re-run the 10-minute self-check (both directions, one ceremony, one held bid, one disconnect), **freeze the build per field-kit mistake #8**, then bring humans.

*Expert Design Review Board · 2026-07-12 · every finding from direct observation, measurement, or cited source; human questions left to humans.*
