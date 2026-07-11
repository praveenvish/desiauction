# 51 — Event Architecture

> Canon: C-3, C-9, C-14 · v1.0 · 2026-07-11

## Three event planes (never confused)

| Plane | Truth level | Consumers |
|-------|------------|-----------|
| **Ledger events** (domain) | The truth (C-9) | Engine projections, surfaces, audit |
| **Integration events** (webhooks) | Derived, after-commit | External systems |
| **Analytics events** | Observational | Product metrics (56); never business logic |

## The ledger

- Per-auction append-only stream; **`seq` is a per-auction monotonic integer** assigned by the single writer (C-9) — the total order of the auction's truth.
- Event taxonomy (shared naming with audit, 48): `auction.started/paused/resumed/completed`, `lot.opened/closed_sold/closed_unsold/requeued/frozen/reopened`, `bid.placed`, `purchase.recorded/reversed`, `config.overridden`…
- Envelope: `{ auctionId, seq, id: ulid, type, occurredAt, actor{...}, payload, schemaVersion }` — zod-schema'd in `packages/contracts`; versioned payloads with upcasting (old events replay forever, 61).
- Storage: `auction_events` table (52), unique `(auction_id, seq)`; projections (lots, bids, purchases, purse read models) updated transactionally with the append — **projection lag is zero within an auction** (invariant 12 needs this).

## Realtime protocol (surfaces ← engine)

- Transports: WebSocket (engine-served) for authenticated live surfaces; **SSE fallback** for public Stage and hostile networks (C-3 continuity behaviour carried).
- Wire frames: `event {seq,…}` | `snapshot {seq, full-state}` | `heartbeat {seq-head, server-time}`.
- **Gap protocol** (04 beat 2's mechanism): clients track `seq`; on gap detection (received seq > expected) → request catch-up (`from_seq`); large gaps → snapshot + replay. Reconnect always: snapshot first, then live. Staleness UX per 23; clock drift corrected from heartbeat `server-time` (timers render truthfully, 41).
- Subscriptions are read-model-scoped and grant-filtered at the engine (an Owner Room stream includes own-team purse detail; a public stream is the redacted projection — invariant 35 enforced at stream construction).

## Webhooks (public plane)

- Endpoints registered per org (API or Console), capability-bound; events: `lot.sold`, `auction.completed`, `registration.approved`, `payment.captured`… (public subset only; nothing PII-bearing beyond documented fields, invariant 8).
- Delivery: **after commit only** (never on rollback — carried behaviour); HMAC-SHA256 signature + timestamp header; retries with exponential backoff (5 attempts / 24h) → dead-letter visible in Console; per-delivery log (WebhookDelivery, 38).
- Consumers get `seq` in auction events — external systems can order and de-duplicate exactly as our surfaces do.

## Analytics plane

Typed product events (`registration_submitted`, `ceremony_rendered`, …) from `packages/contracts/analytics`; PII-free by schema; batched client → collector; used for the metrics in 56 and nothing operational. AI features read *read models*, never raw analytics (35).

## Design consequences (why this doc earns its place)

The event architecture **is** the trust architecture: seq answers "which truth am I seeing" (LiveBadge, invariant 12), the after-commit rule answers "was it real" (invariant 13), the append-only rule answers "was it tampered" (invariant 10), and replay answers "can we recover" (61). One mechanism, four guarantees.
