# 05 — Design Language: FLOODLIGHT

> Canon: C-4, C-5, C-6, C-23 · v1.0 · 2026-07-11

## The idea

**FLOODLIGHT** — *the calm of the night stand, the clarity of the lit pitch.*

A floodlit cricket ground at night is the product's aesthetic truth: a vast, quiet darkness holding one brilliantly lit place where everything that matters happens. Around the light: stillness, anticipation, deep blues and blacks. Inside the light: perfect legibility, electric green, moments that feel like television.

This replaces the previous product's visual language entirely. Nothing visual carries over.

## The seven laws

1. **One lit thing.** Every screen has exactly one brightest point — the current lot, the primary action, the number that matters. If two things compete for peak salience, one is wrong.
2. **Darkness is a stage, not a theme.** Live surfaces (Cockpit, Owner Room, Stage, Overlay) are dark-first because darkness makes the lit thing electric and rooms/projectors demand it. Console defaults to **Daylight** because eight hours of admin work demands calm paper, not drama. Both are token-complete first-class themes (C-4).
3. **Gold is earned** (C-5). Gold appears at exactly two moments: a lot is SOLD, and a champion is crowned. It is never a border, never a badge color, never decoration. Scarcity is what makes the ceremony land.
4. **Numbers are the heroes.** This is a product about money and time. Numerals get the display face, tabular alignment, and the largest type on live surfaces. A spectator at the back of the hall reads the current bid before anything else.
5. **Calm is engineered, not empty.** Whitespace, a strict 4px rhythm (10), one accent color, and motion that only confirms (11). Restraint everywhere is what lets the SOLD ceremony spend richly.
6. **Truth wears its status.** Connection state, data staleness, and degraded modes are always visible, quietly (LiveBadge, seq indicator — 19). The interface never pretends to be fresher than it is.
7. **Dignity has a visual grammar** (C-23). UNSOLD renders in neutral ink, medium size, no red, no sound, brisk exit. Rejection, removal, and failure involving *people* never use the error palette — error styling is for systems, not humans.

## Feel targets (the five-second test)

| Surface | First feeling |
|---------|---------------|
| Console | *"A precision instrument. I'm in good hands."* |
| Cockpit | *"Mission control. I am calmly in charge."* |
| Owner Room | *"Courtside seat. My money is safe and live."* |
| Stage | *"This looks like a broadcast."* |
| Overlay | *"This IS a broadcast."* |

## Benchmarks

The bar is world-class product design, not enterprise software: the operational calm of Linear, the material confidence of Stripe, the broadcast energy of a modern sports graphics package. Never corporate, never template, never cluttered.

## Anti-patterns (instant rejection)

- Gradient-on-everything, glassmorphism-by-default, decorative blur.
- More than one accent hue on a screen (Volt is alone; semantic colors appear only with meaning).
- Gold outside the two earned moments.
- Dashboard-as-wallpaper: stat cards that answer no question (32).
- Any layout that makes the current bid less than the loudest element on a live surface.

## Where it's specified

Color 08 · Type 09 · Space 10 · Motion 11 · Icons 12 · Tokens 18 · Components 19. Those documents implement these laws; conflicts resolve toward this file.
