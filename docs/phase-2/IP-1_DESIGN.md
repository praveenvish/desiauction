# IP-1 — FLOODLIGHT DESIGN SYSTEM · DETAILED DESIGN
## DesiAuction NEXT · v1.0 · 2026-07-13 · CTO · Active phase artifact

> Governed by Blueprint v1.1 (FROZEN) §IP-1, Canon C-4/C-5/C-6/C-7/C-15/C-25, VA-0 (EP/XC), docs 05–18, M0 condition RC-6 (IP-2 consumes this phase FROZEN) and M0 improvement 2 (only components with named consumers). Per the Delegation Charter this design is CTO-authorized; founder veto is async — it does not block the build. Detailed design exists for IP-1 only.

## 1 · Executive summary

IP-1 turns FLOODLIGHT from specification (docs 05–18) and browser-proven reference (`va1-rc1`) into `@desiauction/ui`: a token system both themes share (C-4), a typography stack with the Devanagari question settled (WI-7), a bounded set of primitives — every one traceable to a named consumer in GJ-1..6 or the five surfaces — the **C-25 player-identity system** (photo + premium branded placeholder, silhouettes structurally impossible), and a motion grammar whose reduced-motion variants preserve safety time-gates (the RC1 F-AX-1 lesson, now a rule). Verification is local-first: a gallery route rendered by the real Next pipeline, swept by the existing Playwright+axe harness, with contrast *measured*, not eyeballed.

## 2 · Scope

Tokens (color/space/type/motion/elevation, Ink+Daylight, C-4/C-5) · typography incl. self-hosted fonts + WI-7 ruling · primitives with named consumers (§9) · C-25 identity system · motion grammar + reduced-motion rules · live-region/announcer utilities (C-15) · gallery + a11y verification harness · package docs.

## 3 · Goals
G1 `packages/ui` importable by `apps/web` with zero configuration beyond what exists. G2 both themes token-complete; no component knows theme names. G3 AA measured on every primitive (contrast numbers recorded). G4 C-25 placeholder generator founder-approved against WI-9 sensitivities. G5 gallery = the phase's living evidence; freeze ships a versioned, frozen package (RC-6).

## 4 · Non-goals (deferred, recorded)
No surface compositions (IP-3/IP-5) · no auth UI (IP-2 consumes frozen output) · no data-display compounds beyond named needs (no generic DataGrid) · no Storybook/Chromatic (§13) · no icon *system* beyond the used set · no dark/light auto-switching logic (surfaces declare theme, C-4) · **sound + Hindi voice register (VA-8) = founder inputs, late slice §18; absence does not block earlier milestones.**

## 5 · Inputs & rulings

- **WI-7 RULED (CTO authority, in-phase):** display companion for Devanagari = **Anek Devanagari**; Latin display remains **Clash Display** (C-6). Machine evidence: va1-rc1 H7 (Anek carried ceremony text; Clash has no Devanagari). Amendment note to doc 09 ships in this phase's closure PR (docs-first rule honored in-PR).
- **Fonts, self-hosted only** (DPDP posture: zero third-party font CDNs): Geist Sans/Mono via `geist` npm; Clash Display woff2 vendored under ITF/Fontshare free licence (licence file committed beside the font); Anek Devanagari via `@fontsource/anek-devanagari`.
- **Reference discipline:** `prototypes/va1` is looked at, never imported (frozen, checksummed).
- **VA-8 founder inputs** (sound ruling, Hindi voice register): requested once, at §18 M-IP1-4; motion/announcer land independently.

## 6 · Package architecture (`packages/ui`)

```
src/
  tokens/     colors.css.ts  space.ts  type.ts  motion.ts  themes.css  (CSS custom properties + typed TS mirror)
  fonts/      geist re-export · clash-display/*.woff2 + LICENCE · anek re-export · fonts.css
  primitives/ button.tsx field.tsx select.tsx badge.tsx card.tsx dialog.tsx toast.tsx money.tsx skeleton.tsx empty-state.tsx tabs.tsx
  identity/   player-identity.tsx placeholder.ts (pure generator)
  live/       announcer.tsx visually-hidden.tsx
  index.ts    (single barrel)
```

Rules: deps = `react` only (+`@fontsource/*`, `geist` as asset packages); **never `@desiauction/core`** (dep-cruiser rule exists); styling = **CSS custom properties + plain CSS modules** — no styled-components/tailwind/vanilla-extract (§13 challenge); every component: forwardRef, explicit props type, no `any`, keyboard-first.
Theming: `<html data-theme="ink"|"daylight">`; `themes.css` defines the two complete variable sets (C-4: neither derived from the other); components reference only semantic vars (`--color-surface`, `--color-accent`, `--color-money`…), never palette literals; **gold vars exist only in ceremony-scoped tokens (C-5: gold is earned)**.

## 7 · Typography & money
Scale per doc 09 (tabular numerals mandatory in all data contexts, C-6). `<Money>` renders integer paise via `formatPaiseINR`-compatible display (value comes formatted from callers in `web` which import core; **ui itself stays core-free** — it receives strings + optional exact-value tooltip slot, preserving C-7 inspectability without breaking the ui↛core boundary).

## 8 · Accessibility approach (C-15)
AA is measured, not asserted: gallery page renders every primitive in every theme; Playwright sweep runs axe + computes contrast pairs; keyboard walk scripted (tab order, focus-visible, Escape/scrim rules for dialog); `Announcer` implements the live-region strategy (polite queue + assertive channel for money-critical events, consumed for real in IP-5). Reduced-motion: every motion token has a still-variant; **any interaction with a safety time-gate keeps the gate when animation is removed** (F-AX-1 rule, enforced by a shared `useHoldGate` utility that is time-based, not animation-based).

## 9 · Component inventory — named consumers only (M0 imp. 2)

| Primitive | First consumer (evidence) |
|---|---|
| Button / ButtonLink | every journey (GJ-1 registration submit …) |
| Field (label+input+error) / Select | GJ-1 registration, GJ-2 setup forms |
| Badge (role/status chips) | roster + results (doc 70) |
| Card | Console lists (GJ-2), team board |
| Dialog | destructive confirms (GJ-2), IP-2 auth flows |
| Toast | save/ack feedback across Console |
| Money | every purse/price render (C-7) |
| Tabs | Console hub (doc 63) |
| Skeleton / EmptyState | list loading + zero states, Console |
| PlayerIdentity | Roster/Profile/Search (IP-3) then Stage/Owner/SOLD (IP-5) — C-25's six surfaces |
| Announcer / VisuallyHidden | C-15 live regions (IP-5 hot path) |

Anything without a row here is out of scope until a consumer exists.

## 10 · C-25 identity system
`PlayerIdentity` sizes xs→hero; states: photo · placeholder · loading. `placeholder.ts` = pure deterministic generator (seed = player id): premium branded mark — initials set in Clash/Anek per script detection, on a two-tone Ink-scale field with a per-player accent pattern derived from seed; **no human-figure silhouettes representable in the API**. Handles: Devanagari names, single-name players, very long names, missing data (falls to tournament-branded mark, still premium). Photo path: object-fit cover, fixed ratios, alt = player name, no layout shift (explicit dimensions). Founder eyeball vs WI-9 sensitivities at M-IP1-3 demo.

## 11 · Motion grammar
Tokens: durations (fast 120ms / standard 200ms / ceremony per doc 11) + easings as CSS vars + TS mirror; choreography primitives only (enter/exit/emphasis); the SOLD ceremony itself is IP-5 composition — IP-1 ships its ingredients (gold tokens, ceremony durations, `prefers-reduced-motion` still-variants).

## 12 · Testing strategy
Unit: vitest + Testing Library + jsdom per primitive (roles, labels, keyboard contract, controlled/uncontrolled). Generator: property-style tests (same seed→same mark; script detection; no-crash on adversarial names). E2E: gallery sweep (axe zero violations, contrast table asserted, focus walk) via existing Playwright harness. Coverage: ≥75% changed-code (Blueprint §3) and every primitive has a keyboard test — the bar that matters.

## 13 · Gallery & tooling decision (5-question test, ED-1)
**Decision: no Storybook. Gallery = `/gallery` route group inside `apps/web` (dev/unlisted), rendering every primitive × theme × state through the real Next pipeline.** Q1 quality: axe+Playwright already wired → yes. Q2/Q3: zero new infra, zero lock-in → yes. Q4 DX: no second build system to babysit → yes. Q5 simplest that works → yes. (Storybook rejected: second bundler + config surface for an audience of one; revisit when a second engineer exists — recorded.)

## 14 · Definition of Done
All §9 primitives shipped w/ tests · tokens complete both themes, no palette literal outside `tokens/` (lint-checked) · fonts self-hosted + licences committed · WI-7 amendment note ready for doc 09 · C-25 generator approved at founder demo · axe zero violations + contrast table recorded in GATES.md · reduced-motion rules verified incl. `useHoldGate` · gallery E2E green in `pnpm verify` flow · package versioned `ui@0.1.0`, tagged `ip1-frozen` at close (RC-6: IP-2 consumes frozen).

## 15 · Acceptance criteria (founder demo)
Gallery on a real phone + desktop: five-second premium check (WI-2 first checkpoint) · identity placeholder wall (20 generated players incl. Devanagari + long names) reads premium, zero silhouettes · both themes flip live · reduced-motion mode demonstrably keeps hold gates.

## 16 · Risks
Aesthetic drift vs va1-rc1 spirit → side-by-side screenshots at every weekly demo · Clash licence scope → licence file review before vendoring (founder owns licence confirmation, tracked in ops) · placeholder aesthetics = taste risk (WI-9) → founder demo early at M-IP1-3, not at freeze · font subsetting for Devanagari weight → measure page cost in gallery E2E budget.

## 17 · Verification & quality gates
Blueprint §4 checklist applies; gate 5 (a11y) and gate 7 (visual) are this phase's center: contrast numbers + axe output + phone screenshots recorded in GATES.md at close.

## 18 · Milestones
**M-IP1-1 (first): tokens + typography + themes render in the gallery, both themes, contrast table green — target ≈ 3 working days.**
M-IP1-2: primitives complete w/ tests + axe zero. M-IP1-3: C-25 identity system + founder eyeball demo. M-IP1-4: motion grammar + VA-8 inputs (sound ruling, Hindi voice register — single founder ask). M-IP1-5: DoD sweep → freeze `ip1-frozen`.

*IP-1_DESIGN.md v1.0 · CTO · 2026-07-13. Build begins at M-IP1-1 immediately after this document lands in the repo.*
