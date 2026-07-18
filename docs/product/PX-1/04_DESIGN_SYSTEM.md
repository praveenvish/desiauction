# PX-1 · 04 — Design System

> Ruling: the design system **is the one already in `@desiauction/ui` plus the canon
> (docs/05–19)** — this document does not invent a second system. It (a) binds the
> canon as product law, (b) specifies the components the product still needs, and
> (c) rules the open questions so implementers never guess.

## 1. Foundations (bound as-is from the canon + code)

- **Color**: token families Ink/Chalk/Volt/Gold + semantic set (docs/08), already generated into `primitives.css`/`daylight.css`/`floodlight.css`. Semantic tokens are the only colors screens may use (`text-primary`, `surface-raised`, `accent`, `live`, `money-value`, `money-spent`, `money-remaining`, `money-frozen`, status subtle/base/strong triads — full list in `packages/ui/src/generated/tokens.ts`).
- **Typography** (docs/09, implemented): Display = Clash Display + Anek Devanagari (player names, current bid, SOLD, page moments); Text = Geist Sans + Noto Sans Devanagari; Mono = Geist Mono. Weights: Geist 400/500/600 (600 ceiling), Clash 500/600. **All data numerals tabular** — enforced by `Money` and table primitives, never per-usage.
- **Spacing/grid** (docs/10): 4px base scale; Console content max-width 1200px, 24px gutters; forms single-column, 640px max.
- **Elevation** (docs/18 tokens): `surface` → `surface-raised` (cards) → `surface-overlay` (dialogs/popovers); shadows only at overlay level; borders do elevation work at card level.
- **Motion** (docs/11 + `motion.css` + `useHoldGate`): 120–200ms standard transitions; hold-to-confirm for irreversible money/conduct actions; `prefers-reduced-motion` collapses all nonessential motion (already honored in motion.css — keep).

## 2. Brand & logo direction

- Wordmark: "DesiAuction" in Clash Display Semibold, tight tracking; the "D" counter carved as a gavel-head silhouette — this is the favicon glyph at 32px. Monochrome first (ink-950 on chalk, chalk-50 on ink); Volt accent never inside the logo.
- Logo assets to produce (PX-2): SVG wordmark, glyph-only mark, favicon.ico + PNG set, OG default image (1200×630: wordmark on ink-900 with floodlight gradient edge), maskable PWA icon.
- Tagline (bound): **"Tournament auctions, taken seriously."** (already the meta description).

## 3. Dark mode ruling

Two themes exist and remain: **Daylight** (Console/public default) and **Floodlight** (pinned on Live shell surfaces — the show is always dark, projector-honest). Product ruling: **no user theme toggle in beta**; `prefers-color-scheme: dark` maps public + console pages to Floodlight tokens ONLY where contrast-verified — if a page's audit is not done, it stays Daylight (correct beats fashionable). Toggle is a GA item.

## 4. Iconography & illustration

- Icons: **Lucide** (single library, outline, 1.5px stroke, 20px default; 16px in table rows, 24px rail). Icon-only buttons require `aria-label` and a tooltip.
- Rail icons (fixed): Home=house, Competitions=trophy, Organizations=users, Money=indian-rupee, Help=life-buoy.
- Illustration: none in beta except empty states, which use the existing branded `placeholderIdentity` pattern language (geometric, token-colored). No stock art, no mascots.

## 5. Existing primitives — usage law

Button (variants primary/secondary/ghost; `loading` prop mandatory on submits) · Badge (tones map to status triads; the status→tone map in 06 §Appendix is the single source) · Card · Money (**every rupee figure; paise-integer in**) · Skeleton · EmptyState · Field/Select · Tabs · Dialog · Toast (ToastProvider) · PlayerImage/PlayerCard · Announcer/VisuallyHidden · useHoldGate.

**New law**: Dialog and Skeleton graduate from gallery-only to required — every destructive action confirms via Dialog (or holds via useHoldGate on live surfaces); every server-rendered console page ships a route `loading.tsx` skeleton mirroring its layout.

## 6. Components to add to `@desiauction/ui` (the complete list — nothing else)

| Component | Spec | Consumers |
|-----------|------|-----------|
| `AppShell` | Top bar + 5-item rail (desktop) / bottom tabs (mobile); slots: bell badge count, avatar menu items, org switcher | every Console page |
| `LiveShell` | Full-bleed, exit door top-left, status-strip slot (existing ribbon drops in) | D1–D4 |
| `PublicShell` | Slim header + footer | A1–A7 |
| `Breadcrumb` | Max 3 levels, mirrors `<title>` | Console |
| `SubNavTabs` | Competition tab row; supports attention dots (count or boolean) | C7–C10, E1, E3 |
| `DataTable` | Wraps existing table CSS: sticky header, row selection, sort indicators, **card-row collapse under 720px** (each row becomes a Card with label/value pairs), pagination slot | C8, C9, E1, E2, F1, G1 |
| `Stepper` | Horizontal status stepper driven by an enum + current value | E1 case lifecycle, fixture lifecycle |
| `StatCard` | Label + Money/number + delta slot | /home, money pages |
| `NotificationList` | Dispatch row renderer (kind icon, title, time, unread dot) | bell popover, /inbox |
| `DocumentRow` | Number, kind badge, party, amount (Money), digest short-hash, download | F1, F2, F3 |
| `Timeline` | Already a CSS pattern in consoles — promote to component | E2, C8, C9 |
| `ShareField` | Read-only URL + copy button + copied toast (pattern exists inline ×3 — consolidate) | C4, C7, E3 |
| `Banner` | Page-level info/warning/danger strip (e.g., discrepant case, beta notices) | several |

Charts ruling: **no chart library in beta.** The only "charts" are StatCards and table bars (CSS percentage fills for purse spent/remaining using `money-*` tokens). Real charting enters with Reports post-beta.

## 7. Accessibility (bound, testable)

1. WCAG 2.2 AA contrast on both themes (token pairs pre-verified; new pairs must pass before merge).
2. Every interactive element keyboard-reachable; focus visible via `focus-ring` token; dialogs trap focus (existing Dialog does).
3. Route changes move focus to the `h1`; skip-to-content link in every shell.
4. Live announcements stay on the existing `Announcer` (polite for bids, assertive for SOLD/recovery).
5. Tables: `<th scope>`, captioned; card-row collapse preserves label association.
6. Automated axe pass in e2e for every shell + one page per section; zero serious violations.
7. Text scaling to 200% must not clip Console layouts (canon C-15).

## 8. States — the four mandatory states per screen

- **Loading**: route `loading.tsx` skeletons (shape-accurate: rail + header instantly, content skeleton); in-page mutations use Button `loading`.
- **Empty**: `EmptyState` with a verb-first CTA (copy in 05 §12). Empty ≠ error; never show a table header over nothing.
- **Error**: inline field errors (existing pattern); page-level `error.tsx` per shell; mutation failures → Toast (danger) with the server's reason verbatim — the writers already return honest reasons; never paraphrase money errors.
- **Forbidden**: capability-gated pages render a designed 403 state ("You need the settlement officer grant — ask your organizer") — never a blank or a crash.

## 9. Responsive behavior (bound)

Breakpoints: 360 (floor) · 720 (tables collapse, rail→bottom tabs) · 1024 (rail expands with labels) · 1440 (max content).
- Public + identity + live + money-personal pages: designed mobile-first, verified at 360px.
- Console ops tables (registrations, fixtures): DataTable card-row collapse ≤720px; bulk bar becomes a sticky bottom sheet.
- Cockpit: desktop-first; must remain operable (no overflow traps) at 768px landscape; not supported below.
- Playwright device projects (`iPhone 14`, `Pixel 7`) run the registration, live-room, spectate, and money-personal journeys — added to the existing e2e suite.

## 10. Page-skeleton conventions

Console page = Breadcrumb → `h1` + primary action (right) → StatCards row (optional) → content cards/tables → timeline (optional). Public page = h1 hero → sections at 720px measure. Blueprints in 06 assume these conventions and only note deviations.
