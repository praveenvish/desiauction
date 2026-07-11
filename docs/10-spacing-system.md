# 10 — Spacing System

> Canon: C-4 · v1.0 · 2026-07-11

## Base unit

**4px.** Every margin, padding, gap, and fixed dimension is a multiple. No arbitrary values in product code — the previous product's audit spent weeks removing them; here they are banned from day one (lint-enforced, 64).

## Scale

| Token | px | Typical use |
|-------|----|-------------|
| space-0 | 0 | — |
| space-05 | 2 | Icon-to-text hairlines |
| space-1 | 4 | Chip internals |
| space-2 | 8 | Control internals, icon gaps |
| space-3 | 12 | Between related controls |
| space-4 | 16 | Card padding (dense), form field gaps |
| space-5 | 20 | Card padding (default) |
| space-6 | 24 | Between cards, section internals |
| space-8 | 32 | Section gaps |
| space-10 | 40 | Page header to content |
| space-12 | 48 | Major zones |
| space-16 | 64 | Live-surface breathing room |
| space-20 | 80 | Stage compositions |
| space-24 | 96 | Overlay margins |

## Radius

| Token | px | Use |
|-------|----|-----|
| radius-sm | 4 | Chips, tags, inputs' inner elements |
| radius-md | 8 | Buttons, inputs |
| radius-lg | 12 | Cards, popovers |
| radius-xl | 16 | Dialogs, panels |
| radius-2xl | 24 | Stage feature cards |
| radius-full | ∞ | Pills, avatars |

One radius per component; nesting steps down one level (card `lg` → inner control `md`).

## Elevation

- **Daylight:** three shadow levels (`shadow-1` cards, `shadow-2` popovers, `shadow-3` dialogs), layered low-opacity, never single hard shadows.
- **Dark (Ink):** shadows don't read on Ink — elevation = surface step (ink-900 → 850 → 800) + 1px inside border (ink-700/600) + optional 1px top-edge highlight. Glow (volt, low alpha) is reserved for the live/lit element only (05 law 1).

## Density modes

Console tables and lists support **comfortable** (default) and **dense** (rows 40px → 32px, paddings step down one token). Density is a user preference, persisted, applied via a container token switch — components don't implement density individually (19). Live surfaces have no density modes; they have one perfect layout per breakpoint (14).

## Layout grids

- Console: fluid with max-width 1440px content well, 24px gutters; two-pane patterns 320px fixed rail + fluid.
- Stage: 12-col fluid, generous (space-16+) outer margins.
- Overlay: safe-area margins space-24, corner-anchored zones (17).
