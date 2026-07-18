# PX-1 · 08 — Product Roadmap (PX milestones)

> Product milestones, not IP milestones. Estimates in engineer-weeks (ew) assume the
> velocity evidenced by the repo (single senior team). Dependencies are strict; work
> inside a milestone is parallelizable. Total: ~22 ew build + beta operation.

## PX-1 · Product Shell — 3 ew
**Goal**: the product has a body: shells, navigation, home, identity of the user.
**Scope**: AppShell/LiveShell/PublicShell + Breadcrumb/SubNavTabs/DataTable/StatCard/ShareField/Stepper/Banner (04 §6); re-home all 19 existing pages (Δ P-08…P-25 shell deltas); `/home` (P-10); name gate + `updateProfileAction` (P-08/09); 404/error/loading (P-07); `/gallery` env-gated.
**Depends**: nothing.
**Acceptance**: all 44 existing e2e green under shells (with updated redirect assertions); new-user journey (login → name → home → create org) e2e; nav reaches every page in ≤3 clicks; axe pass on shells.
**Exit**: a stranger with a dev OTP can find and use every built feature unaided.

## PX-2 · Public Website — 2 ew
**Goal**: the product can be discovered, understood, and trusted.
**Scope**: P-01 landing, P-02 pricing, P-03 help (10 articles), P-04 legal, P-05 contact; brand assets (04 §2: wordmark, favicon, OG); `public/` (robots, sitemap, manifest); per-page metadata.
**Depends**: PX-1 (screenshots for landing/help).
**Acceptance**: copy per 05 verbatim; Lighthouse SEO ≥90; OG previews render; legal pages linked from footer + consent lines.
**Exit**: a shared link to `/` converts a stranger to a signed-in user without human contact.

## PX-3 · Real-World Authentication — 1.5 ew (+ founder externals)
**Goal**: strangers can actually sign in.
**Scope**: SMS `OtpSender` adapter for the chosen provider (implements the existing port; template 05 §7), send-rate circuit breaker (RC-4 condition), provider health in supervisor; production `RP_ID`/`RP_ORIGINS`.
**Depends**: founder SMS account; PX-12a deploy for staging verification.
**Acceptance**: OTP delivered to a real handset in <15s on staging; breaker trips in drill; dev inbox remains the dev path.
**Exit**: login works for someone who has never met the team.

## PX-4 · Organizer Workspace — 1.5 ew
**Goal**: the operator consoles feel like one product.
**Scope**: competition tabs + attention dots (P-16…P-19); Stepper on lifecycle; ShareFields; engine-page conduct gate (P-22); org pages polish (P-12…P-14).
**Depends**: PX-1. **Acceptance**: attention dots match `registrationDashboard`/`auctionDashboard` counts; tab-visibility rules (Money/Results) enforced.
**Exit**: J3 (registration→auction-ready) completes with zero typed URLs.

## PX-5 · Registration & Public Competition — 1.5 ew
**Goal**: players and spectators get a front door.
**Scope**: P-06 `/c/[slug]` + `publicCompetitionView` ⚙; register flow inherits name gate; registration-outcome dispatches surfaced (with PX-8's inbox); mobile pass on register/join.
**Depends**: PX-1, PX-2 (shell/brand).
**Acceptance**: J2 e2e: register → approve → see outcome; no auth-only data on public page (verified by test).
**Exit**: an organizer shares one link and players self-serve.

## PX-6 · Live Auction Experience — 1.5 ew
**Goal**: auction night is phone-proof and branded.
**Scope**: LiveShell on D1–D4; phone pass (04 §9) on live/spectate; ceremony + connection copy (05 §6); device-project e2e (iPhone/Pixel) for live journeys.
**Depends**: PX-1. **Acceptance**: live-auction + conduct-ceremony e2e green on device projects; exit door never loses the room.
**Exit**: a 50-phone hall runs a night with no operator instructions.

## PX-7 · Settlement Experience — 3 ew ← the flagship milestone
**Goal**: the money loop closes on-screen.
**Scope**: P-26 settlement console, P-27 case detail, P-28 results, P-29 my-money; capability-gated ⚙ wrappers over the existing writer; settlement grants issuance UI on org page (uses existing `issueGrantAction` with settlement sets).
**Depends**: PX-1, PX-4.
**Acceptance**: officer journey on `demo-cup-settled` seed (06 P-26 AC); my-money reconciles to the paise; forbidden matrix tested per capability; regression suites stay green.
**Exit**: J4 + J5 complete: an owner sees what they owe; a treasurer records, closes, and shows the ceremony.

## PX-8 · Financial Operations Experience — 2.5 ew
**Goal**: documents, dispatches, exports, and the inbox become visible.
**Scope**: P-30 finance workspace, P-31 document detail + download route ⚙, P-11 inbox + bell, receipts-due attention row on /home.
**Depends**: PX-7. **Acceptance**: receipt issued in UI → dispatched in-app → appears in owner inbox → downloadable; Tally XML export downloads and opens in Tally (manual verification once).
**Exit**: J5's document half + J4's receipt moment work end-to-end.

## PX-9 · Administration — 1.5 ew
**Goal**: the founder can see the platform.
**Scope**: P-32 `/admin`, platform.admin grant seed ⚙, health panels; P-33 audit viewer (P2 — build if time).
**Depends**: PX-1. **Acceptance**: read-only verified (no write path from admin routes); loads at 100-org seed.
**Exit**: daily beta operation needs no SQL.

## PX-10 · Help & Documentation — 1 ew (parallel with PX-5+)
**Goal**: self-serve answers exist. **Scope**: article system (MDX), 10 articles with real screenshots, contextual help links from Forbidden/empty states.
**Acceptance**: every Forbidden state links its explaining article.

## PX-11 · Mobile Hardening — 1.5 ew
**Goal**: 360px is a first-class citizen everywhere but Cockpit.
**Scope**: DataTable card collapse on all consoles; bottom-tab shell QA; device e2e for register/live/spectate/money-personal; PWA manifest.
**Depends**: PX-1…PX-8 surfaces exist. **Acceptance**: zero horizontal scroll at 360px repo-wide (automated viewport sweep).

## PX-12 · Public Beta — 2 ew engineering + ops
**12a (can start day 1, parallel): Production existence** — founder externals (Fly/Vercel/Postgres/domains/Sentry/SMS), first deploys, four-role DB flip, staging perf run (existing `perf:*` scripts at checklist §6 scale), alerting on silence (checklist §4).
**12b: Private beta** — 5–10 hand-picked tournaments on production; weekly triage; help-article gap-fill.
**12c: Public beta gate** — 09_PUBLIC_BETA_CHECKLIST all green → open signups.
**Acceptance**: production smoke = full founder scenario (login→competition→auction→settle→receipt) on production infra; PRP-1 report reissued with staging numbers and a GO.

## Sequence & critical path

```
PX-1 ──► PX-2 ──► PX-5 ──► PX-10
  │  └──► PX-4 ──► PX-7 ──► PX-8 ──► PX-11 ──► PX-12c
  ├────► PX-6 ─────────────────┘
  ├────► PX-9 ─────────────────┘
  └(day 1, parallel)► PX-12a ──► PX-3 ──► PX-12b
```
Critical path: **PX-1 → PX-4 → PX-7 → PX-8 → PX-11 → PX-12** ≈ 13–14 ew; with the parallel tracks staffed, calendar time ≈ **11–13 weeks** to the public-beta gate.
