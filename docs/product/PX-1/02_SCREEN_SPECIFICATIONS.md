# PX-1 · 02 — Screen Specifications

> Every screen in the product. Format per screen:
> **Purpose / Audience / Entry / Exits / APIs (existing unless marked ⚙ new-thin) / Permission / Missing UI today / Depends on / Priority.**
> Priorities: P0 = beta-blocking · P1 = beta-quality · P2 = post-beta.
> "⚙ new-thin" = a new server action or route handler that only calls existing platform functions listed here. Anything not expressible that way is out of scope by the freeze.

---

## A. Public website

### A1 `/` Landing ★ P0
- **Purpose**: explain the product in one screen; convert to sign-in. **Audience**: visitor.
- **Entry**: direct, search, shared links. **Exits**: `/login` (primary CTA "Run your auction"), `/pricing`, `/help`, `/c/[slug]` (via shared links only).
- **APIs**: none (static). Footer version from `env.APP_VERSION`.
- **Missing today**: everything — current page is an engineering placeholder.
- **Depends on**: brand assets (04_DESIGN_SYSTEM §2), copy (05_CONTENT_GUIDE §2).

### A2 `/pricing` ★ P0
- **Purpose**: public pricing per invariant 27 (docs/45). Free tier is real; Pro Pass/Association shown as "during beta, all features are free" honesty banner (no billing backend exists; do not fake a checkout).
- **Audience**: visitor, organizer. **Entry**: header, landing. **Exits**: `/login`.
- **APIs**: none. **Missing**: entire page. **Priority**: P0 (page), billing itself P2.

### A3 `/help` + `/help/[article]` ★ P0
- **Purpose**: self-serve answers; the "without engineering assistance" bar. Ten launch articles (list in 05 §8).
- **APIs**: static MDX. **Exits**: contact. **Missing**: all.

### A4 `/legal/terms`, `/legal/privacy`, `/legal/refunds` ★ P0
- **Purpose**: lawful operation (phone collection ⇒ privacy policy; refunds public per docs/45).
- **APIs**: static. **Missing**: all. **Depends on**: founder legal review (copy skeletons in 05 §9).

### A5 `/contact` ★ P1
- **Purpose**: one support channel: support email + WhatsApp number + expected response time.

### A6 `/c/[slug]` Public competition page ★ P0
- **Purpose**: the shareable home of a competition: name, org, status badge, "Register" CTA (when `registration_open`), "Watch live" CTA (when auction live), published fixtures list.
- **Audience**: player, spectator. **Entry**: organizer-shared link, results share. **Exits**: `/competitions/[slug]/register`, `/competitions/[slug]/auction/spectate`, `/login`.
- **APIs**: existing `registrationLanding(slug)`; fixtures via existing `calendarView` published subset; ⚙ `publicCompetitionView(slug)` composing both on the documented system pool (same pre-tenant-read pattern as `invitePreview`).
- **Permission**: public. **Missing**: entire page. **Depends on**: nothing new.

### A7 404 / error / loading ★ P0
- **Purpose**: branded `not-found.tsx` ("This page doesn't exist — go Home"), `error.tsx` (apology + retry + home + support link), root `loading.tsx` (skeleton shell).
- **Missing**: all three (default Next screens today).

---

## B. Identity

### B1 `/login` Δ P0
- **Purpose**: OTP sign-in (existing), passkey sign-in (existing), **plus step 3: name capture when `session.name` is null**.
- **Entry**: everywhere unauthenticated. **Exits**: `next` param or `/home`.
- **APIs**: existing `requestOtpAction`, `verifyOtpAction`, `startPasskeyLoginAction`/`finishPasskeyLoginAction`; ⚙ `updateProfileAction(name)` — writes existing `people.name`, validates 2–60 chars, audit-logged like other actions.
- **Missing today**: name step; redirect target must change from `/account` to `/home`.
- **Note**: production requires the SMS `OtpSender` adapter (port exists at `otp-sender.ts`; PX-3).

### B2 `/account` Δ P1
- **Purpose**: profile (name edit ⚙ `updateProfileAction`, phone read-only), security (existing passkey + session panels), sign out.
- **Entry**: avatar menu. **Exits**: rail. **Missing**: shell, profile section, links out.

---

## C. Console core

### C1 `/home` ★ P0
- **Purpose**: the answer to "what needs me today"; kills the dead-end.
- **Audience**: every authenticated user; content adapts to grants.
- **Sections**: attention queue (submitted registrations count per competition via `registrationDashboard` stats; auction readiness blockers via `auctionDashboard`; due receipts via `receiptCandidates`; open settlement cases via case reads); my competitions (`competitionsView`); my schedule (`organizerScheduleView`); my money summary (⚙ person-scoped obligation read, §F3); new-user empty state → "Create your organization".
- **Entry**: login redirect, rail. **Exits**: everything.
- **Permission**: session. **Missing**: entire page. **Depends on**: shell (PX-1 milestone).

### C2 `/inbox` ★ P1
- **Purpose**: render the in-app dispatch rows the platform already writes; unread badge source.
- **APIs**: existing `dispatchSnapshot`/`dispatchQueueSnapshot` scoped to person as party; ⚙ `markDispatchSeen` (UI-read tracking on existing rows — a `seenAt` presentation concern; if freeze forbids the column, V1 ships read-only list, badge = last-7-days count).
- **Missing**: entire page. **Priority**: P1 (beta can start read-only).

### C3 `/orgs` Δ P0 · C4 `/org/[slug]` Δ P0 · C5 `/org/[slug]/venues` Δ P1
- As built and complete; delta = Console shell, breadcrumbs, mobile pass. APIs unchanged (existing).

### C6 `/competitions` Δ P0 · C7 `/competitions/[slug]` Overview Δ P0 · C8 Registrations Δ P0 · C9 Fixtures (+calendar/match-day) Δ P1
- As built; delta = shell + tab row + mobile pass (registrations/fixtures tables get the responsive card-row treatment, 04 §9).

### C10 `/competitions/[slug]/auction` hub Δ P0 + ledger/replay/engine Δ P1
- As built; delta = shell; `engine` page gains `auction.conduct` permission gate (currently reachable by any session — verified gap).

---

## D. Live surfaces (S3) — all existing

### D1 live · D2 cockpit · D3 spectate · D4 replay — Δ P0/P1
- Delta only: Live shell exit door, phone-first responsive pass (04 §9), ceremony copy (05 §6). No API changes. Cockpit stays desktop-first (it's an operator console) but must not break at 768px.

---

## E. Money — settlement (competition-scoped)

### E1 `/competitions/[slug]/money` Settlement console ★ P0
- **Purpose**: the post-gavel workflow: open the case, verify against auction truth, compute obligations, record collections, discharge, close. This closes the product's core promise.
- **Audience**: organizer with settlement grant. Capability sets exist: `settlement:officer` (view/manage/collect/export), `settlement:controller` (+override).
- **Layout**: case status header → obligations table (team, obligation, collected, outstanding) → collection recorder (method: `manual:cash` | `manual:upi-direct` | `manual:bank`; amount; payer team) → controller drawer (waive w/ reason, adjust, reopen, void) → close + ceremony.
- **APIs (all existing in `server/settlement/writer.ts` / `ceremony.ts`)**: `openCase`, `verifyCase`, `computeCaseObligations`, `createPayment`, `attestManualCapture`, `refundManualPayment`, `waiveObligation`, `settleCase`, `readyForClosure`, `closeCase`, `reopenCase`, `voidCase`, `closureCeremony`, `reconciledOverlayFor`. Exposed via ⚙ `"use server"` wrappers that add `withTenantDb` + capability checks (the exact pattern of every existing action file).
- **Entry**: competition Money tab; Home attention queue. **Exits**: case detail, org finance, results.
- **Missing today**: entire UI (backend 100% complete, zero screens).
- **States**: no-auction-yet (locked, explains); auction-not-reconciled (CTA to reconcile via existing lifecycle); case statuses `opened → verified/discrepant → settling → settled → closed | voided` drive the stepper.

### E2 `/competitions/[slug]/money/case/[caseId]` Case detail ★ P1
- **Purpose**: the audit view: full obligation list with waivers, payment records with methods/status (`created → authorized → captured → refunded/failed/disputed`), journal timeline, checkpoint digests.
- **APIs**: existing `caseFold`, `paymentFold`, `journalFold`, `verifyJournal`.

### E3 `/competitions/[slug]/results` ★ P1
- **Purpose**: post-auction public-ready summary: squads by team, spend, sold list; "share" copies `/c/[slug]` anchored link.
- **APIs**: existing `ledgerView` projections + `closureCeremony` (when closed). Read-only.

---

## F. Money — finance workspace & personal

### F1 `/org/[slug]/money` Org finance workspace ★ P1
- **Purpose**: expose finops: operations dashboard (runner/follower/provider health), documents register (receipts, tax-invoices, corrections with numbers/series), dispatch queue, exports (CSV register, Tally XML), fiscal periods (open/attest/close).
- **APIs (all existing snapshots)**: `operationsDashboardSnapshot`, `issuanceSnapshot`, `documentSnapshot`, `dispatchQueueSnapshot`, `exportSnapshot`, `fiscalCloseSnapshot`, `fiscalTimelineSnapshot`, `operationalChecklistSnapshot`; commands `requestDispatch`, `requestExport`, `openPeriod`, `attestDay`, `noteException`, `closePeriod`, `reopenPeriod`, `issueReceipt`, `issueInvoice`, `issueCorrection`, `issueDueReceipts`, `receiptCandidates` — via ⚙ wrappers gated by settlement capabilities.
- **Tabs within page**: Documents · Dispatches · Exports · Fiscal close · Health.
- **Missing**: entire UI. **Priority**: P1 (documents+exports tabs P1; fiscal close can be P2 if beta orgs are non-GST).

### F2 `/org/[slug]/money/documents/[docId]` ★ P1
- **Purpose**: document detail: parties, amount, digest, dispatch history; **Download PDF/artifact**.
- **APIs**: `documentSnapshot`, `reproduceDocument`; ⚙ `GET /org/[slug]/money/documents/[docId]/download` route streaming from the existing artifact store (`createFilesystemArtifactStore` locally; S3 store per ops checklist in production).

### F3 `/money` My money (person-scoped) ★ P0
- **Purpose**: any signed-in person sees: what I owe (obligations on teams I own), what I've paid, my receipts (documents where I'm the party).
- **APIs**: ⚙ `myMoneyView()` — person-scoped read joining existing settlement store reads (obligations by owner personId via paddles→teams, `paymentFold` rows, `documentSnapshot` filtered by party). Read-only composition; zero new truth.
- **Entry**: rail Money; Home summary card; receipt dispatch deep link. **Missing**: all.

---

## G. Platform admin

### G1 `/admin` ★ P1
- **Purpose**: founder observability: orgs table (name, created, competitions, last activity), auctions in flight, runner/follower health, provider health.
- **APIs**: existing `runnerHealthSnapshot`, `followerHealthSnapshot`, `providerHealthSnapshot`; ⚙ read-only aggregates over orgs/competitions/auctions on the system pool.
- **Permission**: `platform.admin` capability on a `platform` scope — a **grant row** using the existing grants mechanism (⚙ seeded by script, no UI to issue it in beta).

### G2 `/admin/audit` ★ P2
- **Purpose**: filterable viewer over the existing `audit_log` table (org, actor, action, time range).
- **APIs**: ⚙ read-only query. **Priority**: P2 (SQL suffices during closed beta; required for GA).

---

## H. Cross-cutting screen requirements

Every screen above must satisfy (acceptance-tested per 06_PAGE_BLUEPRINTS):
1. Renders inside its shell with correct active nav state and `<title>`.
2. Has designed empty, loading (skeleton), error, and forbidden states (04 §10).
3. Is usable at 360px width (Console tables per 04 §9 rules; Cockpit exempt to 768px).
4. Every mutation uses the existing action or a ⚙ wrapper named in this document — **no other backend calls are authorized**.
5. Every money figure renders via the `Money` primitive (paise-integer in, formatted out).

## I. Screen count summary

- Existing kept (Δ shell/delta): **19**
- New pages (★): **21** (7 public/static, 3 identity/console core, 6 money, 2 admin, 3 error/system)
- New thin wiring (⚙): 1 route handler (webhook), 1 download route, ~8 server-action wrappers, 2 public composite reads, 1 profile action, 1 platform grant seed.
- **Forbidden**: any new domain function, any schema change beyond none, any second source of financial truth.
