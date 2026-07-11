# 25 — Success States

> Canon: C-5, C-23 · v1.0 · 2026-07-11

## The confirmation ladder

Success feedback is proportional to consequence. Four tiers, and every mutation is assigned one in its spec (69):

| Tier | Feedback | Examples |
|------|----------|----------|
| **T0 — Silent** | The world visibly changed; nothing else | Filter applied, view toggled, draft autosaved (subtle "Saved" wisp, 29) |
| **T1 — Inline settle** | Control/row settles with a brief success tick (120ms) | Row edited, setting toggled |
| **T2 — Confirmed** | Toast with fact + optional action (27), or inline block for in-flow steps | Player approved ("{name} is in the pool" + View), export ready |
| **T3 — Ceremony** | Choreographed moment (11), gold, cross-surface sync | Lot SOLD, champion crowned — **the only two T3s in the product** (C-5) |

Rule: **one success signal per action.** A toast *or* an inline settle *or* a ceremony — never stacked. The bid's success signal is the room's bid-landing animation itself (15); adding a toast would double-announce.

## Receipts, not applause

For money and people-decisions, success = **a durable artifact**, not a compliment:

- SOLD → receipt in Owner Room within 10s (04 beat 3), receipt row in Console ledger, WhatsApp receipt (47).
- Approval → the player appears in the pool with an audit entry; the player is notified (42).
- Pass purchase → immutable invoice (C-18) + entitlement visibly active on the tournament header.

The pattern: the success state *is* the record the user could show a third party. Applause fades; receipts settle disputes.

## Completion moments

- **Auction complete (the organizer's exhale, 04 beat 5):** not a ceremony — a calm summary: "{n} players sold · ₹{total} · {teams} squads final", with everything already done (receipts issued, results live, exports ready). The absence of remaining work is the reward; the screen says so plainly.
- Wizard/setup completions: T2 inline block with "what's now possible" (next phase affordance, 44), never confetti — gold is earned (C-5), and setup isn't the earning.

## Anti-patterns

- Celebration inflation: T3 outside the two sanctioned moments.
- "Successfully" (20 rule 5), success modals for routine actions, success states that block the next action.
- Fake progress (a success shown before durable commit) — forbidden on money by invariant 13, and in spirit everywhere.
