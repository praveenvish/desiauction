# 14 — Responsive Strategy

> Canon: C-3, C-4, C-24 · v1.0 · 2026-07-11

## Reality check

This market is **phone-first**: owners bid from phones in a hall, players register from phones, spectators watch on phones. The previous product was desktop-only in production — a pilot-blocking gap. Here, mobile is a launch gate, not a stretch goal (69, 70).

## Surface-by-surface posture

| Surface | Primary device | Posture |
|---------|---------------|---------|
| **Owner Room** | Phone | **Mobile-first, designed at 360px**, one-hand operation: bid controls in thumb zone, purse always visible, no hover-dependent anything |
| **Stage** | Phone + projector | Two designed extremes: 360px portrait (spectator phone) and 1080p+ landscape (hall projector). The projector layout is its own composition, not a stretched phone view |
| **Registration** | Phone | Mobile-first single-column always |
| **Cockpit** | Laptop/desktop | Desktop-first (1280px+), operator with a real machine; degrades gracefully to tablet landscape (1024px); explicitly **not supported on phones** in V1 — it says so honestly rather than rendering a broken cockpit |
| **Console** | Laptop | Desktop-first, fully functional to 768px; read-and-approve tasks (registrations queue) fully usable on phone |
| **Overlay** | 1080p/4K fixed | Fixed compositions at 16:9; safe margins (10); no fluidity — broadcast discipline |

## Breakpoints

| Token | Min-width | Meaning |
|-------|-----------|---------|
| bp-sm | 640px | Large phone landscape / small tablet |
| bp-md | 768px | Tablet |
| bp-lg | 1024px | Small laptop, Cockpit floor |
| bp-xl | 1280px | Desktop default |
| bp-2xl | 1536px | Large desktop, projector |

Mobile (<640px) is the unprefixed default in code — styles are written up from 360px.

## Rules

- Design at extremes first: every screen designed at 360px and its largest target before interior sizes.
- No hover-only affordances anywhere (touch parity); hover is enhancement only (15).
- Layout changes between breakpoints are **recompositions** (rail → tabs, table → cards) declared per pattern in 19/30/31 — never CSS-only squeezing of a desktop layout.
- Container queries (not viewport) drive component-level adaptation (cards, tables) so components are placement-independent.
- Safe areas: `env(safe-area-inset-*)` respected on Owner Room/Stage (notches; PWA standalone).
- Test matrix in CI: 360×800, 768×1024, 1280×800, 1920×1080 screenshots on golden screens (58).

## PWA stance

Owner Room and Stage are installable PWAs (manifest + offline shell + reconnect protocol 51); native apps are explicitly out of V1 scope — the reconnection story (04 beat 2) makes the web app trustworthy on hall Wi-Fi.
