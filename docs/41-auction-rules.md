# 41 — Auction Rules

> Canon: C-7, C-9 · v1.0 · 2026-07-11
> Behavioural source: reference engine (bid validation order, anti-snipe, close semantics) — carried and extended. Rules here are the **engine specification**; `packages/core` implements them as pure functions.

## Configuration (AuctionConfig)

| Setting | Type | Notes |
|---------|------|-------|
| `pursePerTeam` | paise | Uniform in V1 (per-team variation flagged V1.5) |
| `squadMin` / `squadMax` | int | Reserve rule + fullness rule below |
| `incrementMode` | `flat` \| `slabs` | Flat carries reference behaviour; **slabs are the default**: e.g., +₹5,000 below ₹1 L; +₹10,000 to ₹5 L; +₹25,000 above — IPL-familiar, configurable bands |
| `roleQuotas` | per-role min/max | e.g., max 4 overseas, min 1 wicket-keeper |
| `timerInitial` | seconds (default 30) | Per-lot countdown |
| `timerExtension` | seconds (default 15) | Anti-snipe |
| `unsoldPolicy` | `requeue(nRounds)` \| `final` | Unsold lots return in later rounds (default 2 rounds) |
| `basePriceBands` | named bands → paise | Registration picks a band; pool assigns exact base |
| `preAssignments` | list | Icon/captain players placed before bidding, at declared prices, purse-deducted (invariant 11's "explicit pre-assignment") |
| `moneyVisibility` | `full` \| `redacted` | Public purse redaction (invariant 35) |

Config **locks** at `AuctionReady` (39); post-lock changes are audited overrides only (invariant 16).

## Bid validation (the ordered gauntlet)

Executed by the engine, in order, first failure returns its code (21 maps codes to copy):

1. Auction is `Live`, lot is `OnBlock`/`ClosingSoon` (`LOT_NOT_OPEN`)
2. Actor holds `team:bid` for a team in this auction (`NOT_AUTHORIZED`)
3. Team is not already leading (`ALREADY_LEADING` — self-outbidding is refused; UI prevents it too)
4. Amount is a valid integer > 0 (`INVALID_AMOUNT`)
5. Amount ≥ base price (`BELOW_BASE`)
6. Amount > current bid (`BELOW_CURRENT`)
7. Amount lands on the increment ladder for its slab (`INVALID_INCREMENT`) — clients snap before sending (15), the engine still enforces
8. Amount ≤ remaining purse (`BUDGET_EXCEEDED`)
9. **Reserve rule:** amount must leave purse ≥ (required remaining players × minimum possible price) (`RESERVE_VIOLATION`) — a team must always be able to complete `squadMin`
10. Squad not full (`SQUAD_FULL`)
11. Role quota not exceeded for this player's role (`ROLE_LIMIT`)

Accepted → `bid.placed` event appended (seq assigned), broadcast, timer extended per below. **Single-writer per auction** (C-9) makes the read-validate-append sequence race-free by construction — no distributed locks (the reference needed Redis locks because serverless handlers raced; we removed the race instead).

## Timer & anti-snipe

- `endsAt` is engine truth, broadcast absolute (clients render drift-corrected countdowns, 51).
- On each accepted bid: `endsAt := max(endsAt, now + timerExtension)` — **the timer never shrinks** (invariant 14; also never extends beyond `now + timerInitial`).
- Expiry closes the lot in-engine. A durable watchdog (53) re-checks from persisted state if the engine restarts — the same idempotent close, exactly-once by seq.

## Close semantics

Atomic (ledger append + projections in one transaction):

- **With leading bid →** `lot.sold` + `purchase.recorded` (references winning bid event, invariant 11); purse projection updates; ceremony broadcasts only after commit (invariant 13); receipt issued (25); webhook after commit (51).
- **No bids →** `lot.unsold`: requeue per `unsoldPolicy` (`lot.requeued`, later round, possibly reduced base — configurable) or final. Dignity grammar throughout (C-23).
- **Cannot determine outcome** (e.g., conflicting recovery state) → `lot.frozen` (invariant 17): held for Cockpit resolution; the auction may proceed to the next lot (invariant 19 — one frozen lot never blocks the night).

## Conduct actions (Cockpit)

`auction.start / pause / resume / complete`, `lot.open` (order control, skip/bring-forward), `lot.close` (gavel — hold gesture, 15), `lot.reopen` (undo). All capability-checked (36), all ledger events, all audited.

**Undo (`lot.reopen`)** — the highest-friction action (28 ladder 4): allowed until the next lot opens; appends compensating events (purchase reversal, purse restoration) — never deletes (invariant 10); reopened lot returns to `OnBlock` with prior bids voided-but-visible in history; requires `tournament:override`.

## Manual conduct mode (degraded/hall-auction mode)

The auctioneer can run lots with **proxy bids** ("Titans, ₹90,000" called in the room, entered by the operator): same validation gauntlet, actor recorded as operator-on-behalf-of-team, visually distinct in ledger. This is the honest fallback when owners aren't on devices (or connectivity dies — invariant 19), not a second engine: same events, same rules, same receipts.

## Fairness rules

- Bids are processed in arrival order at the engine (single writer = total order, the `seq` is the proof); no priority lanes.
- The engine's clock is the only clock; client timestamps are never trusted.
- Every rejection is logged with its code (56 observability) — patterns of rejection (e.g., increments confusing a room) are product signals.
