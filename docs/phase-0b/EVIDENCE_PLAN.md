# PHASE 0B — EVIDENCE GENERATION & VALIDATION PLAN

> Product Evidence Board · 2026-07-11 · follows Phase 0A audit (`docs/reviews/phase-0a-cto-audit.md`, verdict HOLD)
> Purpose: transform the Product Operating System's assumptions into evidence via the **smallest activities that produce the strongest proof**. Every item below states what uncertainty it removes. When an activity's evidence lands, it is recorded in §11 (Evidence Ledger) — this file is the single Phase 0B artifact.
> Rule of this phase: **a documented decision is not evidence.** Behavioural and numerical evidence outrank opinion; failure criteria are pre-registered so activities cannot be quietly reinterpreted as successes.

---

## 1 · Executive summary

Phase 0A held implementation on seven blocking conditions (B1–B7). This plan discharges all seven through **nine activities (VA-1…VA-9), 2–4 weeks calendar, mostly parallel, near-zero cash cost**. Three are executable immediately by the CTO-AI (prototype build, cost model research, spec repairs pending founder sign-off); three need the founder's decisions or time (workshop, interviews, mock auction); one is an external procurement start (WhatsApp BSP). The plan also adds one activity 0A did not mandate — a 2-day engine tracer-bullet benchmark — because it is the cheapest possible test of the architecture's single load-bearing number (20ms p99) before teams build on it.

The three Critical uncertainties, and their kill-shots:
- **Does FLOODLIGHT actually look exceptional?** → VA-1 rendered prototype, judged blind (B1).
- **Will real people bid from phones?** → VA-2 mock auction night with behavioural metrics (B2).
- **Does the business model clear margin?** → VA-3 unit-economics model with live vendor quotes + VA-4 organizer price panel (B3).

Verdict at end of this document: **HOLD maintained** — designing evidence is not producing it — with a defined conversion: when §10 exit criteria are met, the verdict converts to GO without a new phase of deliberation.

---

## 2 · Assumption & Evidence Register

One register serves Objectives 1 and 2: each row is an assumption **and** its evidence plan. Confidence is 0–100 (today, evidence-weighted — spec quality alone caps at ~50). "→VA-n" = the activity that raises it. **Bold rows block implementation.** Owner and priority live on the activities (§3); risk-if-wrong is the register's last column.

### Product assumptions

| ID | Assumption | Why it exists | Current evidence | Conf | Missing → activity | Risk if wrong |
|----|------------|---------------|------------------|------|--------------------|----------------|
| **A-P1** | The "occasion" thesis: organizers value the night *feeling like television* enough to choose/pay for it | Core differentiation (01/02) | V1 pilot enthusiasm (anecdote); market intel says trust+experience is the gap (analysis) | 45 | Real organizer reaction to the **rendered** ceremony → VA-1 + VA-4 | Product competes on features it deliberately refused; strategy collapses to parity |
| **A-P2** | **Phone-first owner bidding is workable and preferred** | Owner Room is the central money interaction (14/15/17) | None — V1 conduct ran through admin surfaces | 35 | Behavioural: real people bidding under pressure → VA-2 | The default money UX is unusable on the night; manual mode becomes the product unplanned |
| A-P3 | Free tier → Pass purchase conversion motion works | Growth model (02/45) | Market intel: organizers pay per event (directional) | 50 | Organizer intent data → VA-4; real funnel = post-launch | CAC model wrong; Free tier becomes pure cost (see A-C2) |
| A-P4 | Slab increments (IPL-style) preferred over flat | 41 default | None; V1 validated flat only; `flat` mode hedge exists | 45 | Organizer preference → VA-4 (one question) | Low — hedged; wrong default annoys, doesn't break |
| A-P5 | OTP-at-registration won't kill the funnel | Identity spine (38/42) | V1 ran OTP infra in prod config (partial); fallback ladder specced (47) | 60 | Completion-rate telemetry = post-launch; delivery reliability → VA-9 quotes | Registration funnel leaks at the top; organizers blame the product |
| A-P6 | Organizers can self-serve (no hand-holding) | SaaS model (02); V1 pilot was assisted | None | 40 | Unassisted task test → VA-2 (organizer seat) + VA-4 | Support cost per tournament breaks economics; growth throttled by founder time |
| A-P7 | Trust features are *perceived* and valued, not just architecturally present | Moat thesis (02) | Market intel (analysis, not observation) | 50 | Do interviewees mention receipts/audit unprompted after demo? → VA-4 | Moat invisible ⇒ moat absent commercially |

### UX assumptions

| ID | Assumption | Why | Current evidence | Conf | Missing → activity | Risk if wrong |
|----|------------|-----|------------------|------|--------------------|----------------|
| **A-U1** | An owner can place a correct bid in <3s under pressure on a mid-range phone | Bid panel design (15) | Spec only | 40 | Timed behavioural data → VA-2 | Mis-bids at ₹-stakes = the exact dispute the product exists to prevent |
| A-U2 | A volunteer (not trained auctioneer) can run the Cockpit | Cockpit charter (17) | V1 Cockpit observed working, but operated by its builder | 50 | Naïve operator in VA-2 | Operator overload on the night; paper mode becomes routine |
| A-U3 | The SOLD ceremony (~1.8s) feels electric, not slow, ×60 lots | Motion spec (11) | Spec only | 45 | Felt-experience in VA-1/VA-2 | Signature moment reads as latency; premium thesis inverts |
| A-U4 | Confirm-threshold on large bids prevents errors without killing momentum | 25/28 ladder; F-U4 open | Spec only | 45 | Threshold tuning data → VA-2 | Either accidental crore-bids or rage-inducing friction |
| A-U5 | 20-minute full-tournament triage is achievable | 42; number currently contradicts GJ-1 | None (and spec disagrees with itself) | 35 | Fix number → VA-7; timed test = Phase 2 usability | Acceptance criterion fantasy; organizer's real evening is 2 hours |
| A-U6 | Stage is legible at hall/projector distance | 17/09 projector scale | Spec only | 55 | Projector check inside VA-2 | The public spectacle — the demo loop (A-C7) — underwhelms live |

### Visual design assumptions

| ID | Assumption | Why | Current evidence | Conf | Missing → activity | Risk if wrong |
|----|------------|-----|------------------|------|--------------------|----------------|
| **A-V1** | FLOODLIGHT reads "exceptional premium" in 5 seconds | The strategy itself (01/02/05) | Zero rendered pixels | 35 | Blind first-impression test → VA-1 | Entire visual strategy repainted mid-build across 5 surfaces |
| **A-V2** | Volt reads premium (not sporty-generic) to Indian organizers/sponsors | C-5 | Internal narrative only (08) | 35 | Palette variants in VA-1; organizer reaction VA-4 | Dated-in-five-years accent at the center of the brand |
| **A-V3** | Devanagari ceremony parity is achievable within the type system | C-6 gap; 0A upgraded to brand-integrity defect | Known gap (09 concedes) | 30 | Devanagari display pairing rendered in VA-1 | Hindi names get a lesser ceremony — dignity + premium failure at the emotional core |
| A-V4 | Ceremony motion performs on a ₹12k Android | 11/57 budgets | Spec only | 45 | Throttled-device run in VA-1 | Jank at the signature moment for the majority device class |
| A-V5 | Dark-live/light-console duality feels like one product | C-4 | Spec only | 55 | Side-by-side in VA-1 | Two-products feeling; brand incoherence |

### Commercial assumptions

| ID | Assumption | Why | Current evidence | Conf | Missing → activity | Risk if wrong |
|----|------------|-----|------------------|------|--------------------|----------------|
| **A-C1** | Unit economics clear healthy margin at plausible Pass prices | 45 model; 0A found zero cost side | None | 40 | Cost model w/ live quotes → VA-3 | Business model unviable; discovered after build |
| **A-C2** | Free tier is sustainable (bounded cost per free tournament) | 45 Free promise | None (Free sends paid OTPs; AI Import Assistant included) | 35 | Cost ceiling + product caps → VA-3 | Free tier gutted post-launch = public brand damage (inv 27 spirit) |
| A-C3 | Organizers pay per-tournament (not subscription) | C-11 / D-006 | Market intelligence (strongest commercial evidence held) | 75 | Reconfirm in VA-4 | Low — best-evidenced commercial claim |
| **A-C4** | Specific price points (₹500–5,000 placeholders) | 45 admits placeholder | None | 25 | Van-Westendorp-lite → VA-4 | Mispriced launch; anchoring is hard to undo publicly (inv 27: pricing is public) |
| A-C5 | WhatsApp BSP costs/approval timelines fit launch | C-19 | None | 40 | Quotes + template pre-approval → VA-9 | Registration/OTP path delayed weeks; costs surprise (feeds A-C1) |
| **A-C6** | V1 pilot can be transitioned without loss | 0A found zero transition planning | None | 30 | Founder ruling → VA-8 | Stranded customer; forked identity data; split maintenance |
| A-C7 | Auction-as-demo distribution loop works (Stage recruits next organizers) | 02 GTM thesis | Plausible mechanism, no data | 40 | Real signal = post-launch; proxy: VA-4 "how did you find your current tool?" | CAC assumptions wrong; growth slower than modelled |

### Engineering assumptions

| ID | Assumption | Why | Current evidence | Conf | Missing → activity | Risk if wrong |
|----|------------|-----|------------------|------|--------------------|----------------|
| A-E1 | Single-writer engine: validate+append+project < 20ms p99 on affordable infra | C-9/51/57 — the architecture's one number-bet | Paper arithmetic only | 70 | Tracer-bullet benchmark → VA-5 | Sync-projection decision (inv 12 mechanism) needs redesign — cheap now, brutal after teams build on it |
| A-E2 | Cross-origin WS auth handshake solvable cleanly | F-A6, open since Phase 1 | None (ADR pending) | 60 | ADR + tabletop → VA-6 | Money-path trust chain improvised under deadline |
| A-E3 | Engine recovery (replay + re-arm timers) < 10s | 57/61 | Paper only | 65 | Same benchmark → VA-5 | Recovery promise (emotional beat: owner reconnection trust) breaks |
| A-E4 | Determinism suite buildable as specified | 58 | Pattern proven in industry; not here | 70 | First proof = Phase 2 week 1; no pre-work needed | Testing strategy centerpiece slips |
| A-E5 | Vendor stack composes without surprises | 60 | Vendor docs | 55 | Thin slice exercised by VA-5 (Neon+Fly leg only) | Integration tax discovered late |

### Operational assumptions

| ID | Assumption | Why | Current evidence | Conf | Missing → activity | Risk if wrong |
|----|------------|-----|------------------|------|--------------------|----------------|
| **A-O1** | The real team can execute the governance/ops model | 0A §7: prescribed for 30–50 engineers | Contradicted by observable staffing | 20 | Right-sizing decision → VA-8 | Gates silently skipped; docs become decorative (worst cultural outcome) |
| A-O2 | Paper mode is executable by a real organizer mid-crisis | 61 | Spec only | 45 | Include a 5-min paper-mode drill in VA-2 | The last-resort trust promise fails exactly when needed |
| A-O3 | Estate cost affordable pre-revenue | 0A §8b | None | 50 | Cost the estate inside VA-3 | Burn surprises; staging/probes quietly turned off |

### Customer assumptions

| ID | Assumption | Why | Current evidence | Conf | Missing → activity | Risk if wrong |
|----|------------|-----|------------------|------|--------------------|----------------|
| A-CU1 | Organizers reachable at acquirable cost (WhatsApp groups, clubs) | 02 | Founder network exists (weak proxy) | 45 | VA-4 recruitment *is* the test — measure effort to book 8 interviews | GTM cost model wrong |
| A-CU2 | V1 pilot organizer would use NEXT / recommend | Continuity + reference customer | Unknown | 40 | Include pilot in VA-4 panel | Losing the only live reference |
| A-CU3 | Owners accept phone over shouting (behaviour change) | Owner Room bet | None | 35 | VA-2 preference measurement | Same failure mode as A-P2, from the customer side |

### Performance assumptions

| ID | Assumption | Why | Current evidence | Conf | Missing → activity | Risk if wrong |
|----|------------|-----|------------------|------|--------------------|----------------|
| A-PF1 | Stage LCP <1.8s on 4G on ₹12k Android incl. ceremony assets | 57 | Budget arithmetic | 55 | Throttled run of VA-1 prototype | Majority device class gets a degraded spectacle |
| A-PF2 | Right-sized fan-out (~1k viewers) achievable with documented levers | 0A §5.6 resize | Standard WS math | 70 | VA-5 includes a fan-out micro-test; full load test = Phase 2 | Low — levers documented (54) |

### Governance assumptions

| ID | Assumption | Why | Current evidence | Conf | Missing → activity | Risk if wrong |
|----|------------|-----|------------------|------|--------------------|----------------|
| A-G1 | Docs-lead discipline survives implementation | 67 §1 doctrine | Worked for writing docs; untested against code pressure | 45 | Docs-citation CI from PR #1 (Phase 2 gate — recorded in exit criteria) | Corpus rots into fiction within a quarter |
| **A-G2** | An independent review mechanism exists (someone who isn't the author) | 0A finding zero | None — no named reviewer | 20 | Name the reviewer → VA-8 | Self-certification repeats forever |
| A-G3 | Founder decision latency won't bottleneck a docs-lead process | Canon changes need founder (68) | Founder responsive historically (V1 rulings) | 60 | VA-8 sets a decision SLA | Phase 2 stalls on paper approvals |

**Register totals: 31 assumptions · 9 blocking (bold) · every row has an evidence path. No assumption is without a plan.**

---

## 3 · Validation activities (the minimum set)

Nine activities. Each lists the uncertainty removed; anything that removed none was cut (examples cut: a second brand-name exploration round, a full accessibility audit of unrendered specs, a DR simulation with no infrastructure to recover — these produce paper, not proof, at this stage).

### VA-1 · FLOODLIGHT Signature Prototype ⭐ (discharges B1)
- **Purpose / uncertainty removed:** A-V1, A-V2, A-V3, A-V4, A-V5, A-U3, A-PF1 — does the design language survive contact with pixels?
- **Form:** high-fidelity **HTML/CSS/JS prototype in a real browser** (not Figma — motion, fonts, and device throttling must be real). Three screens: **Stage with full SOLD ceremony** (one lot cycle, including a Devanagari player name and ₹-crore figure), **Owner Room bid panel** (one bid interaction), **Cockpit** (static + one gavel moment). Includes: 360px layout, projector scale, reduced-motion variant, light-console/dark-live side-by-side, and **two accent variants** (Volt vs one challenger, e.g., championship gold-on-ink) so A-V2 is a comparison, not a referendum. Throwaway by construction: lives in `prototypes/`, never imported by production code.
- **Hypothesis:** FLOODLIGHT as specified produces an unprompted "premium" first reaction and the ceremony feels electric at 1.8s.
- **Success criteria (pre-registered):** (a) founder five-second reaction is positive *without coaching*; (b) ≥3 of 5 neutral viewers (≥2 being real organizers/owners from VA-4 pool) use a premium-class word unprompted ("professional", "TV", "IPL", "premium") within 10 seconds; (c) ceremony at 60fps — or gracefully degraded — on a mid-range Android (real device or 6× CPU throttle); (d) Devanagari name visually equal in weight/presence to Latin; (e) reduced-motion variant preserves the moment's meaning.
- **Failure criteria:** viewers say "like a scoreboard app / like Excel"; Volt reads sporty-cheap in both variants; Devanagari parity unachievable with any tested pairing; jank on throttle. **Failure action:** iterate palette/type inside VA-1 (one round, 2 days) before any conversion of the verdict; C-5/C-6 are explicitly *not protected* (§8).
- **Time:** 3–5 days build (CTO-AI) + 1 day judging. **Participants:** CTO-AI (build), founder (judge), 3–5 neutral viewers. **Cost:** ≈ ₹0 (font licence check for Devanagari display face). **Owner:** CTO-AI. **Priority P0.**
- **Decision enabled:** B1 clears; C-4/C-5/C-6 confirmed or amended with evidence; UI build de-risked.

### VA-2 · Mock Auction Night ⭐ (discharges B2)
- **Purpose / uncertainty removed:** A-P2, A-U1, A-U2, A-U3, A-U4, A-U6, A-CU3, A-O2, A-P6 (organizer seat) — the central money interaction, tested on humans.
- **Form:** 30–45 min staged auction: 12–16 lots, fake purses, **6–8 real people on their own phones** (mix of actual team owners/club members and proxies), one naïve operator (not the builder) on the Cockpit prototype, Stage on a projector/TV. Engine is a scripted simulation behind the prototype (Wizard-of-Oz acceptable) — **no production code**. Includes one scripted mid-auction failure → 5-minute paper-mode drill (A-O2). Sessions recorded.
- **Hypothesis:** ≥90% of bids are placed correctly without assistance; participants prefer phone bidding to shouting; a naïve operator keeps pace.
- **Success criteria:** (a) ≥90% bid attempts succeed first try, unassisted; (b) median tap-to-bid <3s under contested lots; (c) zero accidental large bids past the confirm-threshold — and threshold friction complaints ≤1 participant; (d) post-session preference ≥6/8 for phone over voice; (e) operator completes all lots without builder intervention; (f) paper-mode drill completes with correct ledger reconciliation.
- **Failure criteria:** participants hand phones back / shout instead; repeated mis-bids; operator drowns. **Failure action:** elevate manual conduct mode (41) to co-primary, redesign the bid panel, re-run once; if it fails twice, Owner Room descopes from V1 launch (GO with modified scope — not RESTART; the conducted-auction product is still whole).
- **Time:** 2 days prep + 1 evening + 1 day analysis. **Participants:** founder (recruits + observes), 6–8 bidders, 1 naïve operator, CTO-AI (builds simulation, analyzes recording). **Cost:** refreshments. **Owner:** Founder + CTO-AI. **Priority P0.** **Depends on:** VA-1.
- **Decision enabled:** B2 clears; confirm-threshold value chosen from data (closes F-U4); Owner Room scope confirmed.

### VA-3 · Unit-Economics Model ⭐ (discharges B3 with VA-4)
- **Purpose / uncertainty removed:** A-C1, A-C2, A-C5 (cost half), A-O3 — does the business clear margin, and what may the Free tier cost?
- **Form:** a one-sheet model with **live vendor quotes, not recalled prices**: WhatsApp BSP per-message (utility/auth/marketing classes, ≥2 BSP quotes), SMS DLT fallback rates, Razorpay MDR by method (UPI/cards), Neon/Fly/Vercel/Upstash monthly + per-live-auction marginal cost, Claude API cost per Import-Assistant run, estate cost (staging, probes). Scenarios: Free tournament (OTP-only), Pro tournament (100 players, full ceremony messaging), at 10/50/200 tournaments-per-month mixes.
- **Hypothesis:** Pro Pass at ₹1,500–3,000 clears ≥70% gross margin; a Free tournament costs <₹75 with enforceable product caps.
- **Success criteria:** margins positive with **3× cost buffer** on messaging (the volatile line); Free-tier cost ceiling defined *and expressible as product caps* (e.g., OTP attempts, player count) that 45 can adopt; break-even tournaments/month computed.
- **Failure criteria:** messaging dominates margin at any plausible price. **Failure action:** redesign notification defaults (in-app first, ceremony messages opt-in/Pro-only, SMS only for auth) — a spec change, cheap now.
- **Time:** 2 days (CTO-AI research + model) + founder acceptance. **Cost:** ₹0. **Owner:** CTO-AI. **Priority P0.**
- **Decision enabled:** B3 (with VA-4's willingness-to-pay); Free tier design; pricing floor.

### VA-4 · Organizer Evidence Panel (co-discharges B3; feeds A-P1/P3/P4/P6/P7, A-C4, A-CU1/CU2)
- **Purpose / uncertainty removed:** the corpus has **zero primary customer research**; this is the smallest fix.
- **Form:** 5–8 structured 30-min conversations with real organizers (V1 pilot organizer + founder network + 2 cold-recruited from cricket clubs/WhatsApp groups — cold recruitment effort itself measures A-CU1). Script: current tool + what they paid; reaction to VA-1 screens; Van-Westendorp-lite on Pass price (too cheap / cheap / expensive / too expensive); slab vs flat; would owners bid on phones; do they mention trust/receipts unprompted; would they self-serve.
- **Hypothesis:** ≥60% state willingness to pay ≥₹1,500 for what they saw; phone bidding appeals to a majority; trust artifacts get unprompted mention after demo.
- **Success criteria:** pre-registered above; price-point cloud narrows A-C4 from placeholder to a defensible range; ≥1 organizer volunteers for a real pilot ("the strongest evidence available at this stage").
- **Failure criteria:** consistent "free tools are fine"; price cloud below ₹500. **Failure action:** revisit 45 tiering and 02 wedge before build — this is exactly what a board would demand.
- **Time:** 1 week calendar, parallel. **Participants:** founder (conducts — organizers must hear a founder, not an AI), CTO-AI (script, synthesis). **Cost:** small honoraria optional. **Owner:** Founder. **Priority P0.** **Depends on:** VA-1 screens (can start scheduling now).
- **Decision enabled:** B3 (demand half), price points, A-P1 confidence.

### VA-5 · Engine Tracer Bullet (added by the Evidence Board; gates engine build, not Phase 2 planning)
- **Purpose / uncertainty removed:** A-E1, A-E3, A-E5 (one leg), A-PF2 (micro) — the architecture's single load-bearing number, tested for 2 days instead of assumed for 5 years.
- **Form:** ≤500-line disposable spike in `spikes/` (explicitly non-production; deleted or archived at phase end): one Node process on a Fly-class VM, Postgres on Neon Mumbai; append event + transactional projection update; simulate contested-lot bid storms; measure p50/p99; replay 2,000 events and re-arm timers; naive WS fan-out to 1k simulated clients.
- **Hypothesis:** p99 validate+append+project <20ms; replay <10s; on the cheapest viable instances.
- **Success criteria:** budgets met with ≥30% headroom; costs land in VA-3's infra line. **Failure criteria:** p99 >20ms after basic tuning → revisit 51's sync-projection choice (async within the auction breaks the inv-12 mechanism, so this decision must be made *before* build) or the hosting choice.
- **Time:** 2–3 days. **Cost:** <₹2,000 cloud. **Owner:** CTO-AI. **Priority P1** (does not block Phase 2 planning; **blocks engine build start**).
- **Decision enabled:** C-9's performance premise proven; instance sizing for VA-3.

### VA-6 · WS-Auth ADR + Money-Path Threat Tabletop (discharges R8; part of B6's independent-review intent)
- **Purpose / uncertainty removed:** A-E2; 0A R8 — the one unspecified link in the money path's trust chain.
- **Form:** written ADR-001 (session→WS token handoff: token type, TTL, rotation, revocation on grant change) + 2-hour tabletop walking abuse cases (token theft, replay, bid spoofing, presence forgery) against 41/49/51. The tabletop is run by the **named independent reviewer** from VA-8 — making it the first non-author review of the money path (B6).
- **Success criteria:** ADR accepted; every abuse case has a documented control or an accepted-risk entry. **Failure:** unresolvable case → protocol redesign before engine build.
- **Time:** 1 day + 2h session. **Cost:** ₹0. **Owner:** CTO-AI + independent reviewer. **Priority P1** (blocks engine build). **Depends on:** VA-8 (reviewer named).

### VA-7 · Spec Repair Batch (discharges B4 + B7)
- **Purpose / uncertainty removed:** the six 0A defects are *known errors*, not unknowns — this is the one place where documentation **is** the missing evidence.
- **Scope (all from 0A, nothing new):** (1) Free-tier fix: classify OTP + owner invites as identity/transactional infrastructure exempt from tier gating; tier-annotate 47's catalog; amend 45. (2) Lot `Withdrawn` state + rule (39/41). (3) Pool-exhaustion completion rule (39 guard). (4) Dispute definition + intake + record states (making C-2 computable; touches 38/56/70). (5) Reconcile triage numbers (42 vs GJ-1). (6) Inv-34 Task wording (40) + delete dead timer clamp (41).
- **Success criteria:** amendments merged with founder sign-off (Canon governance, 68); 0A's §4/§6 findings all state "resolved by commit …".
- **Time:** hours. **Owner:** CTO-AI (edits) + Founder (sign-off). **Priority P0.**

### VA-8 · Founder Decision Workshop (discharges B5 + B6)
- **Purpose / uncertainty removed:** A-C6, A-O1, A-G2, A-G3 — the blockers that are decisions, not work.
- **Agenda (90 min):** (1) **V1 transition ruling** — recommendation on the table: V1 enters maintenance freeze serving the pilot as-is; NEXT launches greenfield; pilot offered opt-in migration after NEXT's first live season; no forced data migration. (2) **Governance right-sizing** — recommendation: three gates per phase (founder product/design gate; independent money-path gate; self-executed engineering gate with published evidence), drills semi-annual until team ≥3, live-window deploy freeze kept, two-person deploy rule replaced by automated-rollback requirement; staffing statement recorded. (3) **Name the independent reviewer** (a real human — engineer friend, paid consultant, or the pilot organizer for product gates; the role needs a name, not a title). (4) Decision SLA for Canon changes. (5) 30-min open question: does the "DesiAuction" name itself carry the premium ambition? (raised by the Board as a question, explicitly **not** a blocker — reopening naming without evidence would be change for its own sake).
- **Success criteria:** four recorded rulings in the repo's decision log. **Time:** half day. **Owner:** Founder. **Priority P0.**

### VA-9 · WhatsApp BSP Procurement Start (hedges R9; feeds A-C5, A-P5)
- **Purpose / uncertainty removed:** the plan's longest external lead time, started now so it never blocks later; quotes feed VA-3.
- **Form:** shortlist 2 BSPs, open accounts, submit the 47 template catalog (OTP, invite, SOLD ceremony) for Meta approval, record per-message pricing + approval turnaround.
- **Success criteria:** templates approved or rejection reasons known; real rates in VA-3. **Time:** external (start now). **Owner:** Founder (account) + CTO-AI (templates). **Priority P1.**

**Dependency graph:** VA-8 → VA-6 (reviewer) · VA-1 → VA-2, VA-4 (screens) · VA-9/VA-5 → VA-3 (rates/infra line). Everything else parallel. **Critical path: VA-1 → VA-2 ≈ 2 weeks.**

---

## 4 · Executive validation

Could a board approve investment today? **Not yet** — but the missing items are now enumerated, not vague:
- **Documented and strong:** vision/positioning (01/02), differentiation thesis, pricing *model* (C-11), refusal discipline, behavioural continuity from a validated V1.
- **Missing executive decisions (all land in VA-8 or VA-3/4):** staffing/budget/runway statement; V1 transition; price points; Free-tier cost ceiling; independent-review mechanism; first launch market (recommendation: founder's home region — the mock auction and panel will de facto choose it; record it).
- **Enterprise readiness** (associations, multi-org): correctly deferred by the corpus (PAS scalability table); no 0B evidence needed — do not spend validation effort here.
- **Investment risk after 0B:** if all nine activities meet success criteria, the remaining risk profile is execution risk (normal, insurable by phase gates) rather than assumption risk (unbounded).

## 5 · Product validation — Documented vs Observed vs Validated

| Claim | Documented | Observed | Validated (real users, no assistance) |
|---|---|---|---|
| Full auction workflow | ✅ 41 | ✅ V1 browser-certified (GJ-3/4, RRP-5) | ❌ — admin-conducted, builder-assisted → VA-2 |
| Registration + OTP | ✅ 42 | ✅ V1 flows | ❌ funnel completion by strangers unknown → post-launch telemetry (accepted residual) |
| **Anything on mobile** | ✅ 14 | **❌ never — V1 was desktop-only end to end** | ❌ → VA-1/VA-2 are the first mobile evidence this product will ever have |
| Poor connectivity behaviour | ✅ 51/61 | ❌ | ❌ → VA-2 includes one scripted degradation; full chaos = Phase 2 suite |
| Full tournament end-to-end | ✅ 44 | Partial (V1 fixtures/results shipped; live usage thin) | ❌ → accepted residual until first real NEXT season |
| Unassisted operation | ✅ 22/44 | ❌ | ❌ → VA-2 naïve operator + VA-4 self-serve probe |
| SOLD ceremony as spectacle | ✅ 11/17 | ❌ (V1's ceremony was functional, not designed) | ❌ → VA-1 + VA-2 |

The honest headline: **the product is documented far ahead of what has ever been observed, and almost nothing has been validated by an unassisted stranger.** Phase 0B moves the three most dangerous rows; the accepted residuals are listed in §10.

## 6 · Design validation — what must exist before implementation, and why waiting is correct

| Artifact | Produced by | Why implementation waits on it |
|---|---|---|
| Rendered brand board (Ink/Volt vs challenger, gold moment) | VA-1 | Repainting one prototype costs a day; repainting five built surfaces costs a quarter |
| Type specimens incl. Devanagari display pairing | VA-1 | The ceremony renders *names*; the pairing decision changes token files, which change everything downstream |
| Motion study: SOLD ceremony + reduced-motion | VA-1 | Motion is spec'd in ms but felt in context; 11's numbers are hypotheses |
| Stage / Owner Room / Cockpit signature screens | VA-1 | These three screens *are* the strategy; everything else is derivable from them |
| Interaction proof: bid panel under pressure | VA-2 | The one interaction where a design error costs real money |
| Logo artwork (07 brief) | VA-1 sprint | The five-second test includes the mark |
| **Deliberately deferred:** full component library, empty/error-state gallery, dashboard prototype, icon set | Phase 2 | Derivable from the proven language; prototyping them now is documentation in disguise |

## 7 · Commercial validation

Covered by VA-3 (cost side) + VA-4 (demand side) + VA-9 (rate reality). Every commercial assumption is in the register (A-C1…A-C7). Board notes: (a) A-C3 (pay-per-event) is the best-evidenced commercial claim held — protect it; (b) the Free tier is the largest *structural* commercial risk because its costs scale with success (A-C2) — VA-3 must output enforceable caps, not sentiment; (c) expansion (other sports, associations) requires **zero** 0B evidence — refuse the temptation to validate futures.

## 8 · Governance validation

- **Unnecessarily heavy (right-size in VA-8):** eight reviews per phase; two-person engine deploys; quarterly full drills — all sized for a staff that does not exist (0A §7).
- **Missing (install in VA-8):** a named independent reviewer (A-G2); a founder decision log in the NEXT repo (V1's D-series has no successor); a decision SLA (A-G3).
- **Correctly weighted (keep):** Canon + founder sign-off for constitution changes (68); docs-citation CI from PR #1 (A-G1 — made an exit criterion below); Golden-Journey acceptance gates (C-21); live-window release freeze (C-22).
- **Scale test:** the right-sized model (3 gates/phase + named reviewer + decision log) scales *up* by adding reviewers per gate — it does not need redesign at 10 or 50 engineers. The current model scales *down* to nothing, which is the actual risk.

## 9 · Protected decisions

Changing any of these now requires extraordinary evidence — 0B activities are **not** authorized to reopen them:

| Decision | Why protected | Evidence supporting it | Risk if changed |
|---|---|---|---|
| The 35 invariants / business constitution (40) | Validated V1 behaviour + Phase 0A confirmed strongest layer | V1 live operation; 0A domain review (Level 5) | Behavioural regression — the one unforgivable failure of a rebuild |
| C-9 event-sourced ledger + single-writer engine | Convergent decision; reference proved the alternative by suffering it | 0A §5; V1's lock/QStash/cron pathology | Re-architecture churn; loses inv-12 mechanism |
| C-3 one engine, five surfaces | 0A: best product idea in corpus | V1's admin-surface accretion as counter-example | IA collapse into V1's disease |
| C-8 grants-not-roles | Fixes observed 3-enum drift in V1 | V1 schema archaeology | Permission drift repeats |
| D-005 AI never on the money path | Constitutional (inherited, founder-ratified) | Trust thesis; inv 32 | Product's core promise becomes unfalsifiable |
| C-21 Golden Journeys as acceptance | The single most successful V1 discipline | V1 certification history | Acceptance dissolves into vibes |
| Behavioural preservation rule (V1 = truth) | The rebuild's charter | Founder directive | Silent feature loss |
| C-24 India-first | Market truth | Market intelligence + V1 | Strategy incoherence |
| Docs-lead governance (right-sized form) | Only mechanism keeping 71 docs true | Phase 1 consistency sweeps worked | Corpus rots; single source of truth lost |

Explicitly **not protected** (they are the experiments): C-4/C-5/C-6 visual specifics, price points, Owner Room as default conduct mode, slab default, notification channel defaults, warm standby, dual API planes, 5k targets.

## 10 · Exit criteria

Phase 0B **ends** when every row below has its evidence artifact recorded in §11 with a pass, or a founder-accepted failure-action:

| # | Exit criterion | Evidence artifact | Unlocks |
|---|---|---|---|
| X1 | VA-1 success criteria met (or one iteration + pass) | Prototype + recorded five-second reviews + throttle capture | B1 · A-V1..V5 ≥70 conf |
| X2 | VA-2 success criteria met (or descope ruling) | Session recording + bid-success/timing data + preference count | B2 · A-P2/U1..U4 ≥70 or scope change recorded |
| X3 | VA-3 model founder-accepted, margins ≥ target w/ 3× buffer; Free caps defined | Cost model + quote records | B3 (cost) · A-C1/C2 ≥70 |
| X4 | VA-4 panel synthesized; price range set; ≥1 pilot volunteer | Interview synthesis + pricing sheet | B3 (demand) · A-C4 from 25→≥60 |
| X5 | VA-7 amendments merged w/ sign-off | Commits to 38/39/40/41/42/45/47/56/70 | B4 + B7 |
| X6 | VA-8 rulings recorded (V1, governance, reviewer, SLA) | Decision log entries | B5 + B6 |
| X7 | VA-6 ADR accepted + tabletop held by named reviewer | ADR-001 + tabletop minutes | R8; first independent money-path review (B6 evidence) |
| X8 | VA-5 budgets met (or 51 revision recorded) | Benchmark report in `spikes/` | Engine-build authorization |
| X9 | VA-9 templates submitted; rates in VA-3 | BSP records | R9 retired |
| X10 | Phase 2 standing condition recorded: docs-citation CI + invariant suite exist from PR #1 | Written into Phase 2 charter | A-G1 enforcement |

**Accepted residual uncertainty at exit (named, not hidden):** real registration funnel rates (A-P5), real CAC/loop performance (A-C7), full-tournament longitudinal use, production-scale load — all require a live product; the first real season is their test, run under C-21 gates.

## 11 · Evidence Ledger (append evidence here as it lands)

| Date | Activity | Artifact | Verdict vs criteria | Register deltas |
|---|---|---|---|---|
| — | — | *(no evidence yet — plan approved date pending)* | — | — |

## 12 · Risk register — Phase 0B itself

| # | Risk | Sev | Mitigation |
|---|---|---|---|
| 0B-1 | **Politeness bias** — viewers/interviewees flatter the founder | High | Blind protocol: unprompted-reaction capture before any pitch; behavioural metrics (VA-2 timings) outrank stated opinions; pre-registered criteria in this doc cannot be edited after the fact |
| 0B-2 | Prototype scope-creeps into implementation | High | `prototypes/`+`spikes/` quarantine; nothing imports from them; explicit throwaway rule in each VA |
| 0B-3 | Founder time is the bottleneck (VA-2/4/8 all need it) | Med | Front-load VA-8 (half day, unblocks reviewer + rulings); VA-4 spread over the same week as VA-1 build |
| 0B-4 | Recruiting 6–8 real bidders + 5–8 organizers fails | Med | That failure **is data** (A-CU1 low) — record recruitment effort; proxies allowed for VA-2 bidders but not for VA-4 organizers |
| 0B-5 | BSP/template approval drags past the phase | Med | VA-9 is a start-now hedge, not an exit criterion beyond "submitted + rates known" |
| 0B-6 | Evidence theater — activities run to confirm, not to test | High | Every VA carries failure criteria *with failure actions*; the Board treats an executed failure action as a success of the phase |

## 13 · Executive recommendation & final verdict

**Recommendation:** approve this plan and start VA-8 (founder half-day) and VA-1 (CTO-AI build) immediately; VA-9 accounts opened the same day. The critical path is two weeks; the full phase is 2–4 weeks and costs approximately nothing but attention.

**Final verdict: HOLD** — unchanged and correctly so: this session produced the instrument, not the evidence. The conversion is mechanical, not deliberative: **when X1–X10 are recorded in §11, the verdict becomes GO without a further review phase** (a one-page verdict memo citing the ledger suffices). If VA-2 fails twice, the verdict becomes GO-with-modified-scope (conducted-mode-primary). Only a joint failure of A-P1 (occasion thesis, via VA-1+VA-4) **and** A-C1 (economics, via VA-3) would put RESTART on the table — no current evidence points there.

**The board question — "after completing Phase 0B, would a rational board confidently authorize engineering investment?"** Yes: every Critical assumption will then carry behavioural or numerical evidence with pre-registered criteria, the constitution's known defects will be repaired, governance will be executable by the team that actually exists, and the remaining unknowns will be the kind only a live product can answer — named, bounded, and gated by C-21. That is what "earned the right to be built" looks like.

*Product Evidence Board · Phase 0B plan · 2026-07-11*
