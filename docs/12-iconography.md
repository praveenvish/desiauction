# 12 — Iconography

> Canon: C-4, C-6 · v1.0 · 2026-07-11

## Base set

**Lucide** (ISC license): consistent 24px grid, 1.5px stroke, open, tree-shakable. One library only — the previous product's audit found four coexisting icon idioms; here, non-Lucide SVGs are lint-banned outside `@da/ui/icons` (64).

## Usage rules

- Sizes: 16 (inline/dense), 20 (default UI), 24 (headers, empty states), 32+ (live surfaces only).
- Stroke stays 1.5px at all sizes (Lucide scales stroke proportionally — we pin it).
- Color: icons inherit text color (`currentColor`) always; volt icons only for live/actionable meaning (08).
- Every icon-only button has an accessible name; icons never carry meaning alone — paired with text except in space-critical, convention-strong spots (close ×, chevrons), and even those carry `aria-label` (13).
- Filled variants are not used; the outline weight is part of the language's calm.

## Custom auction glyph set

Drawn on the Lucide grid (24px, 1.5px stroke) and shipped from `@da/ui/icons`:

| Glyph | Meaning |
|-------|---------|
| `paddle` | A bid / bidding action |
| `gavel-strike` | Close lot (Cockpit conduct only) |
| `purse` | Team budget (drawstring pouch, not a wallet — local, not fintech) |
| `lot` | A player lot (tag + person silhouette) |
| `pass` | Tournament Pass entitlement |
| `beam` | The brand beam; used for "live" and the loading motif |
| `stumps` | Cricket/match contexts |
| `ledger` | Audit/receipt contexts (ruled page) |

Additions require: same grid/stroke, review against Lucide's visual grammar, and a metaphor test with two non-designers.

## Semantic pinning

One concept = one icon, forever, recorded here: settings=`settings-2`, export=`download`, share=`share-2`, live=`beam`, audit=`ledger`, money=`purse`, delete=`trash-2`, edit=`pencil`, add=`plus`, close=`x`, back=`chevron-left`, external=`arrow-up-right`. Drift (same concept, new icon) is a review-blocking defect.
