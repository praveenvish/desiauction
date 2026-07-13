# IP-1 MILESTONE PLAN
## Milestone-driven execution of the FLOODLIGHT Design System phase · v1.1 · 2026-07-13 · CTO

> Derived 1:1 from IP-1_DESIGN.md §18 — no scope, decision, gate, or sequence changes. Acceptance and founder review occur milestone-by-milestone; the phase-level DoD, §4 quality gates, and freeze process are untouched. Every milestone ends with something the founder can open in a browser and touch. v1.1 execution refinement: complexity-based estimates (no calendar commitments), the three-output closure package below, and founder-visible-first work ordering *within* each milestone.

## MILESTONE CLOSURE PACKAGE (applies to every milestone)

Each milestone concludes with exactly three outputs — nothing more:
1. **Working demonstration** — runnable from the local gallery/app; the founder opens it, uses it, touches it. A milestone producing only internal artifacts is not complete.
2. **Engineering summary** — brief and factual: scope completed · gates executed · test results · risks · intentional deferrals.
3. **Founder decision** — exactly one of **APPROVED · APPROVED WITH COMMENTS · REWORK REQUIRED**, recorded in the milestone's line in GATES.md at phase close. Comments feed the next milestone; REWORK stops forward motion until cleared.

Within each milestone, when work order is technically equivalent, the founder-visible pieces build first (e.g., in M-IP1-2: Button, Money, Card before Skeleton) so demos are meaningful even mid-milestone.

---

## M-IP1-1 · "Foundation of Light" — tokens, typography, themes

- **Purpose:** the substrate every primitive consumes; the first FLOODLIGHT pixels since va1-rc1.
- **Engineering scope:** `tokens/` (color/space/type/motion/elevation as CSS custom properties + typed TS mirror), `themes.css` (Ink + Daylight, each token-complete per C-4), `fonts/` (Geist npm, Clash Display vendored + licence, Anek Devanagari via fontsource), `/gallery` route scaffold in `apps/web`, contrast-measurement harness in the existing Playwright setup.
- **Deliverables:** gallery pages: token sheet, type ramp (Latin + Devanagari side-by-side), theme flip control.
- **Definition of Done:** both themes render with zero palette literals outside `tokens/` (lint rule live); every semantic color pair's contrast **measured** and recorded; fonts self-hosted, zero external requests (verified in network log); gallery E2E green.
- **Quality gates:** §4 gates 1–4 + gate 5 partial (contrast table) + gate 6 (font page-cost budget measured).
- **Founder review items:** the five-second premium check on the type ramp + token sheet (WI-2 first checkpoint); Devanagari display quality (WI-7 ruling made visible).
- **Expected demonstration:** phone + desktop, flip Ink↔Daylight live, show the measured contrast table.
- **Dependencies:** IP-1_DESIGN.md landed in repo (blocked only by the Desktop-access fix).
- **Estimated complexity:** Small · confidence High.
- **Exit criteria:** closure package delivered (demo + summary + founder decision); contrast table committed; M-IP1-2 unblocked.

## M-IP1-2 · "The Eleven" — primitive set

- **Purpose:** every named-consumer primitive (§9 inventory), production-grade.
- **Engineering scope:** Button/ButtonLink, Field, Select, Badge, Card, Dialog, Toast, Money, Tabs, Skeleton, EmptyState — forwardRef, keyboard contracts, controlled/uncontrolled where relevant; unit tests per primitive (roles/labels/keyboard); gallery page per primitive × theme × state.
- **Deliverables:** all primitives live in the gallery with interactive states.
- **DoD:** axe zero violations across the gallery; every primitive has a keyboard test; Money renders tabular numerals with exact-value slot (C-7); no `any`, no suppressions.
- **Quality gates:** §4 gates 1–5 full (a11y now complete for primitives).
- **Founder review items:** does each primitive pass the "premium product" bar in both themes; Dialog/Toast behaviour feel.
- **Expected demonstration:** founder operates every primitive by keyboard only, then by touch on a phone.
- **Dependencies:** M-IP1-1.
- **Estimated complexity:** Large · confidence High (volume, not uncertainty).
- **Exit criteria:** closure package delivered; axe + keyboard evidence recorded; M-IP1-3/4 unblocked (delivered in order).

## M-IP1-3 · "Every Player Has a Face" — C-25 identity system

- **Purpose:** the constitutional player-identity experience; the phase's highest taste-risk item, surfaced early by design.
- **Engineering scope:** `PlayerIdentity` (xs→hero, photo/placeholder/loading states, no-layout-shift) + pure deterministic `placeholder.ts` generator (seed = player id; script-aware initials Clash/Anek; Ink-scale field + seeded accent pattern; silhouettes unrepresentable); property-style generator tests incl. adversarial names; gallery "placeholder wall".
- **Deliverables:** placeholder wall of 20 generated players (Devanagari, long names, single names, missing data) + photo-state examples.
- **DoD:** determinism proven by test (same seed → identical mark); all name classes render premium; photo path zero-CLS; generator coverage complete.
- **Quality gates:** §4 gates 1–5 + gate 7 (visual review is the point of this milestone).
- **Founder review items:** **WI-9 taste check** — does the placeholder read premium, does it honor C-25's intent; any cultural sensitivities in marks/patterns.
- **Expected demonstration:** the wall on a phone; founder picks any name, we regenerate it live and show determinism.
- **Dependencies:** M-IP1-1 (tokens/type); benefits from M-IP1-2 Card.
- **Estimated complexity:** Medium · confidence Medium (taste risk by design — REWORK here is a feature of the plan, not a failure).
- **Exit criteria:** closure package delivered; founder decision recorded; iteration budgeted.

## M-IP1-4 · "Motion and Voice" — motion grammar + live regions + VA-8 inputs

- **Purpose:** the choreography ingredients (SOLD ceremony composes them in IP-5) and the accessibility voice channel.
- **Engineering scope:** motion tokens (durations/easings incl. ceremony class), enter/exit/emphasis primitives, reduced-motion still-variants, **`useHoldGate`** (time-based safety gate independent of animation — F-AX-1 rule); `Announcer` (polite queue + assertive channel) + `VisuallyHidden`; gallery motion page with reduced-motion toggle.
- **Deliverables:** motion gallery incl. a hold-to-confirm demo that keeps its gate under reduced motion.
- **DoD:** every motion token has a still-variant; hold-gate proven by test in both modes; announcer unit-tested (queue order, interrupt rules).
- **Quality gates:** §4 gates 1–5; gate 5 includes the reduced-motion safety verification.
- **Founder review items:** **the single VA-8 ask, made here:** sound ruling + Hindi voice register (needed for IP-5 composition; recorded when given — absence does not block M-IP1-5).
- **Expected demonstration:** hold-to-confirm with animations on, then with reduced motion — same 3-second gate, different presentation.
- **Dependencies:** M-IP1-1; M-IP1-2 Button (host for the hold demo).
- **Estimated complexity:** Medium · confidence High.
- **Exit criteria:** closure package delivered; safety rule demonstrably structural; VA-8 answers recorded or explicitly deferred by founder.

## M-IP1-5 · "Freeze the Light" — DoD sweep and phase freeze

- **Purpose:** convert a working design system into a *frozen* one IP-2 can trust (RC-6).
- **Engineering scope:** full DoD sweep vs IP-1_DESIGN §14; doc-09 amendment (WI-7) in the closure PR; GATES.md IP-1 entry with contrast table + axe output + phone screenshots; version `ui@0.1.0`; tag `ip1-frozen`.
- **Deliverables:** frozen package, complete gate record, closure summary.
- **DoD:** = the phase DoD (design §14), every line checked with evidence.
- **Quality gates:** all ten §4 gates finalized, incl. gate 8 (founder live demo of the whole gallery) and gate 9 (docs reconciled).
- **Founder review items:** phase acceptance — the gallery IS the acceptance artifact.
- **Expected demonstration:** end-to-end gallery walk on phone + desktop; theme flip; identity wall; reduced-motion proof.
- **Dependencies:** M-IP1-1..4 complete.
- **Estimated complexity:** Small · confidence High.
- **Exit criteria:** closure package delivered; `ip1-frozen` tagged; IP-2 opens only on founder **OPEN IP-2**.

---

**Phase shape: 2 Small + 2 Medium + 1 Large, all High confidence except the deliberate taste-risk milestone (M-IP1-3, Medium).** No calendar commitments; the Blueprint's M2 window remains the phase-level reference. Review cadence: one closure package per milestone (demo ≤15 min + brief summary + one-word decision) replaces a single monolithic phase review; phase-level acceptance at M-IP1-5 unchanged.
