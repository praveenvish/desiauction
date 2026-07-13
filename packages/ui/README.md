# @desiauction/ui — FLOODLIGHT Design System

**v0.1.0 · frozen at `ip1-frozen`.** The visual foundation for every DesiAuction surface (C-4/C-5/C-6, docs 05–18). Breaking API changes after freeze require a founder-visible decision and a codemod (doc 18).

## Consumption rules

- Import components from `@desiauction/ui` only; never deep-import internals.
- Load styles once, in the app root, in this order:
  `styles/fonts.css` → `styles/primitives.css` → `styles/floodlight.css` → `styles/daylight.css` → `styles/motion.css`.
- Theme = `data-theme="floodlight" | "daylight"` on the surface root. Live surfaces pin `floodlight`; Console defaults `daylight` (C-4).
- **Components never see raw palette values.** Semantic tokens only; the guardrail test (`src/guardrails.test.ts`) fails the build on any hex/rgb literal in component source.
- This package **never imports `@desiauction/core`** (dep-cruiser enforced). `<Money>` receives pre-formatted strings; formatting lives in core (C-7).

## What lives where

| Area              | Contents                                                                                                                                                                   |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tokens/`         | DTCG JSON source of truth (doc 18). `pnpm build` regenerates `src/generated/` (committed; CI fails on drift). New token = two real usages + no existing token that serves. |
| `src/primitives/` | The Eleven: Button/ButtonLink, Field, Select, Badge, Card, Dialog, Toast, Money, Tabs, Skeleton, EmptyState                                                                |
| `src/identity/`   | C-25: `placeholderIdentity` (pure, deterministic), `PlayerImage`, `PlayerCard`. Identity is theme-stable by design; team color is data, not accent.                        |
| `src/motion/`     | `motion.css` grammar (enter/exit/emphasis) + `useHoldGate` — **the safety gate is a clock (F-AX-1); never reimplement hold timing with animation**                         |
| `src/live/`       | `AnnouncerProvider`/`useAnnouncer` (polite queue + assertive channel, C-15), `VisuallyHidden`                                                                              |
| `src/fonts/`      | Self-hosted faces + licences. Zero font CDNs, ever.                                                                                                                        |

## Non-negotiables encoded here

Gold renders only through `ceremony-*` tokens (C-5) · `passed`/unsold is neutral, never danger (C-23) · money numerals are tabular with exact value inspectable (C-7) · every animation has a reduced-motion variant; safety timing is never animation-based (F-AX-1) · silhouettes are unrepresentable in the identity API (C-25).

## Verification

`pnpm test` (unit incl. guardrails) · `pnpm typecheck` · `pnpm lint` · gallery e2e lives in `apps/web/e2e/` (contrast measured, axe, real-browser journeys). Evidence at each phase gate: `docs/phase-2/GATES.md`.
