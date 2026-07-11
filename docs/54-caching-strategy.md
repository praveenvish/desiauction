# 54 — Caching Strategy

> Canon: C-9, C-12 · v1.0 · 2026-07-11

## Doctrine

Cache for **fan-out, never for truth**. The product's data is small (52); its load is thousands of eyes on one auction. Every cache layer must answer: *what staleness can this audience tolerate, and how does the cache state its freshness?* (invariant 12 disciplines all of it — a cache that can serve two surfaces different money at the same seq is forbidden).

## Layers

| Layer | What | TTL / invalidation |
|-------|------|--------------------|
| **Engine memory** | Hot auction state (the working set of a live auction) | Not a cache — the single-writer's state (C-9); persisted via ledger |
| **CDN (edge)** | Public Stage shell, results pages, media (player photos), static assets | Assets immutable-hashed (∞); results pages `s-maxage=60` + revalidate-on-publish (44); Stage shell cached, its data always live via stream |
| **Application read cache (Redis)** | Grant-filtered read-model responses for hot public endpoints (scoreboard snapshot for SSE joiners) | Keyed **with seq** (`auction:{id}:snapshot:{seq}`) — a stale key is impossible by construction, new seq = new key |
| **Client (SWR)** | Console queries | Stale-while-revalidate; mutations invalidate their query keys via the RPC layer's tags |

## Rules

- **Money is never cached without its seq in the key** (C-9). Purse, bids, squads: cache entries are point-in-time-named, so "stale" degrades to "older seq clearly labeled" (23 staleness UX), never "wrong number."
- Personalized/grant-filtered responses never hit shared caches unless the grant scope is part of the key (public-token projections are one shared scope by design, 51).
- No cache-aside hand-rolling in feature code: caching lives in the read-model layer (`packages/core` query functions declare cacheability); screens cannot invent caches (C-12 boundary discipline).
- Session/auth data: never cached beyond its store (49); OTP and rate-limit state live in Redis with strict TTLs (that's state, not cache).
- Cold-start honesty: cache misses fall through to projections (52) — always correct, occasionally slower; the system's correctness never depends on a warm cache (invariant 19 posture).

## Invalidation map (the whole list — small on purpose)

Results publish → CDN purge (tournament results path). Media replace → new hashed URL (no purge needed). Config/branding change → tournament shell revalidate. Everything live → seq-keyed, self-invalidating.

## Observability

Hit rates per layer, snapshot-build latency, CDN offload % during live windows (56) — the Stage's scale story is *measured* offload, not hope.
