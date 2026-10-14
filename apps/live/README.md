# Match live service

Read-only WebSocket snapshots at `/live/ws`; HTTP polling remains available.
Set SYSTEM_DATABASE_URL to the system role and LIVE_ALLOWED_ORIGINS to exact browser origins.
PORT defaults to 4100. TRUSTED_PROXY_COUNT is 1 behind production Caddy.
Health: `/healthz`; readiness: `/readyz`. No commands or writes are accepted.

Astra C44 amendment: at most two physical connections, one dedicated LISTEN
(timeout disabled) and one serial reader (30s statement ceiling). Both close on
shutdown; supported postgres APIs reconnect the listener without new pools.
Every subscription/release uses the shared P1 query and P3 selector. A coalescing
queue, bounded rooms and slow-consumer disconnects cap retained work. Heartbeat
20s; origins required, maxPayload 1KiB and max20 connections per client IP.
