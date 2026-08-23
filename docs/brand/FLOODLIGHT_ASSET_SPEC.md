# FLOODLIGHT — binding spec for all brand assets

Source of truth: docs/05-design-language.md, 06-brand-guidelines.md, 07-logo-exploration.md,
08-color-system.md, 09-typography.md of the DesiAuction repo.

## Colour tokens (exact hex — do not invent shades)
ink-950 #070A0F | ink-900 #0B1018 | ink-850 #101623 | ink-800 #161E2E
ink-700 #1F2A3D | ink-600 #2C3A52 | ink-500 #48597A | ink-400 #7285A6
ink-300 #9FB0CC | ink-200 #C9D4E8 | ink-100 #E8EEF9 | ink-50 #F6F9FF
chalk-50 #FBFBF9 | chalk-800 #282824 | chalk-900 #171715
volt-300 #E2FF66 | volt-400 #CDF53C | volt-500 #B4E11F | volt-900 #2E3D00
gold-300 #FFD666 | gold-500 #F0B429 | gold-700 #B57F14

## The seven laws
1. ONE LIT THING. Exactly one brightest point per composition.
2. Darkness is a stage, not a theme. Ink field, never pure black.
3. GOLD IS EARNED. Gold appears ONLY on SOLD and champion artwork. Nowhere else. Ever.
4. Numbers are heroes — largest type, tabular.
5. Calm is engineered. 4px rhythm. ONE accent hue (Volt). Nothing else.
6. Truth wears its status.
7. Dignity has a visual grammar. No red on a person-outcome.

## The mark — "The Beam" (ratified, docs/07)
A minimal floodlight beam: a narrow triangle of light descending onto a horizontal
baseline, forming a subtle "D" counterform in the negative space.
- MUST work at 16px (favicon) and 40ft (projector)
- MUST survive one colour print
- MUST read inside a 40x40px CIRCULAR mask (social avatar)
- Colourways: Chalk beam on Ink (primary) / Ink on Chalk (documents) / Volt beam on Ink (live only)
- NEVER: gradients inside the mark, outlines, rotation, drop shadows
- EXPLICITLY AVOID: gavels (every competitor uses one) and casino iconography
- Clearspace: one beam-width all sides

## Typography
Display: Clash Display — UNAVAILABLE in this environment.
SANCTIONED FALLBACK (docs/09 + launch plan): Geist SemiBold (600) at display size.
Never substitute any other display face.
Text/UI: Geist Sans 400/500/600. Mono: Geist Mono.
Weight ceiling is 600. No 700, no black weights — restraint reads premium.
Letter-spacing: display -1% at >=48px. UPPERCASE labels +6%, small sizes only.
All numerals tabular in data contexts.

Font files: /home/claude/brand/fonts/ (Geist-Regular/Medium/SemiBold.ttf, GeistMono-*.ttf)
Embed with @font-face using file:// paths or base64.

## Anti-patterns — instant rejection
gradient-on-everything | glassmorphism | decorative blur | more than one accent hue
| gold outside SOLD/champion | drop shadows on the mark | more than two fonts
| centred body text | stock-photo cricket imagery | AI-generated sports imagery

## Contrast floors (C-15)
Body text >= 4.5:1. Large display numerals >= 3:1. Non-text UI >= 3:1.
Text on volt fills is ALWAYS ink-950 or volt-900 — never white.

## Rendering
node /home/claude/brand/render.js in.svg out.png WIDTH HEIGHT [bgcolor]
