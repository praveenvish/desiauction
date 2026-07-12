# VA-1 REVIEW BOARD — Independent Panel Report

> Phase 0B evidence artifact · 2026-07-11 · reviews `prototypes/va1/` (commit baf6278) against `docs/EXPERIENCE_DIRECTION.md` §12 and the H1–H10 register (`prototypes/va1/README.md` §3)
> Mandate: judge evidence, not intent; not taste. The panel operated the instrument itself and did not modify it.

---

## 0 · The panel's first ruling: what kind of evidence exists

Every piece of evidence produced so far is **machine-level instrument verification** — screenshots, DOM probes, console checks, code inspection — produced during and immediately after the build, by the builder, plus this board's independent probes. **Zero human-judgment evidence exists.** No person has been observed reacting to any screen. H1–H10 are, almost without exception, *human-reaction* hypotheses.

Consequently the strongest claim the evidence supports today is: **the instrument works and is ready to be judged** — not that any experiential hypothesis is true. Any stronger claim would be evidence theater (Evidence Plan risk 0B-6).

## 1 · Evidence review

**Verified by observation (builder's session, screenshots on record):**
- Full 8-lot pool auto-ran to completion; duel ₹2L→₹8.25L; two UNSOLD outcomes rendered as neutral "passes" (EP-7 path exercised); order book accumulated; **purse arithmetic reconciled exactly across all sales** on every frame inspected.
- Anti-snipe "+12s" pop rendered at the ring on a late bid; timer never shrank (code + observation).
- A money value photographed mid-roll (state-transition motion, §9 "number travels").
- SOLD ceremony rendered in **both directions** (A: ink/volt/gold + Anek Devanagari; B: field-green/chalk/heritage gold + Tiro fallback) with correct composition (gold only at the earned moment; nothing shares the frame with the name).
- Owner Room: one tap on "Bid ₹3.5L" → "You lead", button self-disabled with reason (DOM-probe transcript on record).
- Cockpit: `O` opened Lot 01; live truth centered; attention rail "Nothing needs you"; zero console errors on all three pages; strict `tsc` clean.

**Verified independently by this board (own probes, this session):**
- **Reconnect narration (H9 mechanism)**: disconnect simulation produced the stepped overlay — "✓ Signal lost — your record is safe / ✓ Rejoining the auction… / Caught up" — rendering progressively, exactly as EP-10 specifies. Previously *claimed but never observed*; now observed.
- **Reduced-motion ceremony**: a natural SOLD fired while reduced motion was (unknowingly) active → the still-variant rendered complete information (XC-8 meaning-parity demonstrated, accidentally but genuinely).
- **fps readings under remote control are invalid**: meter read 4–5 fps and a `Runtime.evaluate` rAF probe timed out — the browser window is occluded during remote operation and Chrome throttles rendering. This is an artifact, not a defect; it means **no valid performance measurement exists yet** (H10).
- **Window-resize probe failed** (extension resize did not shrink the rendered viewport) → the **native sub-640px mobile layout has never been rendered by anyone**.
- **Session-contamination discovery**: `localStorage` silently persisted `direction=B` and `motion=reduced` from earlier fiddling — the board only noticed via the ⚙ drawer. A judging session started in this state would be invalid without anyone knowing.

**Build-discovered facts (legitimate evidence, already logged in README §5):**
- Flat ₹25k increments produced ~10-minute marquee duels; escalating ~8% slabs fixed pacing → first real evidence supporting doc 41's slab default.

## 2 · Hypothesis validation matrix

Verdict vocabulary: **Validated / Disproven / Inconclusive / Not tested — instrument ready / Not tested — instrument gap.**

| H | Hypothesis (short) | Actually tested? | Evidence produced | Verdict |
|---|---|---|---|---|
| H1 | Attention is instantly legible | No — needs 5 viewers | Stage renders one subject (frames) | **Not tested — instrument ready** |
| H2 | SOLD significant, not theatrical | No — needs reactions | Both ceremony *compositions* verified; **animated timing never watched by a human** (only stills + still-variant) | **Not tested — instrument ready**, with the motion-observation caveat |
| H3 | Owners trust phone bidding | No — VA-2 by design | Tap→lead mechanics verified (DOM probe); **native mobile layout unrendered**; ≥₹5L hold-to-bid **never exercised** | **Not tested — instrument gap** (two gaps named) |
| H4 | Cockpit calm under pressure | No — needs naïve operator | O-key conduct verified; attention rail verified; **hold-Space gavel never exercised** | **Not tested — instrument gap** (one gap) |
| H5 | Premium in 5 seconds | No | Frames exist; protocol exists | **Not tested — instrument ready** |
| H6 | One direction clearly wins | No | A/B switch works (both rendered) | **Not tested — instrument ready**, protocol gaps (§3 CF-3, CF-5) |
| H7 | Devanagari ceremony parity | Partially (machine level) | A: अर्जुन पवार at full display weight, equal presence to Latin (multiple frames incl. ceremony); B: Tiro fallback rendered with character but visibly lighter | **Inconclusive — machine evidence favors A; human verdict pending** |
| H8 | Anti-snipe felt as fairness | Mechanism only | "+12s" pop observed; never-shrink observed | **Not tested — instrument ready**; one unreproduced amber-ring frame logged (NC-2) |
| H9 | Narrated reconnect builds trust | Mechanism only — **verified by this board** | Stepped narration observed | **Not tested — instrument ready** (mechanism proven) |
| H10 | ≥50fps on mid-range Android | **No — and current readings are invalid** | Remote-control fps artifact documented | **Not tested — instrument gap** (needs foreground/real device) |

**Score: 0 validated · 0 disproven · 1 inconclusive-partial · 9 untested (6 instrument-ready, 3 with named instrument gaps).** This is the honest and *expected* state before human sessions; the register itself predicted it.

## 3 · Critical findings

**CF-1 · All experiential claims rest on the builder's own frames.**
*Interaction:* every screenshot in the build log. *Why it matters:* the Phase 0A audit's finding-zero (self-certification) recurs here in miniature; VA-1's entire purpose is external judgment. *Smallest experiment:* run X1 exactly as pre-registered — nothing else resolves this.

**CF-2 · VA-2 cannot run as designed on this instrument.**
*Interaction:* `src/sim.ts` `drive()/follow()` — BroadcastChannel is same-browser-profile only; VA-2 requires 6–8 real phones (README compromise #1 admits this). *Why it matters:* "proceed to VA-2" is the question on the table; today the answer is physically impossible as specified. *Smallest experiment:* a ~50-line WebSocket relay on the LAN **or** a founder ruling that VA-2 session 1 runs degraded (one phone via devtools + tabs). Decide before scheduling, not on the night.

**CF-3 · Judging sessions can be silently contaminated.**
*Interaction:* observed this session — `localStorage` held `dir=B, motion=reduced` without any visible indicator outside the drawer. *Why it matters:* first impressions are unrepeatable; an H5 session accidentally run in reduced motion or the wrong direction is unsalvageable data loss. *Smallest experiment (protocol, zero code):* each participant gets a **fresh incognito window**; the facilitator confirms direction + motion in the drawer before handoff, off camera.

**CF-4 · Both hold-to-commit interactions (EP-6's constitutional bet) have never been exercised by anyone.**
*Interaction:* Owner ≥₹5L hold-to-bid (600ms fill) and Cockpit hold-Space gavel (700ms). *Why it matters:* "money moves like stone" is a constitutional principle and an H3 criterion ("zero accidental holds"); if the fill interaction is broken or mistimed, VA-2's most important data is garbage. *Smallest experiment:* 3-minute facilitator warm-up at session start — ride a marquee duel past ₹5L and place one held bid; close one lot with held Space; on camera.

## 4 · Non-critical findings

- **NC-1** Cockpit's disabled "Open next lot" renders saturated enough to read as enabled (screenshot on record). Watch the naïve operator in VA-2; one-line CSS *if* it confuses them — not before.
- **NC-2** One unreproduced frame showed the countdown arc in closing-amber at ~20s after a lot transition (already logged, README §4.9). If it recurs during judging it contaminates H8 ("looks glitchy"); facilitator should note timer color at each lot-open.
- **NC-3** fps meter lives inside the ⚙ drawer, which overlays the ceremony while open — measuring H10 with the drawer open alters what's measured. Measure via devtools console (frame counter) instead.
- **NC-4** Outbid salience in the Owner Room is a leader-line flip + vibration only; under hall noise and adrenaline this may be too quiet — a VA-2 probe question, not a change.
- **NC-5** Stage rest state (EP-14) and pool-complete state ran in code but were never captured end-state; exercise once on camera (also feeds the builder-logged "dead air" tension).

## 5 · Evidence still missing (mapped to where it lands)

| Missing evidence | Produced by |
|---|---|
| Any human first reaction, per direction, counterbalanced | X1 sessions |
| Human Devanagari parity verdict (H7) | X1 (side-by-side ceremony frames scripted) |
| **Anyone watching the ceremony in motion** (all motion evidence is stills) | X1, first 5 minutes |
| Reduced-motion human parity ("same meaning?") | X1 (one participant runs reduced) |
| Native ≤640px layout render + tap targets | Real phone at X1 prep (2 minutes) |
| Valid fps on real mid-range Android | X1 prep (device + foreground) |
| Hold interactions exercised (CF-4) | X1 prep warm-up |
| Naïve operator run (H4) | VA-2 |
| All of H3 | VA-2 |
| Multi-device capability (CF-2) | Relay or ruling before VA-2 |

## 6 · Recommended changes

| Target | Recommendation |
|---|---|
| **VA-0** | **None.** No evidence collected justifies any constitutional change; the two builder-logged tensions (EP-14 dead-air, EP-6 hold friction) remain *probe questions*, correctly not amendments (XC-11). |
| **Prototype** | **None pre-X1.** CF-4 and the mobile render are *exercises*, not changes. Post-session: fix only what session evidence convicts (NC-1 candidate). CF-2's relay is new scope for VA-2 prep, not a change to this instrument — build it only after the founder's ruling. |
| **Neither (judging protocol addendum — zero code)** | (1) Fresh incognito window per participant (CF-3). (2) Counterbalance direction order A→B / B→A across participants — the register never specified order and H6 is order-sensitive. (3) Foreground fps via console on a real device (NC-3, H10). (4) Facilitator warm-up exercising holds, gavel, rest state, one disconnect (CF-4, NC-5). (5) Record timer color at lot-open (NC-2 watch). (6) 48-hour recall follow-up already specified — schedule it at session time, not after. |

## 7 · Perspective notes (six chairs, evidence-only)

- **Founder:** you can judge this today — one command, three tabs, direction toggle; the five-second test is runnable exactly as pre-registered. What you cannot yet do is claim anything from it.
- **Tournament Organizer:** the Cockpit showed one decision, a truthful center, and "Nothing needs you" — the calm thesis is *plausibly instrumented*; whether a volunteer feels it is VA-2's question. The disabled-button ambiguity (NC-1) is the one thing the panel would watch first.
- **Team Owner:** the bid loop is honest — label = consequence, lead state unambiguous, purse math exact. The unexercised ≥₹5L hold (CF-4) is exactly where an owner's trust would break if it misfires; test it before any owner touches it.
- **Player:** the name — in both scripts — is the largest thing on the screen at the peak, and UNSOLD passed without a trace of red or ridicule in every observed frame. The dignity constitution is holding in the instrument. A Hindi-speaking viewer must still say so themselves (H7).
- **Enterprise UX Director:** the pre-registered register with failure criteria is above industry practice; the contamination discovery (CF-3) is the kind of validity threat that silently ruins studies — fixing it costs a sentence in the script.
- **CTO:** quarantine held (`prototypes/` imports nothing, nothing imports it); strict TS; committed bundles; the sim implements the actual constitutional rules (never-shrink verified). The BroadcastChannel limitation was disclosed honestly in the README, but the panel elevates it: it blocks VA-2, so it is a scheduling gate, not a footnote.

## 8 · Verdict

# **GO WITH CONDITIONS**

The instrument is real, functional, honest about its rules, and ready for judgment. No hypothesis is validated — as expected — and nothing observed disproves the Experience Direction.

**Conditions (all cheap, all before or at the named step):**

| # | Condition | Gate it blocks |
|---|---|---|
| G1 | Run X1 founder sessions per the pre-registered protocol **+ §6 protocol addendum** (incognito, counterbalancing, warm-up, device fps) | Everything downstream |
| G2 | CF-2 ruling: LAN relay (~50 lines, VA-2 prep scope) **or** founder-approved degraded session design | VA-2 scheduling |
| G3 | CF-4 warm-up: both hold interactions + rest state + one disconnect exercised on camera before participants arrive | X1/VA-2 data validity |
| G4 | Real-device render check (≤640px layout + foreground fps) at X1 prep | H3/H10 validity |

**"Has the prototype earned the right to proceed to VA-2 (Mock Auction)?"**

**Not directly — it has earned the right to X1, which is the gate to VA-2.** On observed evidence alone: the auction loop, ceremonies, conduct surface, bid mechanics, and recovery narration all demonstrably function, which is precisely the entry ticket to human judgment — and no more. VA-2 additionally requires a multi-device capability this instrument does not yet have (CF-2) and first-impression data it cannot generate about itself (CF-1). Clear G1–G4 — none of which takes more than a day — and VA-2 is earned.

*VA-1 Review Board · 2026-07-11 · verdicts recorded against pre-registered criteria; no criteria were edited.*
