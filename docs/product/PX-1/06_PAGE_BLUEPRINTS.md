# PX-1 · 06 — Page Blueprints

> One blueprint per page. New pages (★) get full blueprints with wireframes.
> Existing pages (Δ) get delta blueprints — their as-built structure is the spec,
> plus the listed changes. Conventions from 04 §10 apply everywhere; the four
> mandatory states (04 §8) are acceptance criteria on every page and are only
> called out where their design is non-obvious. All copy references are to 05.

Global acceptance criteria (every page):
- AC-G1 Renders in its shell; correct rail/tab active state; `<title>` mirrors breadcrumb.
- AC-G2 Empty/loading/error/forbidden states designed per 04 §8, copy per 05.
- AC-G3 Usable at 360px (Cockpit: 768px) with no horizontal body scroll.
- AC-G4 Zero axe serious violations; focus lands on `h1` after navigation.
- AC-G5 Calls only the APIs named in its blueprint.

---

## ★ P-01 `/` Landing (PublicShell)

**Wireframe (desktop / mobile stacks in order)**
```
[Header: wordmark | Features Pricing Help | Sign in]
[HERO  h1 + sub + CTA-primary + CTA-secondary          ]
[      product still: live room on projector + phones  ]
[PROBLEM: 3 quote-cards (the disputes)                 ]
[PROMISES: 3 cards (one truth / television / books)    ]
[HOW IT WORKS: 4 numbered steps, horizontal → vertical ]
[INDIA STRIP: UPI · ₹ · Devanagari · phone sign-in     ]
[BETA NOTE + CTA repeat]
[Footer: About Pricing Help Contact Terms Privacy Refunds]
```
**Components**: PublicShell, Button/ButtonLink, Card ×7, static imagery (brand §04-2). **Interactions**: CTAs only. **API**: none. **Permissions**: public. **Loading**: static — none. **Responsive**: hero image hides <720px; steps stack.
**AC**: copy exactly per 05 §2 · lighthouse SEO ≥ 90 · OG image renders in link preview · both CTAs navigate.

## ★ P-02 `/pricing` — per 05 §3. Components: PublicShell, 3 tier Cards, Banner (beta), FAQ accordion (details/summary, no JS lib). AC: prices match docs/45; beta banner present; no checkout affordance exists.

## ★ P-03 `/help`, `/help/[article]` — index = card list of 10 articles (05 §8); article = prose page, 720px measure, sticky "In this article" >1024px. Source: MDX in `apps/web/content/help/`. AC: all 10 launch articles exist, each with contact footer.

## ★ P-04 Legal trio `/legal/*` — prose pages from 05 §9 skeletons. AC: linked from footer + registration consent line.

## ★ P-05 `/contact` — support email, WhatsApp number, response-time promise, link to /help. AC: reachable from error page and Forbidden states.

## ★ P-06 `/c/[slug]` Public competition page (PublicShell)

```
[Header]
[h1 Competition name          | Badge status ]
[Org name · location · dates                  ]
[CTA row: (Register — if registration_open)
          (Watch live — if auction live)
          (Results — if closed)               ]
[Published fixtures list (read-only)          ]
[Footer]
```
**API**: ⚙ `publicCompetitionView(slug)` = existing `registrationLanding` + published-only subset of `calendarView` on system pool. **States**: not-found → branded 404; nothing-published → fixtures section hidden. **AC**: anonymous render <1s TTFB cached; register CTA carries `next=` login round-trip; no auth-only data leaks (fixture times/venues only — no phone numbers, no registration lists).

## ★ P-07 404/error/loading — copy 05 §5; error.tsx includes digest id for support. AC: mistyped slug shows 404 with Home link; thrown server error shows retry that actually re-renders.

---

## Δ P-08 `/login` (PublicShell)

**Delta**: (1) success redirect → `next` ?? `/home` (never `/account`); (2) **step 3 "name gate"**: if verified session has `name === null`, render name field before redirect — same panel, heading "What should we call you?", help "Appears on team sheets and the auction stage", submit → ⚙ `updateProfileAction`; (3) shell + brand.
**API**: existing OTP/passkey actions + ⚙ updateProfileAction. **AC**: existing login e2e stays green with new redirect; nameless legacy session hitting any Console page is redirected into the name gate once (guard in AppShell layout); passkey path also passes the gate.

## Δ P-09 `/account` — Delta: Console shell; add Profile card (name Field + save via ⚙ updateProfileAction; phone read-only with "Phone changes: contact support" hint 05); keep security panels as built. AC: rename reflects in top-bar avatar menu instantly.

---

## ★ P-10 `/home` (Console shell) — the product's center

```
[Breadcrumb none | h1 "Good evening, {name}"          ]
[ATTENTION QUEUE: list of action rows                  ]
   ⚠ 12 registrations to review — MPL 2026 → /registrations
   ⚠ Auction readiness: 2 blockers — MPL 2026 → /auction
   ₹ 3 receipts due — Malad CC → /org/malad-cc/money
   ₹ You owe ₹40,000 — Mavericks, MPL 2026 → /money
[MY COMPETITIONS: grid of competition Cards (as-built) ]
[MY SCHEDULE: next 5 fixtures (organizerScheduleView)  ]
[+ Create competition (right-rail action)              ]
```
**Attention row sources (all existing)**: registrationDashboard stats per competition; auctionDashboard readiness; receiptCandidates per org (settlement grant only); ⚙ myMoneyView obligations. Rows render only for granted capabilities; zero rows + zero orgs → EmptyState (05 §12).
**Loading**: skeleton of 3 attention rows + card grid. **AC**: every attention row deep-links to the exact acting screen; new user sees onboarding empty state; page composes in one server render (no client fetch waterfalls).

## ★ P-11 `/inbox` — NotificationList of person-scoped dispatch rows (existing `dispatchSnapshot` filtered to party=person), newest first, kind icon per 05 §7 template map, row click → deep link (receipt → document, approval → competition). Read-only V1. **AC**: bell badge count === unread rows rendered; every template type from 05 §7 has a designed row.

## Δ P-12 `/orgs`, P-13 `/org/[slug]`, P-14 `/org/[slug]/venues` — Delta: shell + breadcrumb; invite/registration URL fields become ShareField; members table → DataTable (card collapse). APIs unchanged. AC: as-built e2e green under new shell.

## Δ P-15 `/competitions` — Delta: shell; "Your schedule" card stays; create form in right column ≥1024px. 
## Δ P-16 `/competitions/[slug]` Overview — Delta: SubNavTabs mount (Overview active); lifecycle panel gains Stepper (draft→setup→registration_open→registration_closed); registration ShareField + "Public page" ShareField (`/c/[slug]`). APIs unchanged.
## Δ P-17 Registrations tab — Delta: shell/tabs; table → DataTable with card collapse; bulk bar → bottom sheet <720px. APIs unchanged (all 8 existing actions).
## Δ P-18 Fixtures tab (+calendar/match-day) — same treatment.
## Δ P-19 Auction tab (hub) — Delta: shell/tabs; readiness list becomes checklist rows with attention dots feeding the tab badge; post-live section links Ledger · Replay · Results. 
## Δ P-20 ledger / P-21 replay / P-22 engine — Delta: shell; engine page adds `auction.conduct` gate → Forbidden state otherwise.
## Δ P-23 live / P-24 cockpit / P-25 spectate — Delta: LiveShell (exit door, status strip); phone pass per 04 §9; ceremony + connection copy per 05 §6. No functional changes.

---

## ★ P-26 `/competitions/[slug]/money` Settlement console (Console shell, Money tab)

```
[Tabs: … Money active]
[Stepper: opened → verified → settling → settled → closed]
[Banner (conditional): DISCREPANT — verification failed …]
[STATS: Total due | Collected | Outstanding | Waived     ]
[OBLIGATIONS DataTable:
  Team | Obligation ₹ | Collected ₹ | Outstanding ₹ | ⋯row actions]
[RECORD COLLECTION card:
  Select team → amount (₹ Field) → method (cash/upi-direct/bank)
  → note → [Record payment]                              ]
[CONTROLLER drawer (settlement.override only):
  Waive… / Adjust… / Reopen case / Void case             ]
[CLOSE row: [Verify readiness] → [Settle] → [Close case] ]
[CEREMONY panel (closed): totals, digest, [View evidence]]
```
**API mapping (1:1, all existing)**: stepper state ← `caseFold`; open ← `openCase`; verify ← `verifyCase`; table ← `computeCaseObligations` result rows; record ← `createPayment`+`attestManualCapture`; refund row-action ← `refundManualPayment`; waive ← `waiveObligation` (Dialog + reason, hold-to-confirm); settle/close ← `settleCase`/`readyForClosure`/`closeCase`; reopen/void ← `reopenCase`/`voidCase`; ceremony ← `closureCeremony`.
**Permissions**: page `settlement.view`; record `settlement.collect`; waive/adjust/reopen/void `settlement.override`; buttons hidden below grant, page shows Forbidden without view.
**States**: no auction → EmptyState (05 §12); auction unreconciled → locked panel with CTA to auction tab; discrepant → Banner + controller paths only; every writer rejection → toast verbatim (05 §5).
**Loading**: stats + table skeleton. **Responsive**: table card-collapses; record card becomes full-width sticky-bottom on mobile.
**AC**: a full officer journey (open→verify→compute→record ×n→settle→close→ceremony) succeeds against seeded demo data (`demo-cup-settled` exemplar) with zero console errors; over-collection attempt shows writer reason verbatim; waive without override grant is impossible via UI **and** returns Forbidden from the wrapper; ceremony digest matches `reproduceClosureEvidence`.

## ★ P-27 Case detail `/…/money/case/[caseId]` — three stacked cards: Obligations (with waiver rows), Payments (`paymentFold`: method, status chain created→captured/refunded, attestor), Journal Timeline (`journalFold` + checkpoint digests, `verifyJournal` badge "chain verified"). Read-only. AC: every event in the fold renders; digests copyable.

## ★ P-28 `/competitions/[slug]/results` — public-safe read: podium-less (no rankings in beta), per-team Cards: squad list (PlayerCard compact), spend total/remaining (Money + CSS bar). Share via ShareField → `/c/[slug]`. Data: `ledgerView` sold projections; visible when auction ∈ {completed, reconciled} else EmptyState (05 §12). AC: no unsold player appears (C-23); page is server-rendered and public-safe (no purse detail beyond spend totals).

## ★ P-29 `/money` My money (person-scoped)

```
[h1 My money]
[Card: WHAT I OWE — per team: obligation, collected, outstanding (Money)]
[Card: MY PAYMENTS — date, method, amount, status]
[Card: MY RECEIPTS — DocumentRow list → detail/download]
```
**API**: ⚙ `myMoneyView()` (02 §F3). Empty per 05 §12. **AC**: figures reconcile exactly with the org-side case for seeded demo; receipt download streams the artifact.

## ★ P-30 `/org/[slug]/money` Finance workspace — Tabs: **Documents** (DataTable of DocumentRow; filters kind/series/FY; row → P-31) · **Dispatches** (queue from `dispatchQueueSnapshot`; retry via `recoverDispatch`, manual-confirm via `confirmDispatchManually` — override grant) · **Exports** (list + `requestExport` buttons for CSV register / Tally XML; completed rows → download) · **Fiscal close** (period list from `fiscalCloseSnapshot`; open/attest/exception/close per J6 — controller only) · **Health** (`operationsDashboardSnapshot` StatCards: runner tick age, follower lag, provider status).
**Permissions**: view `settlement.view`; exports `settlement.export`; dispatch overrides + fiscal `settlement.override`. **AC**: export requested in UI lands as downloadable artifact; every snapshot field displayed is named in the snapshot type (no invented fields); fiscal actions hidden without override.

## ★ P-31 Document detail — header (kind Badge, number, FY), parties, amount (Money), content digest (mono, copy), issuance source ref, dispatch history (Timeline), [Download] → ⚙ streaming route. AC: `reproduceDocument` digest equals stored digest, shown as "Verified ✓".

## ★ P-32 `/admin` — StatCards (orgs, competitions, live auctions, runner tick age, follower lag) + orgs DataTable (name, created, competitions, last event time) + provider health list. Read-only; `platform.admin` grant; Forbidden otherwise. AC: renders with zero writes; loads <2s at 100 orgs.

## ★ P-33 `/admin/audit` (P2) — filter bar (org, actor, action, date) over `audit_log`; DataTable; row expands to JSON meta. Read-only.

---

## Appendix — status→Badge tone map (single source)

| Domain | value → tone |
|---|---|
| Competition | draft→neutral · setup→info · registration_open→success · registration_closed→warning |
| Registration | submitted→info · approved→success · rejected→danger · waitlisted→warning · withdrawn→neutral · draft→neutral |
| Fixture | draft→neutral · scheduled→info · published→success · in_progress→live · completed→neutral · cancelled→danger |
| Auction | scheduled→info · live→live · paused→warning · completed→success · reconciled→success · abandoned→danger |
| Lot | prepared/queued→neutral · on_block→live · closing_soon→warning · sold→success · unsold→neutral · frozen→info · withdrawn→danger |
| Case | opened→info · verified→success · discrepant→danger · settling→warning · settled→success · closed→neutral · voided→danger |
| Payment | created→neutral · authorized→info · captured→success · refunded→warning · failed→danger · disputed→danger |
| Dispatch | requested→info · sent→info · confirmed→success · failed→danger |
| Export | requested→info · completed→success · failed→danger |
| Period | open→info · closed→neutral |
