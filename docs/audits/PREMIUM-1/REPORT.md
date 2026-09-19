# PREMIUM-1 · Report

> Branch `ui/premium-foundation` · 2026-09-13 · Layered on the foundation commit `a7f366d`. Plan: `TRANSFORMATION_PLAN.md`.

## 1 · UI/UX audit (summary)

Full audit in the plan, §1–§3. Verdict: the canon (docs 00–70, EXPERIENCE_DIRECTION) already describes a premium, controlled product and the console already meets most of the brief (command-center home, lifecycle strip, attention queue, empty states, skeletons, three shells, one icon set, tokens, Indian money). The material gap was the **theatre**: the signature moments the canon specifies (SOLD four beats, bid landing, player reveal, timer urgency, sound) were not built. That is what this pass built.

## 2 · Design system additions

| Area | Added |
|---|---|
| Theatre primitives (`@desiauction/ui`) | `RollingNumber`, `SoldStamp` + `HammerStrike`, `GoldDrift` — `packages/ui/src/theatre/`, 7 unit tests |
| Foundation (teammate commit `a7f366d`) | `shadow-4`, `depth-*`, `rhythm-*` tokens; `Card interactive`; `Tilt`; `Reveal` / `.da-reveal` / `.da-stagger`; one Lucide-grid icon set; synthesised `soundEngine` + `useSoundPreference` |
| Gallery | `TheatreDemo` section on `/gallery` (dev only), so the axe frame-sampling scan covers the stamp and the roll |
| Docs | doc 11 "The theatre, as built"; doc 19 component table; this folder |

## 3 · Component architecture

```
AuctionSnapshot ─► useAuctionSocket ─► deriveCeremony ─► CeremonyState {phase, key}
                                              ├─ CeremonyStage   (SoldStamp · GoldDrift · reveal · four beats)
                                              ├─ LotHero         (RollingNumber · pulse · reveal · CountdownRing tiers)
                                              ├─ useCeremonySound (cues per key; warning at 10 s)
                                              ├─ AuctionAnnouncer (aria-live, unchanged)
                                              ├─ OverlayPanel    (GoldDrift replaces confetti)
                                              └─ BoardPanel      (sound + floating switch)
Landing HeroStage ─► same RollingNumber · SoldStamp · GoldDrift · Tilt
```

Nothing decides in the UI; every surface remains presentation over the read-only snapshot. No API, schema, permission or routing change.

## 4 · Screen-by-screen

| Screen | Change |
|---|---|
| `/` hero | The duel: three fictional franchises call in turn, the price rolls digit by digit, the calling paddle lights, the gavel strikes and gold SOLD lands; pointer tilt with glare on fine pointers; SSR still the truthful SOLD frame; "Simulated demo" label unchanged |
| `/auction/live` (bidder) | Rolling bid, frame pulse per bid, leader chip arrival, per-lot reveal, timer tiers, ceremony four beats, sound switch in the strip |
| `/auction/cockpit` | Same ceremony + sound (opt-in); founder's WIP in the file preserved, one additive line |
| `/auction/spectate` (+ Big screen) | Ceremony four beats; stage-size stamp in fullscreen; drift climbs 92 vh; sound switch |
| `/auction/board` | Sound cues + floated switch |
| `/auction/overlay` (OBS) | Drift replaces confetti; no switch by design |
| `/gallery` | Theatre demo |

## 5 · Animation system

Doc 11 as amended. Registers: micro (tokens), standard (`Card interactive`, `Reveal`, stagger), premium (bid landing, reveal, timer tiers, anti-snipe refill), ceremony (SOLD 1800 ms, UNSOLD 400 ms). Invariants held: text never animates opacity or colour; every duration ≤ 2 s names a token (`pnpm check:motion` green; the drift's 2600 ms rise carries a `motion-ok:` reason); reduced motion removes decoration and renders the same information at rest.

## 6 · Auction state model

Unchanged and already explicit: `deriveCeremony()` → `idle · opening · bid · extension · hold · sold · unsold · withdrawn · reopened · paused · recovered · completed`, keyed per moment. The theatre keys on `ceremony.key`; no scattered booleans were added.

## 7 · Sound system

Six synthesised cues (no files), off by default, unlocked inside the switch's click, device-local. `useCeremonySound` maps ceremony phases to cues, plays `warning` at 10 s once per lot (again after an extension), never plays for UNSOLD, and swallows the moment a surface arrives on.

## 8 · 3D strategy

CSS only: `Tilt` (≤ 4° on the landing stage, fine pointers), `perspective` on the hammer price arrival and the stamp, floodlight beams for depth. No WebGL; nothing here justifies a scene graph on a phone in a hall.

## 9 · Responsive

No new layout modes: the ceremony keeps its measured fixed-height contract (CLS), the ring keeps its 96 px phone size, the paddle ladder is a grid with ellipsis so 320 px fits, the stamp only takes the bid row's free end. `responsive.spec.ts` in the run below.

## 10 · Accessibility

Stamps are real text (SOLD/UNSOLD in the DOM); `RollingNumber.textContent` equals the figure; hammer, drift and glow are `aria-hidden`; announcer regions untouched; contrast pairs are the pinned ones (`--text-on-accent` on gold, `--text-accent` for the "Sold to" kicker); reduced motion parity for every new animation.

## 11 · Performance

No new dependencies, no images, no audio files. Rolling digits write no React state per frame; the pulse and the drift are keyed remounts of tiny decorative nodes; drift motes are 12–32 elements for ~2.6 s per SOLD. The landing stage gained one `Tilt` listener (rAF-coalesced, fine pointers only).

## 12 · Implementation summary

See `git diff a7f366d` on this branch. Files: `packages/ui/src/theatre/*`, `packages/ui/src/index.ts`, auction kit (`ceremony-stage`, `lot-hero`, `auction.css`, `use-ceremony-sound`, `status-ribbon`, `live-panel`, `spectate-panel`, `board-panel` + css, `overlay-panel` + css, `cockpit-panel` one line), `components/marketing/hero-stage.tsx`, `app/marketing.css`, `app/gallery/{page,theatre-demo,gallery.css}`, docs 11/19, this folder.

## 13 · Verification

All on this branch, against a precompiled production build (`NEXT_DIST_DIR=.next-e2e`, `PLAYWRIGHT_PRECOMPILED=1`) with the engine on :4000 and the local Postgres on :5436.

| Gate | Result |
|---|---|
| `pnpm typecheck` | 11/11 tasks green |
| `pnpm lint` (web + ui) | 0 errors, 0 warnings |
| `pnpm test` (turbo) | ui 125/125 (7 new theatre tests), core 606, engine 36, settlement 89, finops 91, contracts 2 |
| `pnpm format:check` | clean |
| `pnpm depcruise` | no violations (1246 modules) |
| `pnpm check:motion` | every interaction duration names a rung (the drift's 2600 ms rise carries its `motion-ok:` reason) |
| e2e `auction-experience` (full night incl. ceremony, a11y + small screens) | 2/2 |
| e2e `live-auction` (organizer + 3 bidders, anti-snipe, engine restart, convergence) | 1/1 |
| e2e `conduct-ceremony` (committed spec: cockpit, hold-to-gavel, SOLD, undo, ledger, replay, recovery, spectator) | 1/1 in 1.0 min |
| e2e `public-experience` (incl. axe, 360 px no-scroll) | 6/6 |
| e2e `responsive` (320–1920) | 10/10 (re-run green on the final build with the phone hero fix, with `live-auction` and `auction-experience`) |
| e2e `shell` (incl. axe on /home and /help) | 5/5 |

One failure observed and explained: the founder's **uncommitted** addition to `conduct-ceremony.spec.ts` waits for `.lot-hero-name` on the cockpit page, which renders the ceremony stage and never a lot hero, so it times out at 5 min regardless of this pass. The committed spec passes against this build.

Runtime proof (`scripts/ui-audit-live.ts` + a frame-capture script on the staged `demo-premier-league` auction):

- The ceremony stage held its measured height in every phase: 420 px on desktop (`opening`, `sold`), 460 px at 390 px (`sold`) — no layout shift added by the stamp or the facts.
- SOLD frames at 120 / 500 / 1000 / 1900 ms show the gold flash, the hammer + stamp landing, the price and "Sold to" arriving, and the settled frame.
- The ring shows `warning` at ≤10 s and `critical` (danger, breathing) at ≤5 s; the rolling bid and the frame pulse render on the phone.
- Found and fixed from the phone capture: at 390 px the name column beside the face and the ring was 84 px wide and real names broke mid-word; the identity block now claims the row and the ring steps down to its own line on narrow phones.
- `/spectate` for the demo season redirects to sign-in because the season is unpublished — pre-existing and by design (visibility gate); the cockpit and the bidder room were used for the desktop and phone frames.

## 14 · Remaining gaps

1. **"Try a demo auction" (brief §20).** Not built: a one-person demo cannot go live because the engine requires two claimed paddles held by different people (`auction.ts` guard). Needs an engine "rehearsal mode" that seats scripted rival paddles — a product decision, not a UI one.
2. **Command palette as ⌘K (§25).** `InlineSearch` exists in the console header; the global keybinding is a small follow-up.
3. **Analytics charts (§29).** `/home` has the money chart and KPIs; per-auction analytics (category distribution, team spend vs average) are a new read model.
4. **Accent vs gold.** `--accent` and `--ceremony-gold` share a hex, so primary buttons wear the ceremony colour. Re-tinting the accent is a canon decision (doc 08).
5. **Console list pages** (`/auction` results, `/teams`) remain single-column stacks; a tabbed results page would touch many e2e handles and was deferred.
6. **Player photography** stays consent-gated (DPDP §5); the theatre shows the branded monogram when no photo exists, which is correct but less cinematic.

## 15 · Recommended next improvements

1. Rehearsal mode in the engine, then the zero-friction "Start free demo" flow over it.
2. ⌘K on `InlineSearch`; notifications drawer from the bell.
3. A champion ceremony (`SoldStamp label="CHAMPIONS"` already exists) on the standings page when a season's final fixture is recorded.
4. Auction analytics read model + `/auction/analytics` over `dataviz` conventions.
5. Results page as tabs (Lots · Squads · Ledger · Replay) once the e2e handles are migrated.
