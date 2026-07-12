# M0 — IMPLEMENTATION BLUEPRINT REVIEW
## Founder + CTO Approval Gate · 2026-07-12 · Final governance review

> **Same-author disclosure (audit finding zero applies):** this review and the blueprint share an author. It has been conducted adversarially — every finding below came from attacking dependencies and gates, not re-reading prose — but the structural counterweights are what make it safe: numeric evidence-based DoDs (a same-author review cannot fake a p99), the founder demo at every gate, and the **named independent reviewer** whose scope this review widens (RC-4). Recorded so no one later mistakes this for arms-length certification.

---

## 1 · EXECUTIVE SUMMARY

The blueprint is structurally sound and executable: the sequence is defensible from first principles (each challenged below, three resequencings considered and rejected with reasons), behaviour is fully specified upstream so different engineers converge, the open 0B evidence gaps are handled as hard gates rather than hidden assumptions, and the waived X1 risk has named, phase-assigned mitigations. The review found **no sequence, phase-structure, or governance defects** — and **six mandatory, precisely-scoped condition fixes**, all of the same species: *dependencies made invisible by recency* (C-25 is hours old; its storage pipeline appears nowhere) or by *optimism* (an OTP provider was mentioned in a risk note but never procured; registration invites silently assumed a messaging platform that arrives three phases later). Each is a one-paragraph fix, none reopens design.

## 2 · OVERALL READINESS

## **GO WITH CONDITIONS** — all six conditions applied to the blueprint in this same governance event (v1.0 → v1.1), which therefore freezes.

## 3 · BLUEPRINT SCORE

| Dimension | Score | Basis |
|---|---|---|
| **Overall** | **84** | Executable now; conditions were gaps, not flaws |
| Architecture | 88 | Inherits the audit-hardened Canon; adds no architecture of its own (correct) |
| Execution | 84 | One-active-phase + freeze discipline + numeric DoDs; single-human bottleneck is named and budgeted, not solved (unsolvable) |
| Maintainability | 86 | Ledger-first domain, workspace boundaries lint-enforced, no speculative phases; will read sensibly in two years because behaviour docs, not this file, carry the meaning |
| Engineering | 85 | Standards complete and right-sized; testing pyramid anchored on invariants not coverage theater |
| Product | 82 | Every phase maps to journeys or the trust North Star; IP-0 is the only engineering-driven phase and it exists to de-risk, which is product value under C-2 |
| Commercial | 72 | The blueprint *handles* the 0A Commercial-41 wound correctly (VA-3 as a code-blocking entry gate) but cannot resolve it; the score stays depressed until VA-3 produces numbers |

## 4 · REQUIRED CHANGES (mandatory — applied in v1.1)

| ID | Change | Why it is blocking |
|---|---|---|
| **RC-1** | Add **SMS/OTP provider procurement** to the day-0 externals list | Phone-first auth (C-24) is IP-2's core; the provider was named as a risk but never as a procurement. Without it IP-2 stalls on an external lead time discovered mid-phase. |
| **RC-2** | Add **object storage + image pipeline** (Mumbai-resident, DPDP-compatible) to IP-0 provisioning + day-0 externals; photo intake in IP-3 consumes it | C-25 made player photos core product data hours before the blueprint was written; the blueprint carried the *consent* obligation (R-9) but not the *storage* dependency. Blocks IP-3 and therefore the C-25 six-surface contract. |
| **RC-3** | IP-3 registration invites are **shareable-link based** — organizer forwards via their own WhatsApp; platform messaging remains IP-6 | GJ-1 otherwise hides a BSP dependency three phases early — the exact shape of 0A defect #1 (free tier unshippable as written). Making the link-first pattern explicit kills the regression. |
| **RC-4** | **Independent reviewer scope = IP-2 auth surface + IP-4 money path** (two engagements, same named reviewer) | Account takeover at auction time IS a money-path attack. Auth reviewed only by its own author fails the same test this review discloses in its header. |
| **RC-5** | IP-0 tracer bullet gains a **fan-out probe**: ≥200 concurrent WS subscribers receive a published event p95 < 500ms on the Fly instance | The single-writer engine also fans out to viewers; the original tracer proved write-path latency only. Discovering fan-out limits at the IP-5 mock night is the most expensive possible place. (Additive measurement — strengthens the pre-registered VA-5 gate, cannot game it.) |
| **RC-6** | Delete the "(IP-1 partial ok)" dependency ambiguity: IP-2 consumes **frozen** IP-1, strictly | "Partial ok" quietly licenses parallel phases, contradicting the one-active-phase constitution on page one. Ambiguity in the discipline document is a defect by definition. |

Risk register amendment (rides with conditions): **add R-11 — same-author governance risk** (High): all reviews in this program are structurally same-author; mitigations = numeric evidence-based gates, founder live demos, independent reviewer at IP-2/IP-4. **Amend R-9** to include storage residency (Mumbai) alongside consent.

## 5 · RECOMMENDED IMPROVEMENTS (non-blocking)

1. **WI-3 early signal:** run the trust probe ("stranger reads the Stage: who won, at what price?") at the IP-5 mock night, not only at pilot — the instrument is free once the mock night exists. (Addition, not reassignment; pilot remains the item's home.)
2. **IP-1 scope guard:** build only components with a named consumer in GJ-1..6 or the five surfaces; a design system built ahead of its consumers overfits. The va1-rc1 reference mitigates this for live surfaces; apply the same discipline to Console components.
3. **Email provider** (fourth channel, C-19) procured before IP-6 — cheap, occasionally on critical path for invoices.
4. Consider making the IP-4 simulation harness a permanent nightly CI job post-freeze, not a phase artifact — it is the strongest regression net the money path will ever have.

## 6 · PHASE-BY-PHASE REVIEW

- **IP-0 Foundation:** Correct first phase; the tracer bullet is the roadmap's best idea — it prices the substrate before the engine mortgages it. Weakness found: write-path-only measurement → RC-5. With RC-2's storage provisioning added, scope is complete. Independently completable, freezable. **Pass (with RC-2/RC-5).**
- **IP-1 Design System:** Right position — before any real surface, after substrate. Challenged: "should it move after IP-3 so components have consumers?" Rejected — auth (IP-2) and registration (IP-3) would then invent throwaway UI, violating no-temporary-implementations. Improvement 2 bounds the vacuum risk. C-25 identity system correctly placed here as a *system*, not a feature. **Pass.**
- **IP-2 Identity/Tenancy:** Challenged the order vs IP-1 (see above) — holds. Two defects found: procurement gap (RC-1) and self-reviewed auth (RC-4). DPDP data map + consent design correctly land here, before any photo is collected. **Pass (with RC-1/RC-4/RC-6).**
- **IP-3 Competition Core:** Hidden messaging dependency found and severed (RC-3); storage dependency found (RC-2). Scope-out of fixtures is right (0A cut list). Acceptance ("real tournament, ≥16 mixed-photo players, <20 min unassisted") is the blueprint's most honest gate. **Pass (with RC-2/RC-3).**
- **IP-4 Auction Engine:** Challenged hardest. Considered splitting the pure domain core out to run earlier (highest-complexity item, front-load the risk) — rejected: the reducer is complex but not *uncertain* (behaviour fixed by docs 40/41; the uncertain part — the substrate — is already de-risked in IP-0), and an early split would either idle waiting for IP-3's data shapes or invent stubs. Kill-and-recover DoD, replay determinism, and the simulation harness are exactly the right gates. **Pass.**
- **IP-5 Auction Experience:** The mock auction night is the roadmap's center of gravity — the waived X1 risk (WI-4/5/6) gets real evidence here on real software. Numeric DoDs carried from pre-registered VA-2 criteria (≥90% unassisted) — correct lineage. Add improvement 1. **Pass.**
- **IP-6 Money & Messaging:** VA-3 as an *entry* gate (economics before code) is the single most important commercial control in the program; confirmed. Challenged pilot-before-money ordering — rejected moving pilot earlier: ops (IP-7) exists precisely so a pilot cannot silently fail, and C-2 defines the product by that. **Pass.**
- **IP-7 Operations:** "Runbooks executed once for real" is the difference between this phase existing and pretending. Correctly positioned before any real organizer depends on the system. **Pass.**
- **IP-8 Pilot → GA:** Pilot instruments honestly labelled as pilot evidence, never backfilled into the X1 ledger — the waiver's integrity survives contact with implementation. VA-8 V1-transition ruling as GA gate correctly blocks GA, not build. **Pass.**

## 7 · RISK REGISTER REVIEW

R-1..R-10 **confirmed** at stated severities; R-3 (founder calendar) re-confirmed as the program's most likely failure mode — X1 already demonstrated it once. **Amended:** +R-11 (same-author governance, High), R-9 extended to storage residency. No risk deleted. Watch items WI-1..WI-10: all ten verified correctly assigned; zero reassignments required; WI-3 gains an additional early checkpoint (improvement 1).

## 8 · FINAL RECOMMENDATION

## **APPROVE WITH CONDITIONS.**

The six conditions are applied to the blueprint in this same governance event. Per the freeze rule: **the Implementation Blueprint v1.1 is FROZEN.** No future roadmap redesign, no phase resequencing, no governance redesign. Improvements occur only inside the active implementation phase.

**Governance is complete. The active phase is IP-0. The next artifact is `IP-0_DESIGN.md`. The founder's parallel track is the day-0 externals list (now eight items, incl. RC-1/RC-2).**

*M0 review · CTO · 2026-07-12 15:32 IST.*
