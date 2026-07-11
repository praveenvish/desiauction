# 04 — Product Philosophy

> Canon: C-2, C-3, C-23 · v1.0 · 2026-07-11

## Trust as physics

Most software earns trust with promises: banners, badges, assurances. DesiAuction earns it with **physics** — properties that hold because violating states are unrepresentable:

- A bid, once recorded, cannot be edited or deleted by anyone, including us (invariant 10).
- Squads and spend are *derived* from purchases; there is no edit path to fake them (invariant 11).
- SOLD renders only after the purchase is durably committed — no celebration before commitment (invariant 13).
- Every screen is the same event stream; two screens cannot disagree about money (invariant 12).

The user doesn't have to believe us. They can watch three screens agree in real time. **Trust is an architectural property first and a feeling second.**

## The ledger principle

The auction is a financial event, so it is modeled as a **ledger** (C-9): append-only events, monotonic sequence, derived views. History is never rewritten; corrections are new, visible entries. This single idea generates the audit trail, the realtime protocol, the recovery story, and the dispute-proofing — they are the same mechanism seen from four angles.

## The five emotional beats

These are protected product requirements. A release that damages one is a failed release, whatever else it ships.

1. **The player hears their name.** The lot moment renders the player large, correct, and proud — name pronounced by a human, held by the screen. Never a row in a table.
2. **The owner's reconnection trust.** An owner whose phone drops and returns must *know* within two seconds that what they see is current truth (seq catch-up, 51-event-architecture) — because money decisions ride on it.
3. **The ten-second receipt.** Within ten seconds of SOLD, the buying owner holds a durable receipt: player, price, purse remaining. The transaction *feels* filed.
4. **Unsold dignity.** The unsold moment passes quickly, neutrally, without sound or color of failure, and the player may return in a later round. No public unsold gallery exists (invariant 7).
5. **The organizer's exhale.** When the last lot closes, everything is simply… done. Squads final, receipts issued, results page live. The organizer's last act of the night is nothing.

## Calm and electric are the same system

The paradox to hold: the operator's surface (Cockpit) must be **calm** — one decision at a time, nothing competing for attention — while the public surfaces (Stage, Overlay) are **electric** — alive, kinetic, televisual. FLOODLIGHT (05) exists to resolve this: same tokens, same truth, opposite energy budgets. The calm is what makes the electricity safe.

## Occasion, not utility

A community auction happens once a year. It is somebody's big night — the product must rise to occasions, not just process transactions. This is why design quality is a strategy (02) and not a coat of paint: in a low-trust, high-emotion market, **looking exceptional and being incorruptible are the product.**

## What we refuse

- Engagement for its own sake: no streaks, no feeds, no notifications engineered to pull people back (invariant 31).
- Growth that spends user dignity (no public shaming mechanics, no unsold lists, no leaked prices).
- Complexity as a moat: progressive formality (03 §7) means the simplest case stays simple forever.
