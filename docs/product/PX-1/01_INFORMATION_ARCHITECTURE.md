# PX-1 · 01 — Product Information Architecture

> Status: **BINDING**. This document decides every route, shell, menu, and entry point.
> The backend is frozen; every route below names the existing capability it exposes.
> Deviations from the pre-build canon (docs/16, docs/17) are ruled explicitly in §7.

## 1. The three shells

Every page in the product renders inside exactly one shell. No page is shell-less.

### S1 · Public shell
Slim branded header (logo → `/`, links: Features `/#features`, Pricing `/pricing`, Help `/help`, Sign in `/login`) + footer (About, Contact, Terms, Privacy, Refunds, © line). Zero chrome on token landings beyond the header. Used by: marketing, legal, help, login, public competition pages, spectate, registration, invite acceptance.

### S2 · Console shell (authenticated)
- **Top bar**: product wordmark (→ `/home`), global search (V2 — reserved, not built now), notifications bell (→ `/inbox`, badge = unread in-app dispatches), avatar menu (Account `/account`, Help `/help`, Sign out = existing `logoutAction`).
- **Left rail — exactly five items, forever** (canon rule from docs/16 upheld):
  1. **Home** `/home`
  2. **Competitions** `/competitions`
  3. **Organizations** `/orgs`
  4. **Money** `/money`
  5. **Help** `/help`
- **Mobile**: rail collapses to a bottom tab bar with the same five items; top bar keeps bell + avatar.
- **Competition context**: entering a competition swaps to a sub-navigation tab row under a breadcrumb. Tabs (phase-aware, attention dots): **Overview · Registrations · Fixtures · Auction · Money · Results**. (Settings folds into Overview for beta; see §7.3.)

### S3 · Live shell
Full-screen, railless: cockpit, live room, spectate, replay. One labeled exit ("Leave auction" top-left → competition Overview or `/` for anonymous spectators). Persistent status strip: connection state, snapshot seq, auction phase (already built as `status-ribbon.tsx`; keep).

## 2. Complete route map

Legend: ✅ exists · Δ exists, gets shell/delta changes · ★ new page over existing backend · ⚙ new thin wiring (route/action) over existing backend, no new business logic.

### 2.1 Public (S1)

| Route | Page | Backend |
|-------|------|---------|
| `/` ★ | Landing (replaces engineering placeholder) | static + `env.APP_VERSION` footer |
| `/pricing` ★ | Pricing (Free tier live; paid tiers "coming during beta" honestly) | static (billing is post-beta; docs/45 is the source) |
| `/help` ★ | Help center index | static MDX articles in-repo |
| `/help/[article]` ★ | Article | static |
| `/legal/terms` ★, `/legal/privacy` ★, `/legal/refunds` ★ | Legal | static |
| `/contact` ★ | Contact/support channel | static (mailto + WhatsApp number) |
| `/c/[slug]` ★ | **Public competition page** — name, org, status, register CTA, spectate CTA, published fixture list | ⚙ thin public read: `registrationLanding(slug)` + published fixtures via `calendarView` subset on the documented system pool (same pre-tenant pattern as invite previews) |
| `/login` Δ | Sign in (OTP + passkey) + **name capture step** (§7.2) | existing `requestOtpAction`/`verifyOtpAction`/passkey actions; ⚙ `updateProfileAction` writes existing `people.name` |
| `/join/[token]` ✅ | Org invite accept | `invitePreview`, `acceptInviteAction` |
| `/owner-join/[token]` ✅ | Owner invite accept | `ownerJoinPreview`, `acceptOwnerJoin` |
| `/competitions/[slug]/register` Δ | Player registration (adds name if missing) | `registrationLanding`, `submitRegistrationAction`, ⚙ `updateProfileAction` |
| `/competitions/[slug]/auction/spectate` ✅ | Stage (public) | `spectatorView` + engine WS |
| `/healthz` ✅ | Health | existing |
| `/api/webhooks/razorpay` ⚙ | Webhook ingress route | existing `handleRazorpayWebhook` (code complete, route absent) |
| 404 / error / loading ★ | Branded `not-found.tsx`, `error.tsx`, root `loading.tsx` | static |

### 2.2 Console (S2)

| Route | Page | Backend |
|-------|------|---------|
| `/home` ★ | Authenticated home: attention queue, my competitions, my schedule, my money summary, empty-state onboarding | composes existing `myOrgs`, `competitionsView`, `organizerScheduleView`, in-app dispatch reads ⚙, owner obligations read ⚙ |
| `/inbox` ★ | Notifications (in-app dispatch rows; mark-read) | existing dispatch snapshots (`dispatchSnapshot`) + ⚙ read/ack action over existing `finopsDispatches` |
| `/account` Δ | Account: profile (name ⚙), phone, security panels (passkeys, sessions), sign out | existing `accountSecurity` + passkey/session actions; ⚙ `updateProfileAction` |
| `/orgs` Δ | Organizations list/create (gets shell) | existing |
| `/org/[slug]` Δ | Org home: members, invites, grants | existing `orgView`, `createInviteAction`, `issueGrantAction`, `revokeGrantAction` |
| `/org/[slug]/venues` Δ | Venues & grounds | existing |
| `/org/[slug]/money` ★ | **Org finance workspace** (finops): operations dashboard, documents register, dispatch queue, exports, fiscal periods | existing snapshots: `operationsDashboardSnapshot`, `documentSnapshot`, `dispatchQueueSnapshot`, `exportSnapshot`, `fiscalCloseSnapshot`, `issuanceSnapshot` — exposed via ⚙ thin server actions gated by `settlement.view`/`settlement.export` |
| `/org/[slug]/money/documents/[docId]` ★ | Document detail + download | `documentSnapshot`, `reproduceDocument`, artifact store ⚙ download route |
| `/competitions` Δ | Competitions list/create (gets shell) | existing |
| `/competitions/[slug]` Δ | **Overview tab** (existing panel, re-homed under tabs) | existing `competitionView`, `advanceCompetitionAction`, `createTeamAction` |
| `/competitions/[slug]/registrations` Δ | Registrations tab | existing dashboard actions |
| `/competitions/[slug]/fixtures` Δ (+ `/calendar`, `/match-day`) | Fixtures tab | existing |
| `/competitions/[slug]/auction` Δ | Auction tab (hub: readiness, links, post-live ledger/replay links) | existing `auctionDashboard`, `createAuctionAction`, lifecycle/queue actions |
| `/competitions/[slug]/auction/ledger` Δ, `/replay` Δ, `/engine` Δ | Ledger, replay, diagnostics (diagnostics gains `auction.conduct` gate) | existing |
| `/competitions/[slug]/money` ★ | **Settlement console** (organizer): case status, obligations table, record collection, waive/adjust (controller), close, ceremony | existing writer: `openCase`, `verifyCase`, `computeCaseObligations`, `createPayment`, `attestManualCapture`, `refundManualPayment`, `waiveObligation`, `settleCase`, `readyForClosure`, `closeCase`, `reopenCase`; `closureCeremony`; gated by `settlement:officer`/`settlement:controller` capability sets (all existing) |
| `/competitions/[slug]/money/case/[caseId]` ★ | Case detail: obligations, payments, journal timeline | `caseFold`, `journalFold`, `paymentFold` |
| `/competitions/[slug]/results` ★ | Results: squads, spend per team, sold-lot list; share link | existing auction events/ledger projections (`ledgerView` data) — read-only composition |
| `/money` ★ | **My money** (cross-org, person-scoped): what I owe (owner obligations), my receipts, my payments | ⚙ thin person-scoped reads over existing settlement store (obligations by paddle-holder personId, payments, documents where party = person) |

### 2.3 Live (S3) — all existing, re-shelled

`/competitions/[slug]/auction/live` ✅ · `/cockpit` ✅ · `/spectate` ✅ (public) · `/replay` ✅.

### 2.4 Platform admin (S2, staff-only)

| Route | Page | Backend |
|-------|------|---------|
| `/admin` ★ | Platform overview: org list, competition counts, auction activity, runner/follower health | ⚙ read-only aggregates on system pool; `runnerHealthSnapshot`, `followerHealthSnapshot`, `providerHealthSnapshot` (existing) |
| `/admin/audit` ★ | Audit log viewer (filter by org/actor/action) | existing `audit_log` table, read-only ⚙ |
| Gate | `platform.admin` grant — **new grant row value on the existing grants mechanism** (scopeType `platform`), not a new authz system | existing `grants` table + `hasCapability` |

### 2.5 Removed / gated

- `/gallery` → env-gated to development (same pattern as `/dev/inbox`).
- `/dev/inbox` → unchanged (already 404s in production).

## 3. Menus, complete

- **Avatar menu**: Account · Help · Sign out. (Admin: + Platform admin.)
- **Bell**: last 10 in-app dispatches; "View all → `/inbox`".
- **Org switcher**: appears in top bar only when `myOrgs().length > 1`; sets context for rail item 3 deep-links.
- **Competition tab row**: Overview · Registrations · Fixtures · Auction · Money · Results. Money tab visible only to holders of `settlement.view`; Results appears once auction status ∈ {completed, reconciled}. Attention dots: Registrations (submitted count), Auction (readiness blockers), Money (open cases / due receipts via `receiptCandidates`).
- **Footer (public)**: About (§ of landing) · Pricing · Help · Contact · Terms · Privacy · Refunds.

## 4. Breadcrumbs

Console only, max depth 3: `Org / Competition / Section` (e.g., *Malad Premier League / MPL 2026 / Registrations*). Document `<title>` mirrors breadcrumb ("Registrations · MPL 2026 · DesiAuction"). Live and Public shells never show breadcrumbs.

## 5. Entry points (how every audience first arrives)

| Audience | Entry | First screen |
|----------|-------|--------------|
| Prospect | Search/social → `/` | Landing → CTA `/login` |
| New organizer | `/login` → name step → `/home` (empty state: "Create your organization") | `/home` |
| Invited staff | `/join/[token]` (link from organizer, off-platform for beta) | Accept → `/org/[slug]` |
| Player | `/c/[slug]` or direct `/competitions/[slug]/register` link | Register |
| Team owner | `/owner-join/[token]` | Accept → live room |
| Spectator | `/c/[slug]` → Watch live, or direct `/spectate` link | Stage |
| Returning user | `/login` → `/home` (never `/account`) | `/home` |
| Admin (founder) | `/admin` | Platform overview |

**Rule: `/login` success always redirects to `next` param if present, else `/home`. `/account` is never a login destination again.**

## 6. Wayfinding rules (binding)

1. Every Console page is reachable from the rail in ≤ 3 clicks; anything deeper is an IA defect.
2. Browser back always works; unsaved forms guard with the existing `Dialog` primitive.
3. List → detail → back restores scroll/filters/selection (sessionStorage per view).
4. Rail/tab active states use fill + text, never color alone.
5. Every URL is deep-linkable and reload-safe (already true; must remain true).
6. Token URLs (`/join`, `/owner-join`, registration links) remain path-borne and unguessable (existing ULIDs).

## 7. Rulings — deviations from pre-build canon (docs/16, docs/17)

1. **URL grammar**: canon's `/o/{org}/t/{tournament}` is **superseded** by the as-built `/org/[slug]`, `/competitions/[slug]` grammar. Reason: the built grammar is live in 44 e2e tests and every server action; a rename buys zero customer value at real regression cost. Canon doc 16 §URL is amended by this ruling.
2. **Name capture**: canon assumed registration captures names; the platform creates people phone-only (`otp.ts:146`). Ruling: name is captured **once, post-OTP-verify, as a login step** for any session lacking `people.name`, via ⚙ `updateProfileAction` (writes the existing column; no schema change). Registration and owner-join flows inherit the same guard.
3. **Tournament Settings tab**: canon lists a Settings tab; no backend for competition edit/branding/danger-zone exists and the backend is frozen. Ruling: **no Settings tab in beta**; lifecycle control lives on Overview (as built). Settings tab returns when a thaw adds competition-edit capability.
4. **"Pool" tab**: canon's Pool (lots/base prices) is served inside the Auction tab by the existing `auctionDashboard`/`queueAllLotsAction` surface. No separate tab in beta.
5. **Vocabulary**: the product says **Competition** (as built in URLs, copy, schema), not "Tournament". Canon docs using "Tournament" read as "Competition".
6. **Command palette (⌘K)**: deferred to post-beta; the rail + tabs cover current surface area.
