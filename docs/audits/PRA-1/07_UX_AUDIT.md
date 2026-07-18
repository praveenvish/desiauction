# PRA-1 · 07 — UX Audit

## 1. Navigation & Information Architecture — the defining failure

- **There is no navigation system.** No header, no sidebar, no breadcrumbs, no footer.
  The root layout renders `<body>{children}</body>` (`layout.tsx:15-21`).
- **Exactly one static internal link exists in the whole app** (`/orgs`, inside a hint
  paragraph on `/competitions` — `competitions/page.tsx:83`). Everything else is
  contextual (into a competition) or a redirect.
- **Login lands on `/account`, which links nowhere.** A brand-new user's first
  authenticated screen offers: their phone number, passkey enrollment, and Sign out.
  The product is invisible from inside the product.
- `docs/16-navigation-system.md` and `docs/17-information-architecture.md` specify a
  full IA (Console/Stage/Owner Room). Zero of it is implemented.
- Consequence: every flow is deep-linked. This works for e2e tests (which know the
  URLs) and fails for humans (who don't). **This single gap converts ~17 implemented
  features into undiscoverable ones.**

## 2. Design system & consistency

- Real tokenized system: two themes (daylight/floodlight), generated CSS custom
  properties, Clash Display display font, 10 primitives with tests, guardrails test
  (`packages/ui/src/guardrails.test.ts`). Product screens compose these primitives
  consistently — visual consistency within the built surface is good.
- **Dialog and Skeleton are gallery-only** — no product screen uses a modal or a
  loading skeleton. Destructive actions (bulk reject, remove passkey, void bid) run
  without confirmation dialogs; hold-gate motion exists (`use-hold-gate.ts`) and is
  used in live surfaces, which partially compensates.
- Dark mode: floodlight is pinned to live surfaces; there is **no user theme choice**
  and no `prefers-color-scheme` handling in the root layout (`data-theme="daylight"`
  hardcoded).

## 3. States

- Empty states: genuinely implemented via `EmptyState` primitive on list screens. ✅
- Error states: form-level field errors + role="alert" copy on token pages. ✅
- Loading: button-level `loading` prop everywhere; live surfaces show "Connecting…"
  and connection badges. **But no route-level `loading.tsx` exists**, so server-rendered
  console pages (registrations: 656-line panel; fixtures: 825) block with a blank
  screen on slow queries. 🟡
- 404/error: **no `not-found.tsx` or `error.tsx` anywhere** — default Next.js screens,
  unbranded, with no route home. 🔴

## 4. Responsive / mobile / tablet

- App-level CSS media queries: `auction.css` (2), `gallery.css` (1), **all other app
  stylesheets zero** (verified per file). The registration and fixtures consoles are
  wide `<table>` layouts with bulk-select toolbars — desktop-only in practice.
- The vision explicitly puts owners and spectators **on phones** in the live room
  (`docs/01-vision.md`: "every owner's phone"). The live surfaces have exactly two
  media rules; no viewport testing artifact exists in the repo (no mobile e2e
  projects in `playwright` specs — device emulation unverified).
- Verdict: mobile is **unproven at best** for the surfaces that most need it, absent
  for consoles. 🔴 for a product whose auction night is a phones-in-a-hall event.

## 5. Accessibility

- Positives: labeled `Field` primitives, `role="alert"` on failures, `aria-` usage in
  live regions, a dedicated `AnnouncerProvider` for auction events, `VisuallyHidden`
  helper — the live room was designed with screen readers in mind.
- Gaps: 16 total `aria-` attributes across the app; no skip-to-content; no focus
  management after server-action navigation; tables lack `scope`/caption patterns
  (unverified in detail); color-token contrast is asserted by the design docs but no
  automated a11y test exists (no axe/pa11y anywhere in the repo).

## 6. Micro-interactions & motion

- Motion system exists (`motion.css`, hold-gate hook, gallery demos, motion e2e spec).
  Toasts are used in consoles. Countdown/status ribbon in live room. Within the built
  surface, interaction quality is above-average.

## 7. UX debt ranking (what to fix first)

1. Navigation shell + authenticated home (unlocks everything already built)
2. Route-level 404/error/loading pages (safety net for every journey)
3. Profile/name capture (identity dignity — core brand promise)
4. Mobile pass on live room + spectate + register (the phone surfaces)
5. Confirmation dialogs on destructive ops (Dialog primitive already exists)
6. Theme handling (respect `prefers-color-scheme`, or commit to daylight)
