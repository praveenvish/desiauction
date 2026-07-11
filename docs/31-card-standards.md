# 31 — Card Standards

> Canon: C-4, C-5 · v1.0 · 2026-07-11

## Card taxonomy

| Kind | Component | Job |
|------|-----------|-----|
| **Entity card** | `EntityCard` | One object at a glance: identity + 2–4 facts + status + actions. The mobile recomposition target for tables (30) |
| **Stat card** | `Stat` | One number answering one question (32 rules apply) |
| **Lot card** | `LotCard` | The live player presentation (17 attention physics) |
| **Container card** | `Card` | Grouping surface for a section — chrome, not meaning |

## Entity card contract

- Anatomy: leading `Avatar`/logo · title (name) · subtitle (one contextual fact) · 2–4 key-values · status `Badge` · trailing actions (≤ 2 + overflow).
- The whole card is one click target → **Peek**; inner actions stop propagation (a card whose buttons navigate the card is a defect — carried lesson from the reference program's live-verify).
- Fixed information slots: cards in a grid must be scannable in a column — same fact in the same position on every card. Variable-height content (bios) is banned from cards; that's the peek's job.

## The Peek (slide-over)

Inspection without navigation (16 return-context partner): 480px right slide-over with the entity's full summary, primary actions, and a "Open full page →" door where a full page exists.

- Peek never contains forms beyond single-decision actions (approve/reject with reason); editing opens the real edit surface.
- Keyboard: `↑/↓` moves peek through the underlying list (review-queue ergonomics — registration triage lives on this); `Esc` returns focus to the originating row (13).
- Peeks are URL-addressable (`?peek={id}`) so triage sessions survive reload and are shareable.

## Rules

- Radius `lg`, padding `space-5` (dense: `space-4`), elevation per theme (10).
- One card style per collection — mixed card designs in one grid is a defect.
- Cards never nest cards; a card needing internal cards is a section (use `Panel`).
- Gold on cards: never (C-5) — the SOLD ceremony's gold frame is `SoldStamp`'s, applied to the lot presentation, not a reusable card variant.
- Grid: `Grid` component, min-width-based auto-fit (280px min), gap `space-6`; a lone card in a grid row stretches to a max of 480px (no full-width lonely cards).
