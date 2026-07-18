# PX-1 · 10 — Executive Summary

**Program**: Productization (PX-1) · **Date**: 2026-07-16 · **Basis**: PRA-1 (accepted) + frozen platform IP-1…IP-6.

## What this program is

PRA-1 established that the repository is a certified platform without a product:
~17 deep capabilities invisible behind missing navigation, a placeholder homepage,
undeliverable OTPs, nameless accounts, and a money pipeline that goes dark at the
gavel. PX-1 is the complete product definition that fixes this **without touching
the backend**: ten binding documents specifying every route, screen, journey,
component, word, and milestone needed to reach public beta.

## The design in one paragraph

Three shells (Public, Console, Live) wrap the existing pages and 21 new ones. A
five-item rail (Home · Competitions · Organizations · Money · Help) and a
phase-aware competition tab row make everything reachable in ≤3 clicks. `/home`
replaces the `/account` dead end with an attention queue computed from existing
dashboards. A one-time name gate closes the nameless-account defect using the
existing `people.name` column. A public competition page (`/c/[slug]`) gives
registration and spectating a shareable front door. The settlement console and
finance workspace expose the already-certified settlement writer and finops
snapshot layer — obligations, manual collections, waivers, closure ceremony,
receipts, Tally exports — closing the money loop on-screen with **zero new
financial truth**. A marketing site, help center, legal pages, inbox, results
page, and a read-only admin console complete the product. Everything new is UI
plus ~14 thin, capability-gated wrappers over functions that already exist and
are already tested.

## Discipline guarantees (the freeze, honored)

- Every screen's API mapping names existing exports (verified against
  `server/*/actions.ts`, `server/settlement/writer.ts`, finops server index).
- The only new server code is enumerated in 02 §I: one webhook route (calling the
  existing `handleRazorpayWebhook`), one artifact download route, ~8 action
  wrappers, 2 public composite reads, 1 profile action, 1 grant seed.
- Two places the canon wanted more than the frozen backend offers were **ruled,
  not fudged** (01 §7): no competition-settings tab; inbox ships read-only if a
  seen-marker is barred. No fake workflows exist anywhere in this definition.

## Plan and cost

Twelve PX milestones (08): shell → public site → real SMS auth → organizer
workspace → registration/public page → live experience → **settlement (flagship)**
→ finops/inbox → admin → help → mobile → beta. Critical path ≈ 13–14
engineer-weeks; **11–13 calendar weeks** to the public-beta gate with parallel
tracks. The gate is the 60-item production-verified checklist (09), ending with a
non-engineer running the full founder scenario on production, screen-recorded.

## The final question

> *"If a world-class product design team joined tomorrow, could they implement the
> entire product from these documents without asking a single functional question?"*

**YES — for every functional decision.** Each page has purpose, wireframe or
as-built delta, component hierarchy from a named kit, all four states, exact API
mapping to existing exports, permission gates from the existing capability
vocabulary, responsive rules, and testable acceptance criteria; journeys cover
every persona including failure branches; enum→badge mapping, copy, and empty
states are canonical and complete.

Three items remain open **by design, and none is functional**: (1) choice of SMS
provider (founder procurement; the port and template are specified), (2) legal
ratification of the terms/privacy/refund skeletons (counsel, not design), and
(3) real photography/screenshots for landing and help (requires the built shell;
scheduled inside PX-2/PX-10). A design team hitting any other unanswered question
should treat it as a defect in these documents and file it against PX-1.

## Deliverables

01 Information Architecture · 02 Screen Specifications · 03 User Journeys ·
04 Design System · 05 Content Guide · 06 Page Blueprints · 07 Gap Matrix ·
08 Roadmap · 09 Beta Checklist · 10 This summary — all under `docs/product/PX-1/`.
