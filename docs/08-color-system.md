# 08 — Color System

> Canon: C-4, C-5, C-15 · v1.0 · 2026-07-11

Four families: **Ink** (dark neutrals), **Chalk** (light neutrals), **Volt** (the accent), **Gold** (earned), plus a semantic set. All values are OKLCH-designed, listed here as hex for portability; tokens (18) are the source of truth in code.

## Ink — the darkness (dark-theme neutrals)

Blue-black, never pure black (pure black deadens projectors and crushes OLED smearing).

| Token | Hex | Use (dark theme) |
|-------|-----|------------------|
| ink-950 | `#070A0F` | Stage/Overlay deep background |
| ink-900 | `#0B1018` | App background |
| ink-850 | `#101623` | Elevated surface (cards) |
| ink-800 | `#161E2E` | Higher elevation, popovers |
| ink-700 | `#1F2A3D` | Borders strong, pressed fills |
| ink-600 | `#2C3A52` | Borders subtle on dark |
| ink-500 | `#48597A` | Disabled text on dark |
| ink-400 | `#7285A6` | Secondary text on dark |
| ink-300 | `#9FB0CC` | Primary muted text |
| ink-200 | `#C9D4E8` | Primary text on dark |
| ink-100 | `#E8EEF9` | Headings on dark |
| ink-50  | `#F6F9FF` | Peak text/numerals on dark |

## Chalk — the paper (light-theme neutrals)

Warm-neutral, like a fresh scorebook page; never blue-gray (that's Ink's job).

| Token | Hex | Use (Daylight theme) |
|-------|-----|----------------------|
| chalk-50 | `#FBFBF9` | App background |
| chalk-100 | `#F5F5F1` | Subtle fills, table stripes |
| chalk-200 | `#EAEAE3` | Borders subtle |
| chalk-300 | `#D8D8CF` | Borders strong |
| chalk-400 | `#B0B0A5` | Disabled text |
| chalk-500 | `#83837A` | Placeholder |
| chalk-600 | `#5C5C55` | Secondary text |
| chalk-700 | `#3E3E39` | Primary text |
| chalk-800 | `#282824` | Headings |
| chalk-900 | `#171715` | Peak text |

## Volt — the accent (C-5)

Electric pitch-green. The old brand's green, floodlit. **The only accent hue in the product.**

| Token | Hex | Use |
|-------|-----|-----|
| volt-300 | `#E2FF66` | Glow edges, dark-theme hover |
| volt-400 | `#CDF53C` | Primary accent on dark (live indicators, current bid, primary buttons on dark) |
| volt-500 | `#B4E11F` | Primary buttons (dark theme), focus rings on dark |
| volt-600 | `#8CB40D` | Daylight hover fills (measured 2.35:1 on chalk-50 — below the 3:1 UI floor; never sole affordance) |
| volt-700 | `#6E8F06` | Primary fills/borders/focus on Daylight (measured 3.63:1 on chalk-50 ≥ 3:1; below 4.5:1 — not for body text) |
| volt-900 | `#2E3D00` | Text on volt fills |

Rules: text on volt fills is always ink-950/volt-900 (never white — measured: ink-950 on volt-700 = 5.2:1, on volt-400 = 15.6:1). Accent-colored **text** on Daylight uses volt-900 only (11.3:1; volt-600/700 fail the 4.5:1 text floor — measured correction, IP-1). Volt marks **live and actionable** — it never marks mere selection (that's ink/chalk fills).

## Gold — earned only (C-5)

| Token | Hex | Use |
|-------|-----|-----|
| gold-300 | `#FFD666` | Ceremony gradient light stop |
| gold-500 | `#F0B429` | SOLD stamp, champion accents |
| gold-700 | `#B57F14` | Gold text on light, gradient dark stop |

Appears only in: SOLD ceremony, champion/winner artifacts. Enforced by review, not just convention — `gold-*` tokens are excluded from the general component API (19).

## Semantic

| Intent | Dark theme | Daylight | Notes |
|--------|-----------|----------|-------|
| Success | `#3DD68C` | `#1D9E5F` | Confirmations, paid states |
| Danger | `#FF6369` | `#D93843` | System errors, destructive actions. **Never for people-outcomes** (unsold, rejected — C-23; those use ink/chalk neutrals) |
| Warning | `#FFC53D` | `#B87D08` | Degraded modes, expiring things |
| Info | `#5CA8FF` | `#2673D6` | Neutral notices |

Each semantic gets a 3-stop ramp in tokens (18): `-subtle` (fill), `-base` (icon/border), `-strong` (text).

## Contrast floors (C-15)

- Text ≥ 4.5:1; large display numerals ≥ 3:1; non-text UI ≥ 3:1. Verified in CI on token pairs (59).
- Every `on-X` pairing in 18-design-tokens has a tested pairing; ad-hoc color pairs are forbidden in components.

## Theme rules

- Themes are parallel token sets resolved via CSS custom properties; components never reference raw palette values, only semantic tokens (`--surface`, `--text-primary`, `--accent`, …) (18).
- Live surfaces ship dark-only in V1 (Cockpit, Stage, Overlay, Owner Room); Console ships both, Daylight default, user-switchable, `prefers-color-scheme` honored on first run (C-4).
