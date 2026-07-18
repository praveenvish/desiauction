# PX-2 — Product Shell · Engineering Report

Date: 2026-07-16 · Status: **COMPLETE — awaiting Founder review** · Backend: untouched (verified: zero schema/domain/server-action logic changes; the only server-layer edit is the login redirect target).

## 1 · What was built

**Shell kit in `@desiauction/ui`** (`src/shell/`, 13 components + icons, all token-native, Next-free):
AppShell (top bar · 5-item rail · mobile bottom tabs · skip link), NavigationRail/Group/Item, PublicShell (header/footer), LiveShell (labeled exit door, landmarked strip, status slot), Breadcrumb (canon max-depth 3), PageHeader/SectionHeader/QuickActionBar, ContextBar + SubNavTabs (attention-dot capable), PopoverMenu (WAI-ARIA menu button), Drawer (native-dialog side sheet), CommandPalette (navigation-only ⌘K overlay), LoadingState (page/table/cards skeletons), ErrorState, and a 12-icon inline set on the Lucide grid.

**Shell wiring in `apps/web`**:
- One navigation model (`components/shell/nav.ts`): shell resolver (public/console/live/bare), rail definition, competition tabs, section labels, live-exit doors — pure and unit-tested.
- One shell router (`components/shell/product-shell.tsx`) mounted from the root layout: picks the shell per pathname; builds the competition ContextBar (breadcrumb `Org / Competition / Section`, tabs, competition switcher) and org breadcrumbs from the layout's existing reads (`myOrgs`, `competitionsView` — both existing actions); top bar carries search (⌘K palette), notifications bell → `/inbox`, org switcher (multi-org only), user menu (Account · Help · Sign out via the existing `logoutAction`); mobile gets bottom tabs + drawer.
- **`/home`** — the authenticated landing (PX-1 P-10): time-of-day greeting, attention queue (submitted-registration counts via `registrationDashboard`, auction readiness blockers via `auctionDashboard` — capability-gated, capped at 8 competitions), Pinned + Continue-working (device-local localStorage, no backend), competitions grid, schedule (`organizerScheduleView`), organizations, and a new-user onboarding empty state.
- **Login lands on `/home`, never `/account`** — `safeNext` default, login-page session redirect, passkey redirect all updated.
- Entry pages for the rail's Money/Help/Inbox destinations with **honest interim states** (no fake data; each states what arrives and when).
- Branded `not-found.tsx`, `error.tsx` (digest surfaced for support), `/home` route skeleton.
- `/gallery` env-gated out of production (same pattern as `/dev/inbox`).

## 2 · What was verified (all fresh, this machine)

- `pnpm verify`: lint 0 warnings · typecheck · **331 unit/integration tests** (64 ui incl. 12 new shell tests; 267 web incl. new nav-model suite) · prettier · **depcruise 633 modules, 0 violations**.
- Production build: all 30 routes compile; console pages ≈119 kB first-load JS.
- **Full Playwright suite: 53/53 green** (15 existing specs under the new shell + new `shell.spec.ts`), covering: authentication redirect to /home; rail navigation to every workspace; user menu; breadcrumb generation and tab active-states inside a competition; command-palette keyboard navigation; **organization switching and competition switching**; pins/recents; mobile bottom tabs + drawer at 390px; public-shell wrapping with gated console routes; axe zero-violation scans on /home, /help, /login, orgs pages, and the live cockpit.

## 3 · Engineering decisions

1. **`@desiauction/ui` stays Next-free**: shell components take an injected `linkComponent` and receive active-state as data; the app owns routing. Boundary preserved (depcruise-proven).
2. **One pathname-driven shell router instead of route-group layouts**: route groups would move every page file (route-rename risk, mass import churn) — forbidden by scope. One client component + one pure nav module = zero duplicated layout logic, no URL changes, and the 44 pre-existing e2e tests still pass.
3. **Context-bar data reuses the layout's reads**: no per-section server layouts, no extra queries on public/live paths (anonymous renders skip all reads), no redirect hazards on token pages.
4. **Loading boundaries are per-segment, never global** — a root `loading.tsx` was built, then **removed after the e2e caught it converting the token pages' HTTP redirects into streamed post-200 redirects** (breaking `/join` next-param semantics). Rule documented in `app/home/loading.tsx`. This is the one genuine platform-behavior finding of PX-2.
5. Icons are inline SVG on the Lucide grid — no new dependency; swap to `lucide-react` later is mechanical.
6. Pins/recents are localStorage-only: presentation state, structurally incapable of becoming a second truth.

## 4 · UX decisions

1. Rail = **Home · Competitions · Organizations · Money · Help** (canon: five, forever). `/account` and `/inbox` hang off the top bar, not the rail.
2. Money/Help/Inbox rail items land on **honest interim pages** rather than dead links or fake data — each says exactly what will appear there and that it's being built. Founder may veto; the alternative (hiding rail items until PX-7/8) breaks the "rail never changes" rule.
3. Homepage `/` content untouched (CTO: out of scope) but now wrapped in the Public shell with Sign in — the placeholder is at least framed and navigable.
4. Live surfaces got the exit door and landmark fix only — no visual changes to the room.
5. Command palette is navigation-only (routes + your orgs + your competitions); no search backend exists and none was faked.
6. Breadcrumb org crumb links to `/orgs` (org slug isn't in the competition read; deep-linking the org home would need a new query — declined under the freeze).

## 5 · Remaining risks

1. **Shell reads on every authenticated SSR** (`myOrgs` + `competitionsView` in the root layout): ~2 extra queries per page view. Fine at beta scale; optimization path is React `cache()` dedupe. Live-room WS traffic is unaffected after initial load.
2. **Layout-data staleness on pure client navigations**: a created org/competition appears in switcher/palette after the action's refresh/redirect (all current flows do refresh), but exotic paths could show a stale palette until reload.
3. **Attention queue cost** is bounded (8 competitions) but serial; a many-competition organizer adds ~1 round-trip per open competition to /home.
4. `/account` and `/inbox` have no rail highlight (deliberate — they're top-bar destinations); watch beta users for wayfinding confusion.
5. The dev-compiler e2e jitter class remains (repo-documented; retries=1 absorbs it; every spec passes in isolation without retries).
6. Interim Money page shows a "coming" state even to users who (via seed data) already have obligations — acceptable only until PX-7; flagged so it isn't forgotten.

## 6 · Founder demonstration (10 minutes, local)

```
pnpm setup:local && pnpm dev        # if not already running
```
1. `localhost:3000/login` → OTP via `/dev/inbox` → you land on **/home** (not /account).
2. New-account state: "Welcome to DesiAuction → Create your organization" — the dead end is gone.
3. Create org + competition → watch the **breadcrumb + tab row** appear; click through Overview/Registrations/Fixtures/Auction.
4. Press **⌘K** → type a competition name → Enter.
5. Create a second org + competition → **org switcher** and **Switch** (competition) appear in the chrome.
6. Resize to phone width → bottom tabs + Menu drawer.
7. Visit a nonsense URL → branded 404 with a way home.
8. `/competitions/<slug>/auction/spectate` → the Live shell's "Leave auction" door.

## 7 · Recommended Founder decision

**Accept PX-2 and open the authentication milestone (real SMS OTP + name gate) next**, running the founder-external provisioning track (accounts, domains, SMS provider) in parallel — it gates everything and needs no engineering. Two review calls requested: (a) approve or veto the honest interim pages for Money/Inbox/Help; (b) confirm `support@desiauction.in` as the support address printed on /help before any deploy.
