# PREMIUM-1 · DesiAuction UX transformation plan

> Branch `ui/premium-foundation` · 2026-09-13 · Audit of the as-built product at `a174220` plus the uncommitted foundation pass already on this branch.

## 1 · Current architecture (what is actually here)

| Layer | As built |
|---|---|
| Framework | Next 15 App Router, React 19, server components + server actions; Fastify/WS engine (`apps/engine`) is the single writer for every auction command. |
| Design system | `@desiauction/ui` — "FLOODLIGHT": two themes (`daylight` console, `floodlight` live/marketing), style-dictionary tokens, CSS-module primitives (Button, Card, Badge, Money, Stat, Tabs, Dialog, Toast, Field, Skeleton, EmptyState, ErrorState), three shells (App / Public / Live), identity kit (PlayerImage, PlayerCard, placeholder monograms), hold-gate, announcer. Canon: `docs/00–70` + `docs/EXPERIENCE_DIRECTION.md`. |
| Type | Clash Display (display), Geist Sans (UI), Geist Mono (numbers/ids), Anek Devanagari fallback. Self-hosted. |
| Auction state | `deriveCeremony()` in `packages/core/src/auction-ceremony.ts` already IS the explicit state machine the brief asks for: `idle · opening · bid · extension · hold · sold · unsold · withdrawn · reopened · paused · recovered · completed`, keyed so every connected surface renders the same frame for the same moment. |
| Live surfaces | `/auction/live` (bidder room), `/cockpit` (auctioneer, hold-to-gavel, keyboard), `/spectate` (+ fullscreen "Big screen"), `/board` (venue projector), `/overlay` (OBS lower-third), `/replay`, `/ledger`. Shared kit: `LotHero` + `CountdownRing`, `CeremonyStage`, `PaddleControl`, `PurseBoard`, `SquadBoard`, `AuctionTimeline`, `StatusRibbon`, `AuctionAnnouncer` (aria-live thresholds). |
| Foundation already on this branch (uncommitted) | `shadow-4`, depth/rhythm tokens, `Card interactive`, `Tilt`, `Reveal`/`.da-reveal`/`.da-stagger`, one Lucide-grid icon set, a synthesised `soundEngine` (six cues, gesture-unlocked, device-local preference) — wired only into `/gallery`. |
| Verification | 117 ui unit tests, `pnpm verify` (lint · typecheck · vitest · prettier · depcruise · motion-token gate), 38 Playwright suites incl. axe contrast scans that sample **every animation frame**. |

## 2 · Strengths to retain

- The canon is already "premium but controlled": gold is earned (SOLD + champion only), UNSOLD is dignified (no red, no sound), motion confirms, calm for operators, electricity for the room. The brief and the canon agree; this pass implements the canon harder, it does not replace it.
- Indian money is native: `formatPaiseINR`, lakh/crore short forms, tabular numerals, `Money` primitive.
- The landing page proves the product with a scripted stage that server-renders a truthful SOLD frame (LCP is product DOM). No stock photography, no fabricated customers.
- The console home already leads with the live night (`home-live` tile), a lifecycle strip, an attention queue, and a setup ladder for first-run.
- Accessibility is structural: announcer regions, hold-gate under reduced motion, transform-only text animation, contrast measured in e2e.
- Every live surface is presentation over one read-only `AuctionSnapshot`; nothing in the UI decides money.

## 3 · Major weaknesses (measured on the running app)

1. **The SOLD moment is under-choreographed against its own spec.** Doc 11 specifies a 1800 ms four-beat ceremony (freeze → gold stamp with spring → facts roll in → settle to a thin frame, gold *drift* not confetti). As built: a 24 px "SOLD" title, a 6 px translate, and falling confetti. No hammer, no stamp, no "SOLD TO / FOR" hierarchy, no facts roll-in.
2. **Bids change without an event.** `.lot-hero-bid` remounts with a 200 ms lift; there is no digit roll, no frame pulse, no leading-team activation. On a hall screen a bid can be missed.
3. **No player reveal.** A new lot replaces the previous one in a single frame.
4. **Timer urgency is a single colour flip at 15 s.** Spec: warning colour + 1 Hz breathe under 10 s; the ring never signals "critical".
5. **Sound exists but no room can hear it.** The engine and toggle live in `/gallery` only.
6. **Landing stage shows a monogram, one amount and a stamp** — it does not show the *duel* (three franchises calling, the price climbing, the hammer). The hero should be the theatre.
7. Console list pages (`/auction` results, `/teams`) are tall single-column stacks of equal-weight cards; nothing on the page is "the one thing" (EP-4).
8. Gold leaks: `--accent` and `--ceremony-gold` are the same hex, so every primary button already wears the ceremony colour (a canon tension, out of scope to re-tint here; noted).

## 4 · Design language (as adopted for this pass)

Nothing new is invented; the pass adds one vocabulary the canon names but never built: **the theatre**.

- **Surfaces**: office = daylight, calm, `shadow-1` cards, one gap scale (`rhythm-*`). Room = floodlight, sunken stage, light follows the lit thing.
- **Gold** appears in exactly the two earned moments; the stamp and the drift are the only gold *motion* in the product.
- **Numbers** are the loudest type on a live surface: display face, tabular, and now they *move* — digit roll on change, transform only.
- **Depth**: `shadow-4` for the one floating stage; `Tilt` only on fine pointers; no glass beyond the existing marketing header.
- **Motion registers** (doc 11 tokens): micro `instant/fast`, standard `base/slow`, premium `emphatic/dramatic`, ceremony `ceremony`. Every duration ≤ 2 s must name a token (`pnpm check:motion` enforces it).
- **Hard rule carried forward**: text never animates opacity or colour mid-frame; contrast holds at every sampled frame.

## 5 · Screen hierarchy

Public: `/` (theatre hero) → `/c` directory → `/c/[slug]` landing → `/spectate`.
Console: `/home` (the night, then the queue) → `/seasons/[slug]` (overview) → teams / registrations / auction → `/cockpit`.
Room: `/live` (bidder: lot · paddle · purse) · `/cockpit` (conductor) · `/spectate` · `/board` · `/overlay`.

## 6 · Auction experience architecture

```
AuctionSnapshot (engine, WS) ─► useAuctionSocket ─► deriveCeremony ─► CeremonyState {phase, key}
                                                         │
     ┌──────────────┬──────────────┬─────────────────────┼─────────────────────┐
  LotHero      CeremonyStage    PaddleControl      useCeremonySound      AuctionAnnouncer
  (RollingNumber, (SoldStamp,      (bid ladder)       (cues on key change)  (aria-live)
   reveal, ring)   HammerStrike,
                   GoldDrift)
```

Reusable theatre primitives (new, `@desiauction/ui`): `RollingNumber`, `SoldStamp` (with `HammerStrike`), `GoldDrift`. Consumers: CeremonyStage, LotHero, HeroStage (landing), board, overlay — so the landing demo and the real room share one choreography.

## 7 · Animation strategy

| Register | Where | How |
|---|---|---|
| Micro | buttons, chips, icon-trail | existing tokens |
| Standard | Card interactive, Reveal, stagger | foundation (this branch) |
| Premium | **bid landing** (digit roll + frame pulse + leader chip), **player reveal** (kicker → name → meta → money, 60 ms stagger), **timer** (breathe ≤10 s, critical ≤5 s), anti-snipe refill | this pass |
| Ceremony | **SOLD** 1800 ms four beats; **UNSOLD** 400 ms neutral stamp; **complete** gold frame | this pass |

Reduced motion: stamp and facts render at rest, ring becomes a number, drift removed, digits jump. Same information, no movement.

## 8 · 3D strategy

CSS only. `Tilt` (≤6°, fine pointers) on the landing stage and player cards; `perspective` on the stamp and price arrival; no WebGL — nothing in this product justifies a scene graph on a phone in a hall, and the floodlight beams already give depth. Fallback is the flat frame.

## 9 · Sound strategy

Synthesised cues, no files, off by default, unlocked inside the toggle's click. Cue map: `opening` on lot open · `bid` on a new bid · `extension` on anti-snipe · `warning` at 10 s · `sold` on the stamp · `complete` at the wrap · **none** for UNSOLD. Toggle rides in the Live shell status strip (live, cockpit, spectate) and floats on `/board`; `/overlay` (OBS) has no toggle by design.

## 10 · Implementation order (this pass)

1. Theatre primitives in `@desiauction/ui` (+ unit tests, gallery demo).
2. CeremonyStage: SOLD/UNSOLD choreography, opening reveal, drift.
3. LotHero: RollingNumber, reveal stagger, timer tiers, bid pulse.
4. Sound wiring (`useCeremonySound`) + toggle placement.
5. Landing hero: the duel (three franchises, climbing price, hammer, stamp).
6. Console: quick-action row and KPI strip on `/home`.
7. Verify: `pnpm verify`, targeted e2e (conduct-ceremony, live-auction, auction-experience, motion, gallery, public-experience, shell), screenshots via `scripts/ui-audit-live.ts`.
8. Report + remaining gaps.

Out of scope, documented as gaps: "Try a demo auction" (blocked by the engine's ≥2-claimed-paddles guard — needs a rehearsal mode in the engine), command palette as ⌘K (InlineSearch exists; keybinding is a one-line follow-up), analytics charts, accent-vs-gold re-tint.
