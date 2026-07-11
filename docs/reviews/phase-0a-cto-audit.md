# PHASE 0A — DESIGN AUTHORITY REVIEW · CTO EXECUTIVE AUDIT

> Independent audit of the Product Operating System (docs 00–70 + reviews) · 2026-07-11
> Mandate: determine whether this corpus justifies committing implementation teams. Nothing is protected except validated business behaviour.
> This document supersedes `cto-review.md`'s Phase 1 verdict for the question of **implementation authorization** (a different question than the one that review answered).

---

## 0 · Finding zero: review integrity (read this first)

Every document in this corpus carries `v1.0 · 2026-07-11`. The four Phase 1 "gate reviews" (`reviews/*.md`) were produced by the **same author, in the same working session, as the documents they review**. Their findings follow the classic self-review signature: every finding is either "Resolved" or "Accepted" — a real adversarial review has casualties.

This does not mean the reviews are wrong (this audit re-derives and confirms most of their conclusions). It means they are **drafts of a governance process, not the process itself**. Evidence: this audit found three concrete spec defects (§6.3) and one broken Free-tier journey reading (§6.2) that four same-day reviews did not.

**Classification: documented fact.** Consequence threaded through the verdict (§16).

---

## 1 · Executive review

**Is the vision compelling?** Yes. 01's problem statement — community auctions are a *trust and theatre* problem, not a data-entry problem — is sharp, differentiated, and matches the recorded market intelligence (crowded feature-parity category; CricHeroes giant without a native auction; per-event spending; trust as the only defensible moat, 02). The one-sentence value proposition ("the money is beyond dispute and the night feels like an occasion") is immediately legible to a non-technical executive. **Strong Decision.**

**Is the philosophy internally consistent?** Yes, unusually so. The Ledger Principle (04) is a single idea that generates the audit trail, realtime protocol, recovery story, and dispute-proofing; 03's ten principles are priority-ordered (rare and valuable — most principle lists are unordered wishes). The five emotional beats are wired to mechanisms and acceptance assertions (04 → 70), not sentiment. **Strong Decision.**

**Does the product deserve to exist?** Yes — conditionally on execution. The wedge (auction night) is validated by V1's completed journeys; the differentiation thesis (trust physics + occasion) is credible. But note §2 and §11: two of the three legs of the differentiation ("looks like television", "owners bid on phones") are **asserted, not evidenced** in this corpus. The vision deserves investment; whether *this rendering* of it does is exactly what's missing.

**Would another CTO arrive here independently?** On the problem statement and trust thesis: yes. On the North Star (C-2): yes, though see §6.4 — as specified it is not yet measurable.

---

## 2 · Product review

**Inevitable or assembled?** The domain layer feels inevitable — 38/39/40/41 read as discoveries about the domain rather than choices. The product surface layer is well-assembled but contains three bets that V1 never validated and no document evidences:

1. **Owner Room phone-first bidding as the primary money interaction** (14, 15, 17). V1's certified journeys ran conduct through admin surfaces; owners-bidding-from-phones at scale (32 concurrent, hall Wi-Fi, ₹-stakes) has never been observed with real users. 41's manual conduct mode is a good hedge — but it's documented as the *fallback*, while the unvalidated mode is the *default*. **Insufficient Evidence.** This is the product's largest untested assumption.
2. **Slab increments as default** (41) vs the reference's validated flat increment. Plausibly right (IPL familiarity), zero evidence from actual organizers. Hedged by `flat` mode. **Weak Decision (acceptable with the hedge).**
3. **OTP-at-registration as V1 core** (42), upgraded from the reference's "future". Right call for identity integrity (38), and the fallback ladder exists (47) — but it inserts a hard external dependency (WhatsApp/SMS delivery) into the top of the funnel. Mitigations documented. **Strong Decision, execution-risk carried.**

**Mental models & IA:** One engine/five surfaces (17) is the corpus's best product idea — each surface maps to one audience with an explicit "never shows" column. The surface charters prevent the V1 disease (admin screens accreting live controls). **Strong Decision.**

**Discoverability & first-run:** Gap. 44 mentions "creating a personal org is part of first-run" — no document designs first-run, activation, or the empty-org experience beyond empty-state seeds (22). For a self-serve product whose strategy depends on second purchases (02), onboarding/activation thinking is **missing** (§14).

**Simplicity:** The refusals ledger is genuinely excellent — franchises (43), BI complexity (34), sponsor marketplace (45), native apps (14), microservices (65) are refused *in writing*. This is the discipline most doc sets lack.

---

## 3 · Design review

**Is FLOODLIGHT a design language or a component catalog?** It is a **specification of a language** — laws with enforcement mechanisms (one lit thing; gold excluded from the component API, 08; primitive tokens lint-banned, 18), not just an inventory. That is more than a catalog and less than a language. **A design language does not exist until it survives contact with pixels, and not one pixel of this system has ever been rendered.** No mockup, no prototype, no motion test, no logo artwork (07 is explicit that artwork is pending). The corpus's own standard convicts it: *"A demo on the author's machine is a hypothesis"* (67 §2) — a design language in prose is less than that.

**Against the stated bar (Linear, Stripe, Vercel, Framer, etc.) — what would feel inferior today:**

1. **Typographic voice is default-adjacent.** Geist at a 1.25 scale (09) is the 2025 starter-kit choice — Vercel's own font, used by thousands of dashboards. Clash Display is the most-used "premium" display face of the Fontshare era. The combination risks precisely the "template-looking" outcome 05 bans. The *numeric* typography rules (tabular money, display-2xl at projector scale) are the distinctive part; the base voice is not yet distinctive. **Weak Decision — needs visual exploration, not necessarily replacement.**
2. **Volt chartreuse is a fashion bet with no cultural validation.** 08 justifies it internally ("the old green, floodlit") but no evidence exists that electric chartreuse reads *premium* — rather than *sporty-generic* — to Indian organizers and sponsors in 2026, and it is the single most dated-in-five-years risk in the system. **Weak Decision — exactly the kind a prototype resolves for the cost of a week.**
3. **The Devanagari display gap sits at the center of the signature moment.** The SOLD ceremony renders a *player's name* in display type (11, 17); 09 concedes Clash Display has no Devanagari and falls back to a UI-grade stack. For an India-first product (C-24), Hindi names getting a visibly lesser ceremony than English names is not a "tracked gap" (09's framing) — it is a brand-integrity defect at the product's emotional core, and arguably a dignity issue (C-23). The earlier UX review accepted this too cheaply (F-U8). **Must be resolved (commission/select a Devanagari-complete display pairing) before ceremony design freezes.**
4. **Iconography: 8 custom glyphs + Lucide** (12) is a floor, not a language. Acceptable V1; noted.

**What would NOT feel inferior:** the restraint laws (05), state-design completeness (22–25 leave no undesigned state), the confirmation ladder (25/28), dark/light as parallel token-complete themes (08/18), reduced-motion parity as a release gate (11). This thinking is at or above the named bar.

**Accessibility:** 13 is genuinely strong — the live-region coalescing strategy and keyboard-complete Cockpit are beyond what most shipped auction products attempt. **Strong Decision** (spec-level; unproven like everything else).

**Mobile:** 14's postures are correct and honest (Cockpit refuses phones rather than breaking). The 360px-first budgets (57) are the right reversal of V1's desktop-only scar. **Strong Decision.**

---

## 4 · Domain review

The strongest layer of the corpus. 40's 35 invariants with a per-invariant **enforcement map** (schema vs machine vs read-model vs policy) is the single most valuable artifact here; 39's machines are explicit with guards; 41's gauntlet is ordered, coded, and copy-mapped (21). Terminology discipline held under grep (no purse/budget or pool/list drift found).

**Defects and gaps found (all fixable in hours, none structural):**

1. **Missing lot state: player withdrawal after pool lock.** A player who is injured/leaves between pool lock and their lot has no path: 39's Lot machine has no `Withdrawn/Removed` state, and 41 defines no rule. The generic audited-override (inv 16) is the escape hatch, but a certain, common edge case deserves a first-class rule. **Missing edge case.**
2. **Missing completion rule: pool exhaustion below `squadMin`.** The reserve rule (41 #9) guarantees purse sufficiency but nothing guarantees pool sufficiency — if unsold-final outcomes leave a team unable to reach `squadMin`, the `AuctionComplete` guard (39) is silent on whether completion is legal. **Behavioural ambiguity.**
3. **North Star unmeasurable as specified** (also §6.4): C-2 counts "zero disputes raised", but no document defines a dispute — no intake surface, no dispute record, no resolution state. 56's detectors cover *silent failures*; disputes are human claims and currently have nowhere to be raised. **Missing invariant-adjacent mechanism.**
4. **Invariant 34 references a `Task` concept that the domain model does not define** (40 #34 vs 38 — zero occurrences). Inherited from the reference constitution's workspace model. Harmless today, but a constitution should not reference undefined nouns. **Terminology defect.**
5. **Dead clamp in 41:** "never extends beyond `now + timerInitial`" is unreachable while `timerExtension ≤ timerInitial` (both defaults). Either bind it to a config validation or delete it. **Spec noise.**

**Duplication/contradiction sweep:** invariant citations all resolve (checked mechanically); dignity rules are stated once (C-23) and cited, not restated. Two numeric contradictions found — see §6.3.

---

## 5 · Architecture review

**The core bet — event-sourced ledger + single-writer engine (C-9, 66) — is the correct one, and another competent CTO would converge on it.** The reference implementation is the proof-by-negative: it spent Redis distributed locks, an external timer queue, *and* a cron watchdog simulating exactly this process. The bet buys ordering (no locks), invariant 12 (transactional projections), recovery (replay), and audit (the ledger *is* the trail) from one mechanism. Bounded to the auction domain only (52) — the "event-source everything" trap is explicitly refused. **Strong Decision. Keep.**

**Still modern in five years?** The core pattern (append-only ledger, deterministic reducer, projections, cellular stateful services) — yes; these are twenty-year patterns, not fashions. The fashion-risk sits in the periphery: Next.js/Vercel coupling and tRPC are 2024–2026 ecosystem bets. Mitigated structurally by 50's thin-adapter rule (all logic in `packages/core`) — the periphery is designed to be replaceable. **Acceptable.**

**Challenged and downgraded:**

1. **Dual API planes in V1** (C-14, 50: tRPC internal + public REST + webhooks at launch). Two auth models, two error surfaces, two documentation artifacts — for zero identified V1 external consumer. D-007 openness is strategy, not a launch requirement. **Weak Decision → Modify: ship webhooks (needed for GJ-6/integrations) but defer the public REST read API until the first real external consumer exists.**
2. **Vendor sprawl:** Vercel + Fly + Neon + Upstash + CDN + Razorpay + WhatsApp BSP + Sentry — eight external operational dependencies for a pre-revenue product (60). Each individually defensible; the sum is an on-call surface the actual team (§9) cannot cover. **Weak Decision → Modify: consolidate at Phase 2 vendor finalization with an explicit "fewest vendors that meet the SLOs" criterion.**
3. **Warm second-region standby** (61) for a product with zero customers is over-provisioned; PITR + documented cold-restore meets honest V1 needs at a fraction of cost/complexity. **Weak Decision → right-size.**
4. **Audit hash chain** (48/52): tamper-evidence whose chain head is stored *in the same backups it guards* (62) is circular — it defends against superuser tampering only if the head is externally anchored, which no document specifies. Either anchor the head externally (trivial: publish periodically) or cut the chain as decoration; INSERT-only DB permissions already do the real work. **Weak Decision as written.**
5. **Unresolved: engine WebSocket auth handshake** (carried F-A6, still open). Cross-origin session→WS token exchange between the Vercel-hosted web and the Fly-hosted engine is unspecified and is on the money path's trust chain. **Blocks engine build, correctly flagged, still undone.**
6. **Load targets ungrounded:** 5,000 concurrent viewers/auction and 10 concurrent live auctions/cell (57) trace to no observed demand (V1's largest room was a hall). Harmless as engineering targets, costly as test matrices. **Insufficient Evidence → right-size to ~1,000 viewers with documented levers; keep the levers.**

**Confirmed sound:** transactional projections within an auction (write rates make it trivially feasible; 20ms tripwire exists, 57); RLS-under-app-checks with attack tests (49/52/58); pg-boss over a broker (53); processes-are-disposable recovery (61); paper mode (61) — the single best resilience idea in the corpus.

---

## 6 · Cross-cutting consistency findings

### 6.1 Canon integrity
All 24 Canon decisions are consumed downstream; no doc contradicts Canon (mechanical sweep + sampled reads). The Canon mechanism itself demonstrably worked — 70 docs written against it produced only the defects below.

### 6.2 The Free-tier notification contradiction (the audit's sharpest concrete finding)
- 45: Free tier notifications = **"In-app"** only; WhatsApp/SMS is a Pro feature.
- 43 + 39: go-live **requires** owner invite → OTP-verified acceptance (invariant 15).
- 47: owner invites and OTP are delivered via **WhatsApp/SMS** — with no tier annotation anywhere in the catalog.

On the natural reading, **a Free-tier organizer cannot deliver owner invites or OTPs, and therefore can never legally go live** — the Free tier's core promise (45: "full trust spine") is unshippable as specified. The obvious intent (OTP and invite links are *identity/transactional* infrastructure, not "notifications") is nowhere stated. One paragraph fixes it; today the spec is broken. **Documented contradiction — must fix before implementation.**

### 6.3 Numeric contradictions
- **Triage target:** 42 says "200+ registrations arrive in bursts" and "triage of a full tournament must be a 20-minute job"; GJ-1 (70) asserts "triage of 60 registrations ≤ 20 min". 60 ≠ a 200-registration tournament; one of these numbers is the acceptance criterion and the docs disagree which. **Fix.**
- **Task orphan** (§4.4) and **dead timer clamp** (§4.5). **Fix.**

### 6.4 North Star instrumentation gap
"Trusted Auctions Completed = zero disputes + zero silent failures" (C-2). Silent failures have detectors (56). Disputes have no definition, no intake, no record (§4.3). As written, the company's primary metric cannot be computed. **Fix at spec level (a dispute-intake definition), cheap.**

---

## 7 · Engineering review

**Boundaries:** 65's import rules are lint-enforceable and correctly directional; "pure core, effectful edges" (64/66) is the right spine and enables the determinism suite (58) — the corpus's best engineering artifact (property tests + chaos replay + simulation harness driving CI, load, and staging alike). **Strong Decisions throughout.**

**One-day onboarding?** For reading: yes — 00's reading path, glossary, and 65's placement heuristics get a senior engineer oriented in hours. For *contributing*: unanswerable — no code, no dev-env, no seed data exist. Fair for the phase; note that the docs promise a gate (59 #9 docs-citation CI) that must exist from the **first** PR or the whole "docs lead" doctrine (67 §1) dies quietly at birth.

**Governance vs reality (serious):** The corpus prescribes the operating discipline of a 30–50 engineer organization — eight reviews per phase (README), two-person engine deploys (60), quarterly drills (61/62), pagers (67 §9), Storybook+visual+chaos+load suites (58). No document states the actual team, hiring plan, or budget. The observable reality (a solo founder; V1 history) cannot execute this honestly — and a constitution that is *routinely waived* is worse than a lighter one that is *always honored*, because it teaches the team that the docs are decorative. 68's own rule ("docs that can't be enforced get rewritten as rules that can") convicts the governance layer. **Weak Decision → right-size governance to the real team, explicitly, before Phase 2.**

---

## 8 · Operations review

Spec quality is high and V1's hardest lesson (nothing rehearsed until forced — the old program's OPS-1) is institutionalized: standing staging with nightly simulation (59), drilled runbooks with "not drilled in 2 quarters = broken" (61), restore-verify as a paged job (62), live-aware deploy freezes (60, C-22). **Strong Decisions.**

Honest caveats: (a) demonstrated operational maturity is zero — everything here is words until the first drill (the docs themselves say so; credit for that); (b) cost realism — the prescribed estate (staging + nightly sims + warm region + synthetic probes) has a monthly bill no document estimates (§9); (c) the live-window calendar is load-bearing for deploys, alerts, *and* crons — it deserves a spec (where it lives, who edits, failure mode if wrong) rather than passing mentions (56/60/53).

---

## 9 · Commercial review (the weakest wing)

Documented: the pricing *model* (45 — passes, public pricing, no ransom: **Strong Decision**, matches market intelligence) and the payment *mechanics* (46 — webhook-truth, immutable invoices: **Strong**).

Missing, with nothing in 71 documents covering them:

1. **Unit economics — nothing exists.** WhatsApp Business API per-message fees (the Free tier sends OTPs at minimum; Pro sends per-player ceremonies, 47), Razorpay MDR, per-auction infra (5k-viewer fan-out!), AI inference (45 gives Free users the Import Assistant) — against a ₹500–5,000 one-time Pass. No margin model, no Free:Pro ratio assumption, no cost ceiling per free tournament. For a board authorizing investment: **disqualifying gap.**
2. **Price points admitted as placeholders** (45; flagged F-P5 and correctly deferred — but it remains open).
3. **V1 transition strategy — absent from the entire corpus.** A live V1 exists with at least one pilot organizer. Does NEXT replace it? Coexist? Migrate its data (Person identities, tournament history)? When does V1 sunset? Not one sentence anywhere. **Critical planning gap.**
4. **Support model** — for a trust product, the human answering the organizer at 9pm *is* the product (24 promises reference IDs "support can find in one search" — there is no support doc to receive them).
5. **Legal pack** — 49 covers DPDP architecture, 46 covers GST mechanics; Terms of Service, privacy policy, refund/consumer-law compliance are unaddressed (V1's LEGAL-1 gap, inherited unacknowledged).
6. **GTM beyond strategy prose** — 02's distribution thesis (the auction is the demo) is good; no activation funnel, no launch plan, no first-100-organizers plan.

---

## 10 · Documentation review

**Structure:** Canon + numbered docs + citation discipline works — the mechanical sweeps prove cross-referencing is real, and findability is good at 71 docs (00's map + reading order). **The Canon genuinely reduces complexity** — 24 decisions cover what would otherwise repeat across 70 files.

**At 500 docs / 50 engineers / 5 years:** flat numbering breaks (no insertion space; "doc 34" collides with growth); the corpus anticipates ADRs/runbooks as separate series (68) which absorbs most growth. Acceptable now; revisit numbering at the first insertion pain.

**Should documents merge?** Yes, modestly: 22–25 (four state docs share one doctrine), 26+27 (notifications+toasts), 33+34 (search+filtering) — the 70-count was the founder's prescribed structure, and it shows: ~15% of the documents exist to satisfy the list rather than to carry unique load. Not worth reorganizing now (churn > benefit); merge opportunistically when they next change. **The corpus is ~15% comprehensive-for-comprehensiveness; the remaining 85% earns its place.**

**Elegant or merely comprehensive?** The domain/architecture spine is *elegant* (one mechanism, many guarantees). The pattern layer is *comprehensive and competent*. The commercial wing is *hollow* (§9). Verdict: an elegant spine wearing a comprehensive shell, missing a wing.

---

## 11 · Decision review table

| Decision | Verdict | Confidence | Classification | Reason |
|---|---|---|---|---|
| C-9 Event-sourced ledger, single-writer engine | **Keep** | High | Strong | §5; reference proved the alternative by suffering it |
| C-3 One engine, five surfaces | **Keep** | High | Strong | §2; best product idea in the corpus |
| C-8 Grants not roles | **Keep** | High | Strong | Fixes the reference's 3-enum drift; schema-enforceable (36) |
| C-13 Postgres+Drizzle+RLS+ULID | **Keep** | High | Strong | Boring, layered, testable (52) |
| C-16 In-engine timers + watchdog | **Keep** | High | Strong | Deletes 3-system simulation (53) |
| C-12 Monorepo, two deployables | **Keep** | High | Strong | Two real runtime shapes; refusals recorded (65) |
| C-11 Pass model, public pricing | **Keep** (model) | High | Strong | Matches market intel; **price points: Insufficient Evidence** |
| C-18 Razorpay, provider-truth states | **Keep** | Med-High | Strong | Adapter-wrapped (46); single-provider risk accepted V1 |
| C-24 India-first (DPDP, phone, Mumbai) | **Keep** | High | Strong | Market truth |
| C-21 Golden Journeys as acceptance | **Keep** | High | Strong | V1's most successful discipline, carried |
| 40 The 35 invariants + enforcement map | **Keep** | High | Strong | The corpus's most valuable artifact; 4 hygiene fixes (§4) |
| C-4 FLOODLIGHT dual-theme | **Keep, gate on prototype** | Medium | Weak until rendered | §3; specification ≠ language |
| C-5 Volt accent / gold-is-earned | **Modify (validate visually)** | Low-Med | Weak | §3.2 fashion + cultural risk; gold rule itself is Strong |
| C-6 Clash Display/Geist/Geist Mono | **Modify** | Medium | Weak | §3.1 default-adjacent; §3.3 Devanagari at ceremony core |
| C-14 Dual API planes at launch | **Modify (defer public REST)** | Medium | Weak | §5.1; no V1 external consumer |
| C-19 WhatsApp-first | **Keep direction; fix tier spec; add cost model** | Medium | Insufficient Evidence (cost) | §6.2, §9.1 |
| Owner Room phone-first bidding as default | **Keep, gate on user validation** | Low | Insufficient Evidence | §2.1; largest untested product assumption |
| OTP-at-registration V1 core | **Keep** | Med-High | Strong | Identity spine (38); fallbacks documented |
| Audit hash chain | **Modify (anchor externally or cut)** | High | Weak as written | §5.4 circular |
| Warm second region | **Modify (right-size to cold restore)** | High | Weak | §5.3 over-provisioned pre-revenue |
| 5k-viewer capacity targets | **Modify (right-size)** | Medium | Insufficient Evidence | §5.6 |
| Eight-review phase gates / governance weight | **Modify (right-size to real team)** | High | Weak | §7; unexecutable as staffed |
| Self-authored gate reviews as Phase 1 evidence | **Replace (independent review)** | High | Weak | §0 |

---

## 12 · Risk register (prioritized)

| # | Risk | Sev | Impact | Likelihood | Mitigation | Blocks implementation? |
|---|------|-----|--------|------------|------------|------------------------|
| R1 | Design language fails on first contact with pixels (premium thesis unproven) | **Critical** | Strategy is "looking exceptional IS trust" (01/02); failure = repaint mid-build across every surface | Medium | Phase 0B prototype of 3 signature screens before UI build | **Yes** |
| R2 | No unit economics; Free tier + WhatsApp + AI costs vs one-time Pass may not clear margin | **Critical** | Business model unviable or Free tier gutted late (brand damage) | Medium | Cost model + pricing sheet (Phase 0B) | **Yes** |
| R3 | Phone-first owner bidding rejected by real owners/rooms | **Critical** | The product's central money UX unusable on the night; manual mode becomes the real product unplanned | Low-Med | One staged mock auction with real users (Phase 0B) | **Yes** |
| R4 | Governance/ops model unexecutable by actual team → gates silently skipped → docs become decorative | **High** | The entire "docs lead" doctrine collapses culturally | High | Right-size governance; state staffing plan | **Yes** (paper change) |
| R5 | Free-tier notification contradiction (§6.2) ships as-is | **High** | Free tier cannot go live; flagship journey broken | Certain if unfixed | One-paragraph spec fix: classify OTP/invites as identity infrastructure, tier-annotate 47 | **Yes** (trivial) |
| R6 | Devanagari display gap at ceremony center | **High** | Premium + dignity failure for Hindi names at the signature moment | High | Commission/select Devanagari display pairing pre-freeze | No (blocks design freeze, not start) |
| R7 | V1 transition unplanned (pilot organizer, data, sunset) | **High** | Stranded customer, split maintenance, identity-data fork | High | Founder ruling + migration note (Phase 0B) | **Yes** (decision, not work) |
| R8 | Engine WS auth handshake undefined (F-A6) | **High** | Money-path trust chain unspecified | Certain until ADR | First engineering ADR | No (blocks engine build only) |
| R9 | WhatsApp BSP selection + Meta template approval lead times | Medium | Registration/OTP path delayed weeks | Medium | Start external process early | No |
| R10 | Vendor sprawl (8 external dependencies) vs on-call reality | Medium | Operational fragility, cost | Medium | Consolidation criterion at vendor finalization | No |
| R11 | CricHeroes ships a native auction during our build | Medium | Wedge pressure | Low-Med | Speed via Phase 0B focus; trust artifacts they can't fake fast | No |
| R12 | tRPC/Next.js ecosystem churn over 5 years | Medium | Periphery rework | Medium | Thin-adapter rule already mitigates (50) | No |
| R13 | Transactional projection latency breaches 20ms budget | Low | Bid ack SLO pressure | Low | Tripwire exists (57); chaos suite verifies | No |
| R14 | Spec hygiene defects (triage numbers, inv-34 Task, dead clamp) | Low | Confusion, wasted review cycles | Certain if unfixed | Batch fix, hours | No |

---

## 13 · Maturity model (of the specification; demonstrated maturity is Level 1 everywhere — no code exists)

| Area | Now | Target | Gap → Recommendation |
|------|-----|--------|----------------------|
| Brand | 2 | 4 | Direction ratified, zero artwork → commission logo + visual identity sprint (Phase 0B) |
| Design | 3 | 5 | Specified, never rendered → 3-screen prototype gate (R1) |
| UX | 4 | 5 | Patterns complete; key flow unvalidated → mock-auction test (R3); first-run design missing (§2) |
| Navigation | 4 | 4 | Shells/URL grammar complete → verify in prototype |
| Motion | 2 | 4 | Choreography specified, feasibility (mid-range Android particles) unproven → motion prototype |
| Accessibility | 4 | 5 | Strong spec incl. live regions → expert review at prototype; vestibular test of ceremony fallback |
| Domain | 5 | 5 | Best-in-corpus → fix §4's five defects |
| Architecture | 4 | 5 | Core bet strong → close F-A6 ADR; right-size periphery (§5) |
| APIs | 4 | 4 | Well-specified → defer public REST (§5.1) |
| Database | 4 | 5 | Conventions + immutability-with-teeth → verify RLS attack tests early |
| Security | 4 | 5 | Layered spec → independent threat-model pass on engine protocol pre-build |
| Observability | 4 | 4 | SLOs are user-experienced; live-window escalation is novel-good → build from day one, not retrofit |
| Testing | 4 | 5 | Determinism suite is exemplary → stand it up with the first core package |
| Operations | 3 | 4 | Rehearsal institutionalized on paper → first drill = first evidence; cost the estate |
| AI | 3 | 3 | Disciplined, appropriately modest → value unproven, kill switches in place, fine |
| Developer Experience | 3 | 4 | Reading path strong; contribution path can't exist yet → docs-gate CI from PR #1 |
| Documentation | 4 | 4 | Canon works (proven by sweeps) → merge overlaps opportunistically |
| Governance | 2 | 4 | Self-review + oversized process → independent gates, right-sized cadence (R4) |
| Release Engineering | 4 | 4 | Flags, freeze windows, rollback doctrine → nothing to fix on paper |
| **Commercial Readiness** | **2** | 4 | Model strong, economics absent → unit economics + pricing + V1 transition + support + legal (§9) |

---

## 14 · Missing thinking (by discipline)

- **Executive:** team/staffing/budget model (§7); V1 transition ruling (§9.3); investment framing (what does Phase 2 cost, against what runway?).
- **Product:** dispute definition & intake (§6.4); first-run/activation design (§2); pool-exhaustion completion rule (§4.2); player-withdrawal-after-lock rule (§4.1).
- **UX:** real-user validation of the bid interaction (R3); Cockpit-refuses-phone copy (carried F-U7, still open); ceremony reduced-motion with affected users.
- **Design:** any rendered artifact at all (R1); Devanagari display strategy (R6); cultural read of Volt (§3.2).
- **Technical:** WS auth ADR (R8); external anchor for audit chain (§5.4); live-window calendar as a specified system (§8c).
- **Commercial:** unit economics (R2); pricing research (F-P5, open); support model; legal pack; GTM/launch plan (§9).
- **Operational:** cost of the prescribed estate (§8b); WhatsApp BSP procurement timeline (R9).
- **Governance:** independent review mechanism (§0); right-sized phase gates (R4).
- **DevEx:** dev-environment + seed-data spec for Phase 2 day one.

---

## 15 · Top 25 recommendations

| # | Pri | Recommendation | Reason / Impact | Effort | Deps |
|---|-----|----------------|-----------------|--------|------|
| 1 | Crit | Run Phase 0B (§16) instead of starting implementation | Converts the three Critical risks into evidence for weeks of cost | 2–4 wk | — |
| 2 | Crit | Build the 3-screen visual+motion prototype (Stage+ceremony, Owner Room bid, Cockpit) | R1; proves or fixes FLOODLIGHT before teams multiply it | 1–2 wk | 3 |
| 3 | Crit | Resolve Devanagari display pairing before prototype | R6; the ceremony must be equal in Hindi | days | — |
| 4 | Crit | Write the unit-economics model (WhatsApp, MDR, infra, AI vs Pass) | R2; commercial viability evidence | days | BSP quotes |
| 5 | Crit | Stage one mock auction: ≥6 real owners, own phones, real purse pressure | R3; validates the central money UX + confirm-threshold (F-U4) | 1 wk | 2 |
| 6 | Crit | Fix the Free-tier notification contradiction (classify OTP/invites as identity infra; tier-annotate 47) | R5; Free tier is unshippable as written | hours | — |
| 7 | Crit | Founder ruling on V1 transition (coexist/migrate/sunset + pilot organizer) | R7; unplanned = stranded customer + data fork | decision | — |
| 8 | High | Right-size governance to the real team (reviews per phase, deploy rules, drill cadence) + state the staffing plan | R4; prevents decorative-docs culture | days | 7 |
| 9 | High | Independent (non-author) review of the money-path specs (41, 51, 52) | §0; the one place self-review is unacceptable | days | — |
| 10 | High | Define disputes: intake surface, record, resolution states | §6.4; makes the North Star computable | days | — |
| 11 | High | Write the WS auth handshake ADR | R8; first engineering ADR, blocks engine build | days | — |
| 12 | High | Add Lot `Withdrawn` state + pool-exhaustion completion rule to 39/41 | §4.1–4.2; certain village edge cases | hours | — |
| 13 | High | Start WhatsApp BSP selection + Meta template approval now | R9; longest external lead time in the plan | external | 4 |
| 14 | High | Defer public REST API to first external consumer; keep webhooks | §5.1; deletes a whole launch surface | paper | — |
| 15 | High | Commission logo artwork (07 brief) inside the prototype sprint | Brand L2→L4; the five-second test needs a mark | 1 wk | 2 |
| 16 | Med | Right-size DR: cold cross-region restore instead of warm standby | §5.3; cost/complexity honesty | paper | — |
| 17 | Med | Anchor the audit hash-chain head externally, or delete the chain | §5.4; currently circular | paper | — |
| 18 | Med | Right-size load targets (~1k viewers) + keep documented levers | §5.6; test-matrix cost | paper | — |
| 19 | Med | Reconcile triage numbers (42 vs GJ-1); fix inv-34 Task wording; remove dead timer clamp | §6.3; spec hygiene | hours | — |
| 20 | Med | Design first-run/activation (org creation → first tournament) | §2 discoverability gap; second-purchase strategy starts at the first | days | — |
| 21 | Med | Write the support model doc (channels, hours, auction-night escalation, ref-ID workflow) | §9.4; trust product = human answer at 9pm | days | 8 |
| 22 | Med | Write the legal pack checklist (ToS, privacy, refunds, GST registration) with counsel | §9.5; inherited LEGAL-1 | external | — |
| 23 | Med | Spec the live-window calendar as a system (owner, edit rights, failure mode) | §8c; it gates deploys, alerts, crons | hours | — |
| 24 | Low | Vendor consolidation criterion at Phase 2 finalization (fewest meeting SLOs) | R10 | paper | — |
| 25 | Low | Merge overlapping docs opportunistically (22–25, 26+27, 33+34) | §10; maintainability | ongoing | — |

---

## 16 · Implementation readiness

**Is implementation the correct next step? No.** The highest-value next step is a short, cheap validation phase, because the corpus's three Critical unknowns (design-in-pixels, unit economics, phone-bidding validity) are all resolvable in **2–4 weeks for near-zero cost**, while being wrong about any of them mid-implementation costs months across multiple teams. The corpus's own doctrine demands this ordering (67 §2: evidence over confidence).

**Recommended missing phase — "Phase 0B: Proof & Validation" (2–4 weeks):**

1. Visual + motion prototype of the three signature screens, judged against the five-second test (recs 2, 3, 15)
2. One staged mock auction with real users (rec 5)
3. Unit economics + price points (rec 4) and V1 transition ruling (rec 7)
4. Independent money-path spec review (rec 9) + WS auth ADR (rec 11)
5. Spec fixes batch (recs 6, 10, 12, 19) and governance right-sizing (rec 8)

Exit criteria are the blocking conditions below. After Phase 0B, this audit expects the verdict to convert to GO — the foundation is genuinely strong; it is unproven, not unsound.

---

## 17 · FINAL VERDICT

# **HOLD**

Not RESTART — the domain constitution, architecture core, and pattern law are strong, and most major decisions are ones another CTO would independently reach. Not GO or GO WITH CONDITIONS — because the correct next step is not implementation under conditions; it is a different, cheaper activity (validation), and three Critical risks are unpriced.

**Blocking conditions (each with the evidence that clears it):**

| # | Condition | Why it blocks | Evidence that satisfies |
|---|-----------|---------------|-------------------------|
| B1 | FLOODLIGHT proven in pixels | The strategy *is* premium perception (01/02); zero rendered evidence exists (§3) | 3-screen visual+motion prototype (incl. Devanagari name in ceremony, 360px, reduced-motion) passing a recorded founder five-second review |
| B2 | Phone-first bidding validated | The central money interaction is untested with humans (§2.1) | Recorded mock auction: ≥6 real owners, own phones; task success + no critical usability failures; confirm-threshold data |
| B3 | Unit economics established | No margin model exists; Free tier may be structurally unaffordable (§9.1) | Cost model per tournament (WhatsApp/SMS, MDR, infra, AI) vs priced tiers, with Free:Pro scenario margins, founder-accepted |
| B4 | Free-tier notification contradiction resolved | Free tier cannot go live as specified (§6.2) | 45/47 amended: identity-infrastructure classification + tier-annotated catalog |
| B5 | V1 transition ruled | Live product + pilot customer with no successor plan (§9.3) | Recorded founder decision: coexist/migrate/sunset + pilot commitment |
| B6 | Governance right-sized & independent review installed | Current process is unexecutable (§7) and self-certifying (§0) | Revised phase-gate/staffing statement; named non-author reviewer for money-path specs, review delivered |
| B7 | Money-path spec hygiene batch | Constitution defects (§4, §6.3–6.4) should not enter code | 39/40/41/42/70 amendments merged (Withdrawn state, completion rule, dispute definition, triage number, inv-34, clamp) |

B1–B3 are the phase's purpose; B4, B7 are hours of editing; B5, B6 are decisions. Nothing here is months.

---

## 18 · Executive summary

**The Product Operating System is an elegant spine (domain + architecture) wearing a comprehensive shell (patterns + operations), missing a commercial wing, and wrapped in governance it cannot yet honestly execute. It is unproven, not unsound. Hold for 2–4 weeks of validation, then build.**

| Score | /100 |
|-------|------|
| **Overall Product** | **71** |
| Design | 66 (spec 80, evidence 0) |
| UX | 74 |
| Architecture | 84 |
| Engineering | 81 |
| Scalability | 78 |
| Operations | 72 (spec; demonstrated 0) |
| Commercial Readiness | **41** |
| **Overall confidence in this audit** | Medium-High (High on domain/architecture; Medium on design/commercial judgments, which inherently need the evidence Phase 0B produces) |

**Biggest strengths:** the 35-invariant constitution with enforcement mapping (40); single-writer event-sourced engine deleting the reference's simulated coherence (66); one-engine/five-surfaces IA (17); refusals recorded in writing; dignity as enforceable law (C-23); paper mode (61); the determinism test suite (58).

**Biggest weaknesses:** zero rendered design evidence against a design-led strategy; no unit economics; self-certified gates; governance sized for a company that doesn't exist yet; V1 transition unaddressed; the Free-tier contradiction.

**Highest-ROI improvements:** the prototype (days of work de-risks the entire visual strategy); the unit-economics model (days de-risk the business model); the mock auction (one evening de-risks the core interaction); the 45/47 fix (one paragraph un-breaks the Free tier).

**Decisions I strongly support:** C-9, C-3, C-8, C-13, C-16, C-12, C-11 (model), C-24, the invariants, Golden-Journey acceptance, mobile-first as a gate, OTP-as-identity.

**Decisions I would reverse or gate:** dual API planes at launch (defer REST); warm standby (right-size); hash chain as written (anchor or cut); 5k-viewer targets (right-size); self-review as governance (replace); Volt/type stack (gate on prototype, don't reverse blind).

**Missing documents:** unit economics & pricing; V1 transition; support model; legal pack; GTM/launch; product-metrics definitions (incl. disputes); staffing/operating model; first-run/activation spec.

**Missing reviews:** any independent review; customer validation; design review against rendered artifacts; external security review of the engine protocol (pre-build threat model); a11y expert pass on the ceremony.

---

## 19 · The accountability question

**"If you were personally accountable for this product for the next five years, would you authorize implementation today?"**

# **NO.**

**Justification.** I would be authorizing multiple teams to build (a) a premium visual strategy no one has ever seen rendered (§3 — and 01/02 stake the entire competitive position on that first impression), (b) a money interaction no real owner has ever performed (§2.1), and (c) a business model with no cost side (§9.1) — while the constitution that would govern them contains a contradiction that makes the Free tier unshippable (§6.2) and a North Star that cannot be computed (§6.4). Every one of those sentences cites this corpus, and every one is curable in days, not quarters. Spending those days is not caution — it is the corpus's own doctrine (67 §2, 67 §6) applied to itself. The spine of this system is genuinely excellent (§4, §5): in two to four weeks, with B1–B7 cleared, I expect to answer YES with evidence instead of optimism — which is the only way this product, whose entire thesis is that trust must be structural rather than promised, deserves to begin.

*Phase 0A Design Authority audit · 2026-07-11*
