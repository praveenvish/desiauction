# 38 — Domain Model

> Canon: C-3, C-9, C-13 · v1.0 · 2026-07-11

> **Amendment · 2026-08-31 · PI-1 (player identity programme).** The "person ≠
> participation" principle gains its missing person-level half:
> `player_profiles` (1:1 `people`, migration 0036) holds the durable cricket
> identity — gender, DOB, location, playing defaults — as the SOURCE OF
> DEFAULTS; each registration remains the immutable per-season snapshot, so a
> profile edit never rewrites history. `competitions.entry_category`
> (0038) declares who a season is for; core's `eligibility.ts` is the single
> evaluator (self-serve blocks a declared opposite, organizer channels get
> advisories — invariant 5 holds). `franchises` (0039) applies this file's own
> tournaments pattern to teams: durable name, editions' team rows point at it,
> linked by the clone path, grouping only. Career history is a PROJECTION
> (`server/player/career.ts`, `/me/cricket`) over registrations × teams ×
> tournaments × lots — never a table, so it cannot drift from the certified
> writers. The H3 consent boundary stands: cross-org history renders publicly
> only as same-org "also played in" entries, each covered by its own season's
> publication consent.

## Principles

1. **Person ≠ participation** (carried, PAS): a human identity is one record; their appearances (registration here, ownership there) are separate participation records. Identity is never duplicated per tournament (invariant 3).
2. **Ledger-derived money** (C-9): squads, spend, purse remaining are *projections* of purchase events — no editable columns for derived money (invariant 11). The reference schema's `budgetSpent` column-with-increments is exactly what we refuse.
3. **Tenant-rooted**: every row traces to one Organization (invariant 1; C-13 RLS).

## Entity map

```
Organization ─┬─ Grant ──────────── Person ── User(auth)
              ├─ Tournament ─┬─ Pass (entitlement)
              │              ├─ AuctionConfig
              │              ├─ Registration ── Person
              │              ├─ PoolEntry (lot definition) ── Person
              │              ├─ Team ─┬─ Ownership(Grant-linked)
              │              │        └─ (squad = projection)
              │              ├─ Auction ─┬─ AuctionEvent (ledger)
              │              │           ├─ Lot (projection over PoolEntry)
              │              │           ├─ Bid (projection)
              │              │           └─ Purchase (projection)
              │              ├─ AccessToken
              │              └─ [H2: Venue Ground Fixture Match Result Standing]
              ├─ Invoice ── Payment
              ├─ AuditEvent (append-only, org-wide)
              ├─ NotificationRecord / WebhookEndpoint / WebhookDelivery
              └─ ImportJob / ExportJob
```

## Core entities

| Entity | Key facts |
|--------|-----------|
| **Organization** | Tenant root; slug; ≥1 owner always (invariant 2) |
| **Person** | A human: name, mobile (unique, verified — the identity key in this market), photo. Erasure pseudonymizes, never destroys money facts (invariant 4) |
| **User** | Auth identity (OTP/passkey credentials, sessions) → exactly one Person |
| **Grant** | (person, scope, capability set) — 36 |
| **Tournament** | The product's stage: identity, location, dates, visibility, branding, slug; lifecycle per 39; holds exactly one Auction in V1 |
| **Pass** | The tournament's entitlement instance: tier, limits snapshot, activation, invoice link (45) |
| **AuctionConfig** | Purse, squad min/max, increment slabs, role quotas, timer settings, unsold policy (41); **locked** at readiness gate, changes thereafter only by audited override (invariant 16) |
| **Registration** | A Person's application to a tournament: form data, role, base-price band, verification + approval state (42) |
| **PoolEntry** | An approved player's auction presence: base price, round, order, marquee flag |
| **Auction** | The event: state (39), current lot pointer, `seq` head |
| **AuctionEvent** | **The ledger** (C-9): append-only, per-auction monotonic `seq`, typed payloads (51). Bids, lot transitions, purchases, overrides, pauses — all are events |
| **Lot / Bid / Purchase** | Projections of the ledger into query-friendly tables (52); a Purchase references its winning Bid event (invariant 11) |
| **Team** | Name, branding; purse defined by config (per-team purse variation is a V1.5 flag); squad/spend are projections |
| **Ownership** | The accepted `team:bid` grant + acceptance record (43) |
| **AccessToken** | view/registration/invite (36) |
| **Invoice/Payment** | Immutable commercial records (46, invariant 24) |
| **AuditEvent** | Org-wide append-only audit (48); auction ledger events are auto-mirrored as audit facts |
| **ImportJob/ExportJob** | Async artifacts with provenance (invariant 33) |

## Relationship rules

- Registration → PoolEntry is one-way (approval creates the pool entry; rejection never does); a PoolEntry can also arrive by direct add or pre-assignment (icon players, 41), always via the same human gate (invariant 5).
- A Person may hold Registration + Ownership in the same tournament (owner-player is real at this scale) — but conflict rules apply at auction time (43).
- Teams belong to one tournament; recurring "franchise" identity across seasons is H2 (Season lens) — V1 refuses premature abstraction.
- Nothing references across organizations, ever (invariant 1). Person identities are global (one human, one record) but *participations* are org-scoped; cross-org visibility of a person's history requires that person's consent (H3, DPDP).

## Identity & dedup (the hard problem, designed for day one)

Mobile number is the practical identity key (C-24). Registration dedups by verified mobile per tournament (behavioral carry); cross-tournament, the Person record links participations. A **merge tool** (Console, `org:manage`) resolves duplicate Persons with full audit; merges are append-only re-links, never row deletion (invariant 4 spirit).
