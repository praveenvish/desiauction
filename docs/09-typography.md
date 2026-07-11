# 09 — Typography

> Canon: C-6, C-7, C-15 · v1.0 · 2026-07-11

## Faces

| Role | Face | License | Where |
|------|------|---------|-------|
| **Display** | Clash Display | Fontshare (free, commercial) | Player names on live surfaces, current bid, SOLD, page-level moments |
| **Text/UI** | Geist Sans | OFL | Everything else: body, labels, controls, tables |
| **Mono** | Geist Mono | OFL | Ledger, receipts, IDs, seq numbers, API/dev surfaces |

All self-hosted, `font-display: swap`, subsetted (Latin + Devanagari for Geist fallback stack; Clash Display Latin-only — Devanagari display moments fall back to a specified stack `"Clash Display", "Mukta", sans-serif` until a Devanagari display face is commissioned, tracked as a known gap).

## Scale

Rem-based, 1.25 ratio from a 14px UI base (Console density) with live-surface sizes stepping far beyond the ratio deliberately.

| Token | Size / line | Use |
|-------|-------------|-----|
| text-xs | 12/16 | Timestamps, table meta |
| text-sm | 13/18 | Secondary UI, dense tables |
| text-base | 14/20 | Console default UI |
| text-md | 16/24 | Body prose, forms on public pages |
| text-lg | 18/26 | Card titles |
| text-xl | 20/28 | Section headings |
| text-2xl | 24/30 | Page titles |
| text-3xl | 30/36 | Dashboard key numbers |
| display-sm | 38/44 | Owner Room current bid |
| display-md | 48/52 | Stage player name |
| display-lg | 64/68 | Stage current bid |
| display-xl | 96/96 | Overlay bid, SOLD stamp |
| display-2xl | 140/140 | Overlay/projector peak (current bid at 10m distance) |

Weights: Geist 400/500/600 (no 700 in UI — 600 is the ceiling; restraint reads premium). Clash Display 500/600.

## Numeric rules (C-7)

- **All numerals in data contexts are tabular** (`font-variant-numeric: tabular-nums`): tables, purses, bids, timers. Enforced by component primitives, not per-usage.
- Money display grammar: Indian notation with unit suffix — `₹80,000` below ₹1 L; `₹1.2 L`; `₹1.5 Cr`. Exact paise value always available on hover/long-press and always exact in receipts and exports (mono face).
- Timers render in mono-spaced digits sized to never reflow (fixed-width container at max digits).
- Negative or corrected money never uses parentheses (ambiguous in this market); use explicit sign and label.

## Hierarchy rules

- One display-face element per screen region, max two per screen (05 law 1: one lit thing).
- Letter-spacing: display faces −1% at ≥48px; UPPERCASE labels (badges, table headers) get +6% and text-xs/sm only.
- Line length: prose 60–75ch; form help text ≤ 48ch.
- Truncation: player and team names never truncate on live surfaces — the layout must scale down (auto-fit) before an ellipsis appears. Ellipsis is acceptable in Console tables with full value on hover.

## Devanagari & bilingual (C-24)

- UI strings are externalized; layouts must tolerate +35% string length (Hindi expansion) without breaking — CI includes a pseudo-locale expansion test (58).
- Geist's Devanagari fallback: `"Geist", "Mukta", "Noto Sans Devanagari", sans-serif`. Numerals remain Latin/tabular in all locales (money legibility wins).

## Accessibility (C-15)

- User font-size scaling to 200% must not break Console layouts (14-responsive).
- No text under 12px anywhere; no color-only emphasis — weight or size always accompanies (13).
