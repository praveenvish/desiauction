# 60 — Deployment Strategy

> Canon: C-12, C-16, C-22 · v1.0 · 2026-07-11

## Topology

| Component | Platform | Notes |
|-----------|----------|-------|
| `apps/web` | Vercel (or equivalent edge/Node hybrid) | Mumbai-first functions; CDN for public surfaces (54) |
| `apps/engine` | Fly.io (or equivalent stateful host) | **Stateful service, Mumbai region**; one process group per cell; WebSocket/SSE served directly; workers colocated (53) |
| Postgres | Managed (Neon candidate), Mumbai + PITR (62) | |
| Redis | Upstash Mumbai | Rate limits, snapshot cache (54) — never truth |

**Cells:** an engine cell hosts many auctions; cells scale horizontally by auction assignment (a tournament pins to a cell). V1: one production cell + one canary cell — the architecture is cellular from day one so scaling is assignment, not re-architecture.

## Deploying the web

Standard platform flow: staging auto, production promote, instant rollback to previous immutable build. Public surfaces are cached/static-leaning (54) — web deploys are low-drama by design.

## Deploying the engine (the careful one)

1. Deploy to **canary cell** → synthetic auction (58 harness) runs the full night compressed → health gates (56).
2. **Live-aware promotion (C-22):** the deploy tool reads the live calendar; promotion to a cell **waits until that cell has zero LIVE auctions** (auto-schedules into the next quiet window; override requires two humans + incident-grade logging).
3. Rolling replace with **drain + handoff**: the outgoing process stops accepting new auctions, persists ledger position (it always is persisted — C-9), closes streams with a `reconnect` frame; clients reconnect to the new process and catch up via snapshot/gap protocol (51) — **a mid-auction deploy, when unavoidable, is a < 10s catch-up blip, not an outage** (rehearsed in staging monthly, 59).
4. Rollback = redeploy previous image (state lives in Postgres + replay, 61 — processes are disposable by construction).

## Migrations

Expand→migrate→contract only (52); run as a separate promoted step before app deploys that need them; never during live windows (C-22); every migration rehearsed on staging's production-shaped data first (59).

## Config & flags

Config changes deploy like code (versioned, staged); runtime flags (63) change exposure without deploys — the emergency lever that respects the freeze.

## The freeze calendar

Beyond per-cell live-awareness: **weekend evenings IST are standing engine-freeze windows** during season (most auctions are Sat/Sun nights) — routine engine deploys happen weekday mornings. The calendar is data in the platform (56 live health board shares it), not a wiki page.
