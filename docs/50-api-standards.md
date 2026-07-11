# 50 — API Standards

> Canon: C-14 · v1.0 · 2026-07-11

## Two API planes (C-14)

- **Internal RPC (tRPC)** — first-party apps only: end-to-end types from `packages/contracts`, colocated with the web app. Not a compatibility surface; changes freely with the monorepo.
- **Public REST `/v1`** — the enterprise/interop contract (D-007 openness): OpenAPI-described, versioned, stable. Everything an organizer can export or integrate lives here eventually; V1 ships read APIs (tournaments, results, ledger) + webhook management.

One rule binds both: **handlers are thin adapters over `packages/core`** — no business logic in transport layers. The same command/query functions serve both planes (and the engine), so the planes cannot drift.

## REST conventions

- Resources: plural nouns, ULIDs, org-scoped paths: `/v1/orgs/{org}/tournaments/{id}/ledger`.
- Methods: GET (safe), POST (create/commands), PATCH (partial update), DELETE (where the domain allows — rarely, 44). Commands that aren't CRUD are explicit subresources: `POST …/auction/commands/pause` (honest RPC beats fake REST).
- Pagination: cursor-based (`cursor`, `limit≤100`, `next_cursor`); stable order by (created_at, id).
- Filtering: documented query params per resource; no generic query language in V1.
- Timestamps ISO-8601 UTC; money as `{ amount_paise: int, display: "₹1.2 L" }` (C-7 — integer truth + preformatted courtesy).

## Errors: RFC 9457 problem+json

```json
{ "type": "https://api.desiauction.in/errors/bid-below-current",
  "title": "Bid below current",
  "status": 422, "code": "BELOW_CURRENT",
  "detail": "Next valid bid is ₹95,000",
  "ref": "7XK2-D4", "errors": [ {field-level items} ] }
```

Machine `code` values are a stable contract (the same codes the UI maps to copy, 21/41); `ref` correlates to traces (55). 4xx = caller can fix; 5xx = ours; 409 for state-machine conflicts (39); 429 with `Retry-After`.

## Idempotency (mandatory on money-adjacent POSTs)

`Idempotency-Key` header (client ULID): server stores key→response for 24h; replays return the original result. Bids, purchases, payments, pass activation, notification sends. This is what makes retry-on-error UX honest (24).

## Versioning & change policy

- Path major version (`/v1`); additive changes (new fields/endpoints) are non-breaking and continuous; breaking changes require `/v2` with ≥ 12 months `/v1` overlap and deprecation headers (`Sunset`).
- The OpenAPI document is generated from the zod contracts (single source, 29) and published; SDK generation from it (H3).

## Auth

- First-party: session cookies (49).
- Public API: org-scoped API keys (`da_live_…`), hashed at rest, capability-bound (a key holds grants like any actor, C-8), rotatable, last-used visible; per-key rate limits with headers (`RateLimit-*`).

## Realtime & webhooks

Realtime protocol (WebSocket/SSE event frames, snapshot/catchup) and webhook delivery contract (HMAC, retries, event envelope) are specified in 51-event-architecture; API keys and webhook endpoints share the grants model.
