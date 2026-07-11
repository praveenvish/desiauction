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

## Reduced motion (C-15)

`prefers-reduced-motion`: all movement replaced by opacity crossfades ≤ 120ms; counters jump to final value; ceremonies become a static gold frame + text change (the *information* of ceremony, none of the motion); timer ring becomes a numeric countdown only. Parity is a release gate (69), not a nice-to-have.

## Performance

Animate only `transform` and `opacity` (compositor-only); no layout-triggering animation on live surfaces; ceremonies budgeted ≤ 5% CPU on a 2019 mid-range Android (57).
