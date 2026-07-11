# 19 — Component Library

> Canon: C-6, C-12, C-15 · v1.0 · 2026-07-11

## Package

`@da/ui` in `packages/ui` — React 19, Radix primitives for behavior, tokens (18) for appearance, CVA for variants. Storybook is its living documentation; every component ships with stories, a11y checks, and visual-regression baselines (58).

**The consumption law** (hardest-won lesson from the reference program): screens **consume, never invent**. A screen needing a new pattern proposes it to `@da/ui` first; local one-off components that duplicate a primitive are review-blocking. `packages/ui` never imports from apps.

## Inventory

### Primitives
`Button` (primary/secondary/ghost/danger; busy state built-in) · `IconButton` · `ButtonLink` · `Input` · `Textarea` · `Select` · `Combobox` · `Checkbox` · `Radio` · `Switch` · `Slider` · `DatePicker` · `Field` (label+control+help+error composition — the only way forms are built, 29) · `Form` (RHF+zod binding)

### Layout
`Shell` (the three shells, 16) · `Page` · `PageHeader` · `Panel` · `Card` · `Stack` · `Grid` · `Divider` · `ScrollArea`

### Data display
`DataTable` (30) · `EntityCard` (31) · `Stat` · `Badge` · `Tag` · `Avatar` · `AvatarGroup` · `KeyValue` · `Timeline` · `Money` (the only money renderer — Indian notation, tabular numerals, exact-value affordance, C-7) · `Seq` (event-sequence chip)

### Feedback & overlay
`Toast` (27) · `Dialog` / `ConfirmDialog` / `HoldToConfirm` (28) · `Drawer` · `Peek` (slide-over entity summary, 31) · `Popover` · `Tooltip` · `Banner` · `EmptyState` (22) · `Skeleton` (23) · `Progress` · `Spinner` · `Announcer` (the live-region singleton, 13)

### Auction kit (the product's signature set)
| Component | Job |
|-----------|-----|
| `LotCard` | The current player: identity, base price, role — the lit thing (05) |
| `BidTicker` | Current bid + leading team with landing animation (11) |
| `TimerRing` | Depleting ring; anti-snipe refill; reduced-motion numeric fallback |
| `PurseMeter` | Team budget: spent/remaining/reserve-locked segments |
| `GavelButton` | Cockpit hold-to-close with progress (15) |
| `SoldStamp` | The ceremony (11); sole consumer of ceremony tokens |
| `SquadBoard` | Team roster with role slots and quota states (43) |
| `LiveBadge` | Connection/stream health: live / catching-up / stale / offline (23) |
| `ConnectionPill` | Compact transport status for status strips |
| `AttentionStrip` | Cockpit's single-highlighted-next-action bar (17) |

## API rules

- Variants via typed props (CVA), never className overrides for semantics; `className` accepted only for layout placement.
- Every interactive component implements the full state model (15) and its a11y contract (13) internally — consumers cannot ship an inaccessible instance by default.
- Composition over configuration: components expose slots/children rather than boolean-flag explosions; a component reaching ~8 props is reviewed for splitting.
- No component fetches data. `@da/ui` is presentation-pure; data arrives via props. Auction-kit components accept the projected read-model types from `packages/contracts`.
- Density (10) and theme (18) arrive via context, never per-component props.

## Quality gates per component (69)

Spec (states, a11y, responsive recomposition) → stories for every state including error/empty/RTL-ready → axe pass → visual baselines both themes → unit tests for logic-bearing components (Money formatting, TimerRing math) → docs page. A component missing any gate doesn't export from the barrel.
