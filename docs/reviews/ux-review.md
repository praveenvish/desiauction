# UX Review — Phase 1 Gate

> Reviewer role: head of design · Scope: docs 05–35 against the five-second test and the calm/electric thesis · 2026-07-11

## Method

Walked the six Golden Journeys (70) against the pattern docs, checking every screen-moment has: a specified state set (22–25), a voice (20/21), an accessibility path (13), a responsive posture (14), and no contradiction with FLOODLIGHT's laws (05).

## Findings

### F-U1 · The calm/electric paradox is resolved mechanically, not rhetorically — **Pass**
05's laws + 08's single-accent rule + 11's ceremony budget + 25's confirmation ladder together make "calm" and "electric" *allocations* (where color/motion may spend) rather than moods. The gold-is-earned rule (C-5) is enforceable in code review (08 excludes gold from the component API). This is the difference between a design language and a mood board — the doc set clears it.

### F-U2 · Dark-first live + light-first Console risks brand split — **Resolved**
Checked 08/18: both themes resolve one semantic token set; type, spacing, icons, motion identical; Volt is the accent in both. The brand carrier across themes is the numeric typography + beam motif + voice, which 06 states explicitly. Accepted.

### F-U3 · Volt (chartreuse) on Daylight theme is a legibility trap — **Resolved in spec**
08 pins volt-600/700 for text/actions on light and forbids ad-hoc pairs (tested `on-X` pairs only, CI-gated). The risk is real but the mechanism is present. Phase 2 condition: the actual token values must pass the contrast CI before any screen builds (18 governance).

### F-U4 · Owner Room confirm-threshold (≥ 25% purse) needs live-fire tuning — **Accepted as hypothesis**
15's anti-fat-finger threshold is a designed guess. Correctly framed as tunable; add to pilot instrumentation (rejection/confirm-abandon rates already logged per 41 fairness rules). Not a blocker.

### F-U5 · Reduced-motion parity for the SOLD ceremony must not gut the moment — **Resolved**
11 specifies the static-gold-frame + text fallback ("the information of ceremony"). Verified 25/13 agree. This is the right floor; flag for real-user validation with vestibular-sensitivity testers in Phase 2 a11y pass.

### F-U6 · Peek pattern is load-bearing — its keyboard spec exists — **Pass**
Registration triage (42's 20-minute target) leans entirely on Peek (31): `↑/↓` traversal, URL-addressable, focus restoration. All specified. The 20-minute target is a UX acceptance criterion (GJ-1) — the pattern that must deliver it is fully specced. Good traceability.

### F-U7 · Cockpit phone honesty — **Pass, verify copy**
14 refuses Cockpit-on-phone with an honest message rather than a broken render. Correct call (operator + 200-person room + phone = incident). The message copy isn't yet in 21's canon — added as a Phase 2 microcopy item.

### F-U8 · Devanagari display gap is honest — **Accepted, tracked**
09 admits Clash Display has no Devanagari and names the fallback stack + commissioning gap. Hindi players' names at ceremony scale will render in the fallback until resolved — visible, stated, tracked. The alternative (pretending) would violate 03 §5.

### F-U9 · Terminology discipline is complete — **Pass**
20's table, 00's glossary, and 64's code-naming rule agree; spot-checked 15 docs for "budget/purse" and "player list/pool" drift: none found (only correct uses).

## Five-second test projection

Each surface's first-paint composition is specified (Stage idle poster 22, Console attention queue 32, Cockpit attention strip 17, Owner Room next-lot 22). The premium impression rests on type scale discipline (09) + one-lit-thing (05) + motion restraint (11) — all enforceable. No doc invites clutter.

## Verdict

**PASS**, with Phase 2 conditions: token contrast CI green before first screen (F-U3), Cockpit-refusal copy into 21 (F-U7), ceremony reduced-motion user validation (F-U5).
