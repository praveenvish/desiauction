# UX-1 — Design system, as built

Documented rather than proposed. The system already exists, is generated, is
committed, and is checked for drift in CI. This records what it is, and the two
places where code steps outside it.

## The pipeline

`packages/ui/tokens/*.json` (DTCG) → `style-dictionary` → three generated files:

- `primitives.css` — **59 non-colour primitives**: spacing, radius, type scale,
  durations, easings. `:root`, theme-independent.
- `daylight.css` / `floodlight.css` — **56 semantic tokens each**, scoped
  `[data-theme="…"]`.
- `tokens.ts` — the same names as a typed module, so a token can be referenced
  from TypeScript without a string literal.

Generated output is committed and CI rebuilds and fails on drift, which is the
right trade: the files are reviewable, and they cannot silently diverge.

## Colour

Semantic, not decorative — every token names a role, and the two themes give that
role two values. The families:

| Family | Tokens | Purpose |
| --- | --- | --- |
| `text-*` | 10 | primary, secondary, muted, disabled, inverse, on-accent, on-dark, on-danger, accent, heading |
| `surface-*` | 5 | base, raised, overlay, sunken, inverse |
| `border-*`, `focus-ring`, `scrim` | 4 | structure and focus |
| `accent-*` | 6 | gold: base, hover, pressed, subtle, sheen, lift |
| status | 12 | success / danger / warning / info, each subtle-base-strong |
| `money-*` | 4 | value, spent, remaining, frozen |
| `ceremony-*` | 3 | the SOLD moment |
| `identity-*` | 7 | the dark rail and crest surfaces, theme-independent |
| `shadow-*` | 3 | elevation |

Two details worth naming because they are easy to get wrong and were got right:

- `--text-on-accent` is **ink, not white**. Gold at AA needs dark text; a white
  label on `--accent` would fail, and the system encodes that rather than leaving
  it to each author.
- `--accent-sheen` exists so decorative highlights have somewhere to go that is
  not the accent itself.

**Where code steps outside it:** five hardcoded hues in two files (F-13). Every
sibling rule in the same block resolves from tokens; these do not, have no second
theme value, and carry no meaning. They pass contrast — this is discipline, not
accessibility. Every other hex literal in the codebase is either inside a
comment, inside a mask gradient (`#000` as a mechanism, not a colour), or inside
a `@media print` block.

## Typography

Three families, self-hosted via `@fontsource` — no third-party font request, so
no render-blocking hop to a CDN:

- **Clash Display** (display) with **Anek Devanagari** behind it
- **Geist Sans** (text) with **Noto Sans Devanagari** behind it
- **Geist Mono** — used deliberately for identifiers, money and machine values

A 13-step scale from `--text-xs` (12/16) to `--display-2xl` (140/140), each size
paired with its line height so the two cannot drift apart.

**One violation:** the 8 px rail tagline (F-9), which is below the scale's own
floor of 12 px.

## Spacing, radius, elevation

A 4 px base with 13 steps. **`--space-7` and `--space-9` do not exist** — a real
trap, because a bad custom property voids the entire shorthand it appears in, so
`padding: var(--space-7) var(--space-4)` silently drops *both* values.

Radius: 6 steps, `sm` → `full`. Shadows: 3 steps, redefined per theme (dark
shadows need more opacity and more spread to read at all).

## Components

**10 primitives**, **4 shells**, **12 further shell parts**, all exported from one
index: Button/ButtonLink, Badge, Card, Money, Skeleton, EmptyState, ErrorState,
Stat/StatRow, Field/Select, Tabs, Dialog, Toast, PlayerCard, PlayerImage,
ImageUploader, AppShell, PublicShell, LiveShell, Breadcrumb, PageHeader/PageIntro/
SectionHeader/QuickActionBar, SubNavTabs, PopoverMenu, Drawer, InlineSearch,
Announcer, VisuallyHidden, and `useHoldGate`.

**Governance is healthy:** 360 uses of the `Button` primitive against ~24 raw
`<button>` elements, and those are genuinely bespoke — the paddle raise, filter
chips, the theme toggle, tab triggers. There is no evidence of one-off components
proliferating.

Two component-level defects: the toast dismiss target (F-6) and the missing
stylesheet import that leaves a whole panel unstyled (F-1).

## Motion

A stated grammar (`motion.css:1-5`): entrances ease-out, exits ease-in, nothing
beyond `--duration-slow` outside ceremonies, and under `prefers-reduced-motion`
every movement becomes an opacity crossfade at `--duration-fast`.

The policy carries one line that most motion systems miss: **safety time-gates
never live in CSS.** A hold-to-confirm that protects money is `useHoldGate`'s
job, because a user with reduced motion must not get a shorter safety window.

Coverage: 21 of 24 animated stylesheets carry a reduced-motion block. Of the
three that do not, two animate only `background` at `--duration-fast` — which the
policy explicitly permits. The third is F-14.

One further subtlety already encoded, in `toast.module.css:65-74`: toasts animate
by **transform only, never opacity**, because a fading toast is genuinely
translucent for those frames and a contrast scanner reading mid-animation is not
producing a false positive — for those milliseconds the text really is unreadable.
