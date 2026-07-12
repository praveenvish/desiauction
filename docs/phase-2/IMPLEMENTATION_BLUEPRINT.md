# IMPLEMENTATION BLUEPRINT
## DesiAuction NEXT · Phase 2 · **v1.1 FROZEN** · 2026-07-12 · CTO

> 🔒 **FROZEN at M0 (2026-07-12), verdict APPROVE WITH CONDITIONS — all six conditions RC-1..RC-6 applied in this version.** Review record: [M0_BLUEPRINT_REVIEW.md](M0_BLUEPRINT_REVIEW.md). No roadmap redesign, no phase resequencing, no governance redesign hereafter; improvements occur only inside the active implementation phase. **Active phase: IP-0.**

> **Authority.** Governed by the Canon (C-1..C-25, `docs/00-index.md`), the Experience Direction (VA-0: ⟪SOUL⟫, EP-1..14, XC-1..12), the 35 invariants (doc 40), and the six Golden Journeys (doc 70). Business behaviour is immutable; this blueprint decides *sequence and discipline*, never product philosophy.
> **Provenance.** Phase X1 closed by executive waiver (`docs/phase-0b/X1_EXECUTIVE_WAIVER.md`). Waived uncertainty is carried here as watch items WI-1..WI-10; open 0B activities (VA-3/5/6/8/9) appear below as **hard gates**, not assumptions.
> **Status: FROZEN (M0 passed).** Only the active phase ever receives detailed engineering design; this document intentionally stays at phase altitude for all phases. No production code before `IP-0_DESIGN.md`.

---

## 1 · MASTER ROADMAP

Nine sequential phases. One active at a time. Each ends frozen.

| # | Phase | Objective (one line) | Complexity | Depends on | Embedded gate |
|---|---|---|---|---|---|
| IP-0 | Foundation & Proven Substrate | Monorepo, CI, environments, observability skeleton — on a substrate proven by the engine tracer bullet | M | Blueprint approval | **VA-5** tracer bullet = exit gate |
| IP-1 | FLOODLIGHT Design System | `packages/ui`: tokens, type, motion grammar, core components, **player identity system (C-25)** | M | IP-0 | **VA-8** sound + Hindi voice rulings = inputs; **WI-7** Devanagari ruling |
| IP-2 | Identity, Tenancy & Access | People, orgs, phone-first auth (OTP + passkeys), grants (C-8), RLS, DPDP data map | M | IP-1 frozen (RC-6); OTP provider procured (RC-1) | Photo-consent design (C-25 × DPDP); independent auth review (RC-4) |
| IP-3 | Competition Core | Tournaments, seasons, teams, players, registration + photo intake, Console shell | M–L | IP-1, IP-2 | GJ-1, GJ-2 pass |
| IP-4 | Auction Engine | Event-sourced ledger, single writer, pure reducer, timers, anti-snipe, slabs, replay, projections (C-9, C-16) | **L** | IP-0 proof, IP-3 data | **VA-6** WS-auth ADR + independent money-path review |
| IP-5 | Auction Experience | The five surfaces (C-3), SOLD ceremony, recovery narration, real-phone multi-device proof | **L** | IP-1, IP-4 | **Mock auction night** on real phones (WI-4/5/6); GJ-3, GJ-4 pass |
| IP-6 | Money & Messaging | Razorpay Pass (C-11/C-18), WhatsApp-first notifications (C-19), invoices | M | IP-3; BSP procured | **VA-3** unit economics w/ live quotes = entry gate |
| IP-7 | Operations & Administration | Audit views, exports, support tooling, live-aware ops (C-22), backup/DR rehearsal | M | IP-4, IP-5, IP-6 | GJ-5, GJ-6 pass |
| IP-8 | Production Readiness → Pilot → GA | Hardening, SLOs, staging rehearsal, comped pilot tournaments, GA | M–L | All | **VA-8 V1-transition ruling (0A-B5)** before GA; pilot instruments for WI-1/2/3/8/9 |

**Start immediately, outside any phase (procurement, zero code):** VA-9 WhatsApp BSP application; Neon + Fly + Sentry accounts; Razorpay KYC; Clash Display licence + Devanagari companion shortlist. These have the longest external lead times.

## 2 · SEQUENTIAL PHASE PLAN

Common structure per phase: objective · scope in/out · deliverables · DoD · acceptance · risks · exit. The universal quality gates (§4) apply to every phase and are not repeated.

### IP-0 — Foundation & Proven Substrate
- **Objective:** an engineering platform the rest of the project stands on — and *proof* the chosen substrate can host the engine before we commit to it.
- **Scope in:** pnpm/turborepo monorepo per C-12 (`apps/web`, `apps/engine`, `packages/core|ui|contracts` — skeletons); TS strict + ESLint + Prettier baseline; CI pipeline with all §4 automated gates; environments (local docker PG, Neon Mumbai dev/staging, Fly dev app); Drizzle + first migration (empty schema + migration discipline proven); OTel + Sentry wiring; secrets management; **object storage + image pipeline provisioned, Mumbai-resident (RC-2 — consumed by IP-3 photo intake)**; the **VA-5 tracer bullet**: a ≤500-line vertical spike — append event → pure reduce → project → ack over WS on Neon+Fly.
- **Scope out:** any product feature, any UI beyond a health page, any schema beyond the spike's throwaway table.
- **Deliverables:** running CI on every PR; deployable hello-engine on Fly Mumbai; tracer-bullet report with measured numbers; `docs/phase-2/IP-0_DESIGN.md` (the only detailed design that exists while IP-0 is active).
- **Definition of Done:** all §4 gates green on an empty-but-real system; **tracer bullet measured: ledger-append→ack p99 ≤ 20ms engine-internal, full replay of 10k events < 10s, on Neon Mumbai + Fly** (pre-registered VA-5 criteria — if it fails, the substrate decision reopens *here*, cheaply, not in IP-4); **fan-out probe (RC-5): ≥200 concurrent WS subscribers receive a published event p95 < 500ms on the Fly instance** (additive to VA-5 — the write path was measured, the read fan-out was not; IP-5's mock night is the wrong place to discover fan-out limits).
- **Acceptance:** founder can clone → `pnpm i` → `pnpm dev` → green; CI badge green; tracer numbers in the report.
- **Risks:** Fly/Neon regional latency surprises (this is the point); CI over-engineering (right-size for solo+AI per 0A).
- **Exit:** tracer report committed, phase frozen, IP-1 design doc authorized.

### IP-1 — FLOODLIGHT Design System
- **Objective:** `packages/ui` makes FLOODLIGHT (C-4/C-5/C-6) concrete once, so no later phase invents visuals.
- **Scope in:** token set (Ink/Chalk/Volt/Gold, both themes, C-4); typography incl. **WI-7 ruling**: Devanagari display companion to Clash (Anek Devanagari is the machine-favoured candidate — decide, record in doc 09); motion grammar (doc 11) incl. reduced-motion still-variants with safety time-gates preserved (RC1 F-AX-1 lesson); core components (button, field, money display C-7, badge, card, dialog, toast, live-region announcer C-15); **player identity system (C-25): photo component + the premium branded placeholder generator (deterministic per player, never a silhouette) + consistency contract for its six surfaces**; Storybook (or equivalent) with axe checks; VA-8 sound ruling + Hindi voice register obtained from founder as phase inputs.
- **Scope out:** page layouts, surface compositions, any app code.
- **Deliverables:** published internal `@desiauction/ui`; token documentation; identity-placeholder spec with rendered samples founder-reviewed against WI-9.
- **DoD:** every component AA-verified (measured contrast, keyboard, focus-visible); tabular numerals enforced in money components; placeholder generator produces founder-approved output for: long names, Devanagari names, missing data.
- **Acceptance:** visual review passes the five-second premium bar on a component gallery page, desktop + real phone (**WI-2, WI-5 first checkpoint**).
- **Risks:** aesthetic drift from VA1-RC1 spirit (reference it, never import it); font licensing.
- **Exit:** package versioned + frozen; changes hereafter via PR with visual review only.

### IP-2 — Identity, Tenancy & Access
- **Objective:** who anyone is, and what they may do — before any domain data exists.
- **Scope in:** people/orgs schema (`org_id` everywhere, RLS defense-in-depth, C-13); phone-first OTP + passkeys (C-24); session management; **grants model (C-8)** with named capability sets; audit log substrate (append-only, actor on every row); DPDP data map + retention rules; **photo-consent capture design** (C-25 makes player photos core data — consent at registration, minors handling, revocation path).
- **Scope out:** payment identity, public profiles.
- **Deliverables:** auth flows working in `apps/web`; grants enforcement middleware + per-capability tests; DPDP register doc.
- **DoD:** authz test matrix (every capability × grant/no-grant) green; RLS verified by attempted cross-tenant reads in tests; OTP rate-limited + no-enumeration; **independent review of the auth surface by the named reviewer (RC-4 — account takeover at auction time is a money-path attack; same reviewer as IP-4, first engagement here).**
- **Acceptance:** founder registers with a real phone, creates an org, invites a second person with a narrower grant, and the narrower grant demonstrably cannot exceed scope.
- **Risks:** OTP provider dependency (procured in IP-0 window); passkey UX on low-end Android.
- **Exit:** security self-review recorded; frozen.

### IP-3 — Competition Core
- **Objective:** everything a tournament is before the auction begins.
- **Scope in:** tournament/season/team/player schema; registration (GJ-1) incl. **photo upload + placeholder fallback wired end-to-end (C-25, on the IP-0 storage pipeline per RC-2)**; **invites are shareable-link based (RC-3): the organizer forwards links through their own WhatsApp — the platform sends nothing; platform messaging arrives in IP-6 and GJ-1 must never depend on it** (kills the 0A defect-#1 shape); team & owner setup; player pools; Console shell in FLOODLIGHT (first real surface, Daylight theme default per C-4); imports (CSV) for players.
- **Scope out:** fixtures/standings (post-GA unless a pilot demands them); auction anything.
- **Deliverables:** GJ-1 (registration) and GJ-2 (tournament setup) passing end-to-end in a real browser incl. real phone.
- **DoD:** journeys green in CI E2E; every list/detail surface shows player identity per C-25's six-surface contract (the three that exist so far: Roster, Profile, Search).
- **Acceptance:** founder creates a real tournament with ≥16 players (mixed: with/without photos) in under 20 minutes unassisted.
- **Risks:** scope creep toward the old product's 15 workspaces — the Canon's cut list governs.
- **Exit:** frozen; data model for auction inputs stable.

### IP-4 — Auction Engine
- **Objective:** the money-truth machine (C-9): boringly correct, provably replayable.
- **Scope in:** `packages/core` pure domain — event types, deterministic reducer, **all applicable of the 35 invariants encoded as property/unit tests**; `apps/engine` — single writer per auction, per-auction ledger with monotonic `seq`, in-process lot timers + durable watchdog (C-16), anti-snipe (timer never shrinks), escalating increment slabs (doc 41; VA-1 pacing evidence), purse math in integer paise (C-7), projections for every surface, snapshot+catch-up protocol, idempotent command API; **VA-6: WS-auth ADR + threat tabletop + independent money-path review** (independent = not the authoring AI session; founder procures the reviewer named in VA-8).
- **Scope out:** all rendering; payments; AI (C-10 — post-GA).
- **Deliverables:** engine service deployed to staging; simulation harness that runs full randomized auctions and asserts invariants + exact purse reconciliation across thousands of runs; replay determinism proof (same ledger → same state, byte-equal).
- **DoD:** invariant suite green; simulation harness green at scale; measured: command→ack p99 ≤ 300ms server-side Mumbai, engine apply p99 ≤ 20ms; kill-and-recover test (engine restart mid-auction → correct resume from ledger) passes; VA-6 review findings resolved or founder-accepted.
- **Acceptance:** founder watches a simulated auction run headless (log/inspector view), kills the engine mid-lot, sees it recover with zero money drift.
- **Risks:** highest-complexity phase; single-writer failover semantics; clock discipline. Mitigation: the substrate was proven in IP-0; behaviour is fully specified (docs 40/41); no UI pressure in this phase.
- **Exit:** engine API + event contracts versioned and frozen in `packages/contracts`.

### IP-5 — Auction Experience
- **Objective:** the five surfaces (C-3) over engine projections — the product's soul (VA-0) made real.
- **Scope in:** Cockpit (conduct, attention-first, hold-to-gavel), Owner Room (hold-to-bid ≥ threshold EP-6, purse truth, resync narration EP-10), Stage (public), Overlay (projector), Console live view; **SOLD ceremony (gold, XC-6: nothing shares the peak)**; C-25 identity on Stage/Owner Room/SOLD ceremony (completing the six-surface contract); degraded modes (EP-9/10: disconnect, stall, recovery louder than failure); full keyboard + live-region strategy (C-15); reduced-motion variants.
- **Scope out:** sponsor features; stream production tooling beyond Overlay.
- **Deliverables:** GJ-3 (conduct) + GJ-4 (public/owner live) passing E2E; **the mock auction night: 6–8 real people, own phones, real venue-grade network, full auction on the real engine** — the VA-2 design executed on production software, discharging WI-4 (hold friction), WI-5 (mobile), WI-6 (multi-device) with *real* evidence at last.
- **DoD:** mock night run with ≥90% unassisted bids and tap-to-feedback < 100ms optimistic / confirmed p95 < 1.5s on venue network; SOLD→Stage p95 < 1s; zero purse discrepancies; AA verified on all five surfaces; deviations logged and classified.
- **Acceptance:** founder runs a lot end-to-end from the Cockpit while two owners bid from phones; the room reacts to SOLD (the EP-2 test — observed, not claimed).
- **Risks:** the waived UX risk concentrates here — this phase's mock night is its primary mitigation; venue network chaos (designed-for, EP-9).
- **Exit:** surfaces frozen; mock-night report committed (this is engineering validation evidence, distinct from the waived X1 research).

### IP-6 — Money & Messaging
- **Entry gate:** **VA-3 complete** — unit economics with live vendor quotes (BSP, Razorpay MDR, infra) proving Pro Pass margin ≥ 70% with 3× messaging buffer and Free tournament < ₹75 with enforceable caps. Pricing is a founder decision made on that model — the 0A Commercial-41 wound closes here or the model changes here, before code.
- **Scope in:** Razorpay Pass purchase (C-11/C-18): order → webhook (HMAC, idempotent) → entitlement; immutable invoices; entitlement locks capabilities never data; WhatsApp-first notifications (C-19) via procured BSP with SMS fallback: invites, auction summons, SOLD receipts (the 10-second receipt beat), results; caps + kill-switch on messaging spend.
- **DoD:** test-mode purchase→entitlement E2E; webhook replay/idempotency tests; refund path defined; message templates approved by BSP; spend caps enforced in code.
- **Acceptance:** founder buys a Pass in test mode and receives the WhatsApp receipt.
- **Risks:** BSP template approval latency (procurement started in IP-0 window); Razorpay KYC.
- **Exit:** first real (₹1) production transaction executed and refunded; frozen.

### IP-7 — Operations & Administration
- **Scope in:** organizer-facing audit/history views (trust surface — every money event inspectable, C-2); exports (squads, spend, results); support tooling (impersonation with consent + audit); **live-aware operational freeze (C-22)** enforced in deploy tooling; backup/restore rehearsed against production-shaped data; runbooks (auction-night oncall, engine restart, BSP outage → paper-mode guidance); GJ-5 + GJ-6 pass.
- **DoD:** restore rehearsal verified by row-count + invariant checks; deploy blocked by a live auction in a real test; runbooks executed once for real, not just written.
- **Acceptance:** founder performs a restore-from-backup drill following only the runbook.
- **Risks:** under-investment (unglamorous phase) — it is the North Star phase: zero silent failures is operational, not aesthetic.
- **Exit:** ops rehearsal report; frozen.

### IP-8 — Production Readiness → Pilot → GA
- **Scope in:** load tests at right-sized targets (0A ruling: hundreds of concurrent viewers per auction, not 5k); SLO alerts live (C-17); security pass (OWASP-scoped) + dependency audit; staging→prod deploy→rollback rehearsed; **Pilot: ≥2 comped real tournaments, founder-supported**, running the pilot instrument pack — the watch-item questions X1 never answered, now asked in production: five-second impressions (WI-2), trust probe (WI-3), 48h ceremony recall (WI-8), direction sentiment (WI-1), identity/placeholder reception (WI-9); **GA gate: VA-8 V1-transition ruling recorded** (what happens to the old product and its pilot organizer — 0A blocking condition B5), pilot defects triaged to zero Critical/High, all six Golden Journeys green in production.
- **DoD:** two pilot tournaments completed with **zero disputes and zero silent failures** (C-2, measured — dispute intake defined, closing 0A defect #6); pilot instrument results recorded honestly (as pilot evidence, clearly labelled — never backfilled into the X1 ledger).
- **Acceptance:** founder declares GA on the evidence page, not on feel.
- **Exit:** ✅ GA. Post-GA backlog opens (analytics, AI edges per C-10/D-005, public REST per deferred C-14, fixtures).

## 3 · ENGINEERING OPERATING MODEL

**Team reality (0A right-sizing):** founder (product authority, reviews, external procurement, pilots) + AI CTO/engineering (design, implementation, tests, docs). No process invented for teams that don't exist.

- **Repository:** this repo (`desiauction-next`). `docs/` (governance — unchanged), `prototypes/` (frozen reference, never imported), `apps/`, `packages/` (created in IP-0). Old repo remains read-only behavioural reference.
- **Branching:** trunk-based. `main` protected, always releasable. Short-lived branches `ip<N>/<slug>`; merge via PR only; no long-running branches, no parallel phase branches.
- **Commits:** conventional commits (`feat:`, `fix:`, `test:`, `docs:`, `chore:`); small and reviewable; cite Canon/doc/invariant IDs when touching governed behaviour (e.g. `feat(engine): anti-snipe timer floor (inv-14, doc 41)`).
- **PR rules:** every PR = description citing governing sections + tests + green CI. Founder reviews phase-gate PRs and anything touching money, auth, or ceremony; routine PRs are self-reviewed by AI with the checklist, honestly.
- **Review checklist:** behaviour matches docs 40/41/70 · no workspace cross-imports · money integer-paise only · authz enforced per-capability · a11y on any UI · migration reversible-in-dev/expand-contract-in-prod · observability on new paths · no TODO without a linked backlog entry.
- **Testing pyramid:** unit (pure `packages/core`: reducer property tests, invariant suite — the widest layer) → integration (API+DB+engine on ephemeral Postgres) → E2E (six Golden Journeys, real browser, incl. one real-phone-viewport run) → simulation (randomized full-auction harness, IP-4 onward, runs nightly).
- **Coverage targets:** `packages/core` ≥ 90% lines *and* every invariant has a named test; apps ≥ 75% on changed code; coverage never merged as a metric to chase — invariant + journey coverage is the real bar.
- **CI gates (every PR):** typecheck (strict, zero `any`) · lint zero errors · unit · integration · build · contracts breaking-change check · migration up test · axe on component gallery · bundle budget on `apps/web`.
- **Release gates (every deploy):** golden-journey E2E green · migrations rehearsed on staging copy · **live-window check (C-22)** · Sentry release tagged · rollback plan stated in the deploy PR.
- **Migrations:** Drizzle-generated, hand-reviewed; expand-and-contract in prod; forward-only in prod; destructive changes need a dedicated founder-approved PR.
- **Feature flags:** minimal by design — environment config + unlisted routes for dark launch; kill-switches for exactly two things: realtime fan-out and messaging spend. No flag platform.
- **Observability:** OTel traces on every command path, structured JSON logs with `org_id`/`auction_id`, Sentry both apps; SLOs from IP-4: engine apply p99 20ms, command ack p99 300ms, SOLD→Stage p95 1s, tap-feedback p95 1.5s confirmed; alert sensitivity escalates during LIVE windows (C-17).
- **Coding standards:** TypeScript strict everywhere; pure domain has zero IO imports (enforced by lint boundary rules); workspaces never import each other (C-12); UI consumes `@desiauction/ui` only — surfaces never define colours/spacing locally.
- **Architecture rules (hard):** single writer per auction · reducer pure + deterministic · projections rebuildable from ledger alone · no surface computes money or outcomes (C-3) · AI never on the money path (C-10) · idempotency keys on money-adjacent POSTs · public REST deferred until post-GA (0A ruling) · audit hash-chain replaced by external anchor decision post-GA (0A ruling — cut for now).

## 4 · UNIVERSAL PHASE GATE CHECKLIST

A phase closes only when all ten pass. Recorded per phase in `docs/phase-2/GATES.md` at each closure.

| # | Gate | Evidence required |
|---|---|---|
| 1 | Type safety | `tsc --strict` clean, zero suppressions added |
| 2 | Lint | zero errors, boundary rules green |
| 3 | Unit tests | green + coverage bar for the phase |
| 4 | Integration tests | green on ephemeral PG in CI |
| 5 | Accessibility | AA measured (contrast numbers, keyboard walk, screen-reader pass on new surfaces) |
| 6 | Performance | phase-specific targets measured, numbers in the gate record |
| 7 | Visual review | FLOODLIGHT conformance on real phone + desktop, screenshots attached |
| 8 | **Founder review** | live demo, sign-off recorded with date |
| 9 | Documentation | phase design doc final; affected canon docs (40/41/70/09…) reconciled |
| 10 | Architecture review | hard rules audit; **independent reviewer for IP-2 (auth surface, RC-4) and IP-4 (money path, VA-6)** — same named reviewer, two engagements |

## 5 · RISK REGISTER

| ID | Risk | Sev | Mitigation / owner |
|---|---|---|---|
| R-1 | Waived UX risk (WI-1..10): direction/trust/mobile never formally validated | High | Concentrated mitigations: IP-1 gallery review, **IP-5 mock night**, IP-8 pilot instruments. Founder-owned by waiver. |
| R-2 | Commercial model unproven (0A: 41/100); VA-3 pending | High | Hard entry gate on IP-6; pricing decided on live quotes, not hope. |
| R-3 | Solo-founder calendar = program bottleneck (X1's lesson) | High | Founder time budgeted per phase (~2–4h/wk + gate demos); procurement front-loaded; AI executes everything delegable. |
| R-4 | Substrate assumptions (Fly/Neon latency, single-writer failover) | Med | IP-0 tracer bullet before any engine code (VA-5 criteria pre-registered). |
| R-5 | Scope creep vs frozen behaviour | Med | Canon + cut list govern; RC2-style capture discipline continues in implementation backlogs. |
| R-6 | WhatsApp BSP procurement/template approval lead time | Med | Started day 0; SMS fallback designed from the start. |
| R-7 | V1-transition ruling absent (0A-B5) | Med | Blocks GA, not build; scheduled with founder before IP-8. |
| R-8 | Venue-grade networks (patchy 4G, shared WiFi) | Med | EP-9/10 degraded modes are IP-5 scope, tested at mock night, not retrofitted. |
| R-9 | **C-25 × DPDP: player photos = personal data of possibly-minor players** | Med | Consent at registration, storage/retention rules in IP-2 data map, revocation path, **Mumbai-resident object storage (RC-2)**; legal check before IP-3 photo intake ships. |
| R-10 | Type licensing / Devanagari display gap (WI-7) | Low | Resolved as an IP-1 ruling; Anek Devanagari is the evidenced candidate. |
| R-11 | **Same-author governance**: blueprint, reviews, and code share an author; self-certification was 0A's finding zero | High | Numeric evidence-based DoDs (measured p99s, journey E2Es — adjectives can be faked, numbers cannot); founder live demo at every gate; independent reviewer at IP-2 + IP-4 (RC-4); pilot evidence labelled and never backfilled. |

## 6 · MILESTONE PLAN

Durations are ranges for the founder+AI operating model; sequence is the commitment, dates are not. One phase active at a time; the clock on each starts at prior freeze.

| Milestone | Marks | Cumulative estimate |
|---|---|---|
| M0 Blueprint approved | IP-0 opens | week 0 |
| M1 Substrate proven | IP-0 frozen (tracer numbers in repo) | +1–2 wk |
| M2 Design system frozen | IP-1 (incl. C-25 identity system) | +3–5 wk |
| M3 Auth + tenancy frozen | IP-2 | +5–7 wk |
| M4 First real tournament created | IP-3 (GJ-1/2 green) | +7–10 wk |
| M5 Engine survives kill-test | IP-4 (independent review done) | +10–14 wk |
| M6 **Mock auction night** | IP-5 (GJ-3/4 green; WI-4/5/6 discharged) | +13–18 wk |
| M7 First rupee (test) collected | IP-6 (VA-3 passed first) | +15–20 wk |
| M8 Ops rehearsed | IP-7 (GJ-5/6 green) | +17–22 wk |
| M9 Pilot tournaments complete | IP-8 pilot | +19–26 wk |
| M10 **GA** | V1 ruling recorded, zero disputes in pilot | +20–28 wk |

## 7 · TEAM WORKFLOW

Per phase: **(1) Kickoff** — AI writes `IP-<N>_DESIGN.md` (detailed engineering design, the only detailed design in existence), founder approves. **(2) Build** — vertical slices, each PR shippable, CI always green. **(3) Weekly checkpoint** — live demo to founder, ≤30 min, decisions logged. **(4) Gate review** — the §4 checklist executed with evidence, recorded in `GATES.md`. **(5) Freeze** — phase tag `ip<N>-frozen`; regressions after freeze are defects, not iterations. Founder inputs are front-loaded per phase and listed in each kickoff so calendar risk (R-3) is visible weeks ahead.

## 8 · IMPLEMENTATION READINESS ASSESSMENT

**Ready:** behaviour fully specified (docs 40/41/70 + Canon 25); design language specified (05–18) with a browser-proven reference (`va1-rc1`); architecture decided and audit-hardened (0A keeps: C-9/C-3/C-8/C-13/C-16); repo/discipline model defined (this document); AI engineering capacity available now.

**Not ready — must land during IP-0 window (all founder-owned, all external):** ① Neon + Fly + Sentry accounts; ② Razorpay KYC start; ③ **WhatsApp BSP application (longest lead — start today)**; ④ Clash Display licence confirmation + Devanagari decision input; ⑤ name the independent reviewer (scope: IP-2 auth + IP-4 money path, per RC-4); ⑥ DPDP/photo-consent legal check (R-9); ⑦ schedule the VA-8 half-day (sound ruling, Hindi voice register, V1-transition ruling — the last may wait until pre-IP-8 but is cheapest decided early); ⑧ **SMS/OTP provider account (RC-1 — blocks IP-2)**; ⑨ **object-storage provider selection, Mumbai region (RC-2 — provisioned in IP-0, blocks IP-3)**.

**Verdict: READY TO OPEN IP-0 upon founder approval of this blueprint.** Nothing in the not-ready list blocks IP-0 code; everything in it blocks a *later* phase and is therefore started now.

---

*Blueprint v1.1 · CTO · 2026-07-12. M0 passed (APPROVE WITH CONDITIONS, all conditions applied — see M0_BLUEPRINT_REVIEW.md). **FROZEN.** Active phase: IP-0. The next artifact is `IP-0_DESIGN.md` — no code before it.*
