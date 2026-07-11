# 23 — Loading States

> Canon: C-9, C-17 · v1.0 · 2026-07-11

## Doctrine

Loading is a truth-communication problem: the user must always know **what they're looking at and how fresh it is**. Spinners hide truth; skeletons and staleness labels state it.

## Console rules

- **Skeletons, not spinners**, for content areas: skeletons mirror the real layout (table skeleton has the table's columns), shimmer subtly (the one sanctioned loop besides LIVE pulse, 11), and never shift layout on resolve (CLS budget, 57).
- Scoped busy states for actions (spinner-in-button, 15); full-page spinners are banned.
- Progressive reveal: page chrome and headers render immediately (server-rendered), data wells skeleton — the user is never staring at a blank viewport (57: first paint budgets).
- Anything expected > 2s (imports, exports, bulk ops) becomes a background job with progress surfaced in the notification tray (26, 53) — the UI never hostages a tab to a long task.

## Live-surface rules (the important ones)

Live surfaces **never skeleton mid-session** — a Stage that blanks during a bid war destroys the room's trust. Instead:

| State | Behavior |
|-------|----------|
| Initial join | One branded loading beat (beam sweep, ≤ 1.5s budget) → full current state (snapshot, 51) |
| Stream healthy | `LiveBadge`: "Live" with volt pulse |
| Gap detected | Content **stays rendered**; badge: "Catching up…"; resync via snapshot+replay (51); compressed catch-up animation ≤ 600ms (11) |
| Stale (no events, connection suspect) | Badge: "Reconnecting — showing as of {time} (event {seq})" — content dims 10%, never blanks |
| Offline | Banner (21 connection strings); reassurance that server truth is safe; auto-retry with backoff |

The `seq` chip (19) is the honesty mechanism: any surface can prove *which* truth it's showing (invariant 12).

## Perceived-performance rules

- < 100ms: render nothing intermediate (flash prevention: skeletons appear only after 150ms delay, minimum display 300ms — no skeleton-blink).
- Optimistic UI only for the sanctioned mutation class (15); money never renders optimistically (C-9).
- Prefetch on intent: hover/focus on Console links prefetches routes and peek data (respecting data budgets on mobile, 57).
- Timers: `endsAt` is server truth (41); clients render countdown locally from a drift-corrected clock (51) — a timer never "loads."
