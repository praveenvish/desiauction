# 11 — Motion System

> Canon: C-4, C-15 · v1.0 · 2026-07-11

## Philosophy

Motion confirms; it never entertains — except at the two earned ceremonies (C-5). On live surfaces motion is how truth arrives (a new bid *lands*), so it must be fast, physical, and consistent enough that regulars stop noticing it.

## Tokens

| Token | Value | Use |
|-------|-------|-----|
| duration-instant | 80ms | Hover/pressed feedback |
| duration-fast | 120ms | Toggles, chips, small fades |
| duration-base | 200ms | Most transitions: popovers, tab switches |
| duration-slow | 320ms | Panels, drawers, page-level |
| duration-ceremony | 1800ms | SOLD choreography total |
| ease-out | cubic-bezier(0.16, 1, 0.3, 1) | Entrances (fast start, soft landing) |
| ease-in | cubic-bezier(0.7, 0, 0.84, 0) | Exits |
| ease-spring | spring(1, 170, 24) | Bid landing, counters, ceremony elements |

Rules: entrances `ease-out`, exits `ease-in`, nothing animates longer than `duration-slow` outside ceremonies; no infinite looping animation except the LIVE pulse and skeletons (23).

## Signature choreographies

### Bid landing (all live surfaces)

New bid arrives → amount ticks up with a spring counter (digits roll, 200ms), leading team chip slides to top (`duration-base`), a 1px volt pulse sweeps the lot frame once (120ms). Total < 400ms; never queues — a newer bid interrupts and supersedes.

### Timer behavior

The TimerRing (19) depletes continuously. Anti-snipe extension (41): the ring **refills smoothly over 300ms** — it visibly grows, communicating "the bid bought time" without alarm. Under 10s: ring shifts to warning color and pulse-breathes at 1Hz. The timer never blinks frantically (invariant 31 — no manufactured panic).

### The SOLD ceremony (the product's signature, C-5)

Total 1800ms, synchronized across surfaces by the `lot.sold` event (51):

1. **0–150ms — the freeze.** All secondary UI dims 20%; the lot card is alone in the light.
2. **150–600ms — the stamp.** Gold "SOLD" stamps onto the lot with a spring scale (1.15 → 1.0), one soft radial gold flash behind the player name.
3. **600–1400ms — the facts.** Price and buying team roll in (spring counters); on Stage, gold particle drift rises slowly behind (never confetti physics — drift, like stadium lights on smoke).
4. **1400–1800ms — the settle.** Gold recedes to a thin frame; receipt confirmation appears in Owner Room; next-lot preview breathes in.

UNSOLD, by contrast: 400ms total — neutral ink stamp, brisk fade, immediate next lot (C-23, dignified brevity).

### Reconnection (Owner Room / Cockpit)

On resync after a gap: the surface shows "Catching up…" and new events replay compressed (max 600ms total, batched — never a fake replay of every bid), landing on current truth with a single confirmation pulse. Emotional beat 2 (04) depends on this feeling *certain*, not theatrical.

## Foundation primitives (2026-09-13)

| Primitive | What it is | Rules |
|-----------|-----------|-------|
| `Card interactive` | The one hover/active/focus set for a card that is a target | Transform + shadow only; no lift on `(hover: none)` |
| `Tilt` | Pointer-tracked depth (≤ `depth-tilt`), optional glare and lift | Fine pointers only; inert on touch and under reduced motion; no React state per move |
| `Reveal` / `.da-reveal` | Scroll-linked entrance for below-the-fold content, staggered by `--reveal-index` | `view()` timeline, `backwards` fill, **transform only** — text never animates opacity (the contrast scans sample every frame) |
| `.da-stagger` | First-paint settle for children already on screen, 60ms apart within `duration-slow` | Transform only; reduced motion → none |

### Sound (foundation)

Sound is a room feature, not a phone feature. The engine (`@desiauction/ui` `soundEngine`) synthesises every cue — no audio files — and is inert until a real gesture unlocks it (`useSoundPreference().setEnabled(true)` inside the click). The choice is device-local (`da-sound`), off by default. Cues: `opening`, `bid`, `extension`, `warning`, `sold`, `complete`. **UNSOLD has no cue** (C-23). Defaults per surface are decided where the surface is built: board and stage-mode on, cockpit and overlay opt-in, phones opt-in.

## The theatre, as built (PREMIUM-1 · 2026-09-13)

Three primitives in `@desiauction/ui` (`packages/ui/src/theatre/`) carry the signature choreographies, so the landing demo, the cockpit, the big screen, the bidder's phone and the OBS overlay all play the identical moment:

| Primitive | What it does | Rules |
|-----------|-------------|-------|
| `RollingNumber` | A figure whose changed digits roll in from below (odometer); unchanged digits stay still | `textContent` is exactly the figure (the outgoing digit is a `::before`); transform only; no motion on first paint; reduced motion jumps |
| `SoldStamp` (+ `HammerStrike`) | Beat two: the gavel strikes on the slow rung, gold SOLD lands with a spring on the emphatic rung; `tone="unsold"` is neutral ink with a brisk settle and no hammer (C-23) | Whole element scales — the word is at full contrast from frame one; flash is shadow-only |
| `GoldDrift` | Beat three's atmosphere: deterministic gold motes rising ("stadium lights on smoke", never confetti physics) | aria-hidden; `--drift-height` sets the climb; removed under reduced motion |

The SOLD ceremony on `CeremonyStage` is now timed to the table above with tokens only: freeze (`ceremony-glow`, the face leans in), stamp (`SoldStamp` in the title's place), facts (name settles at `base`, price at `emphatic`, "Sold to · team" at `dramatic`), settle (`ceremony-settle`, shadow-only, at `ceremony − emphatic`). UNSOLD renders the neutral stamp and nothing else moves.

Bid landing on `LotHero`: the digits roll, a keyed `.lot-hero-pulse` sweeps the frame once per bid id (shadow only), and the leader chip steps in on a change of hands. A new lot is keyed on its id and reveals face → kicker → name → meta → clock → money, 60 ms apart. The `CountdownRing` has tiers: `warning` under 10 s (warning colour, breathes at `duration-pulse`), `critical` under 5 s (danger, breathes at `duration-dramatic`); the number never scales. An anti-snipe extension refills the ring on the slow rung.

Sound is wired: `useCeremonySound` (apps/web, auction kit) plays the cue for each ceremony key change (`opening · bid · extension · sold · complete`, never unsold), the ten-second `warning` once per lot (again after an extension), and swallows the first moment a surface arrives on. The switch rides in the Live shell's status strip (live, cockpit, spectate) and floats on `/board`; `/overlay` has none by design.

## Reduced motion (C-15)

`prefers-reduced-motion`: all movement replaced by opacity crossfades ≤ 120ms; counters jump to final value; ceremonies become a static gold frame + text change (the *information* of ceremony, none of the motion); timer ring becomes a numeric countdown only. Parity is a release gate (69), not a nice-to-have.

## Performance

Animate only `transform` and `opacity` (compositor-only); no layout-triggering animation on live surfaces; ceremonies budgeted ≤ 5% CPU on a 2019 mid-range Android (57).
