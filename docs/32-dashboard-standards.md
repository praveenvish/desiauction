# 32 — Dashboard Standards

> Canon: C-2, C-3 · v1.0 · 2026-07-11

## Doctrine

A dashboard exists to **answer questions and route attention**, in that order. Every element must survive the interrogation: *what question does this answer, and what would the user do about the answer?* Decorative stats — numbers with no decision attached — are banned. (The reference program's ruling stands: an overview is a cockpit-of-cockpits, not a data page.)

## The two dashboards

### Console Home (org level)

Composition, top to bottom:

1. **Attention queue** (26): decisions waiting, worst first — pending registrations, unaccepted owner invites, readiness blockers, frozen money ops, expiring passes. Each item = one decision, deep-linked. When empty it says so with pride ("Nothing needs you.").
2. **Tournaments strip:** active tournaments as entity cards with phase + next milestone (44); "Create tournament" lives here.
3. **Recent outcomes** (compact): last completed auctions with the trust numbers — total spend, lots sold, zero-dispute badge (C-2).

No charts on Home in V1. Organizers run 1–5 tournaments; queues and states serve them, trend-charts flatter us.

### Tournament Overview (the phase engine's face)

1. **Phase header:** where this tournament is (39 lifecycle) + the **one singular gate** to the next phase ("2 of 3 readiness checks passing → what's blocking"). One primary CTA, always.
2. **Vitals row** (`Stat` cards, max 4, phase-appropriate): e.g., during registration — approved/pending/target pool size; post-auction — spend, sold, per-team balance.
3. **Zone cards** per aspect (registrations/pool/teams/auction) each with its state + its next action — doors, not summaries-for-reading.
4. **Live exception:** when the auction is LIVE, Overview collapses to a live status face: current lot, seq health, "Enter Cockpit" — nothing else competes (05 law 1).

## Stat card rules

- One number, one question, stated as its label ("Players approved · 41 of 60 target", never bare "41").
- Numbers tabular (C-7); deltas only where a target/baseline exists; sparklines only with ≥ 8 meaningful points — never decoration.
- A stat with a decision attached is a door (clicks through to the filtered view that proves it); dead-end stats are demoted or deleted.
- Skeletons per 23; a stat that can't load renders "—" with a retry, never a fake zero (a dashboard showing 0 registrations because the fetch failed is a lie, 24).

## Layout

12-col grid, `space-6` gaps; attention queue is full-width; vitals 4-up ≥ `bp-lg`, 2-up below; everything recomposes single-column on mobile with attention queue always first (14).
