# 60 — Deployment Strategy

> Canon: C-12, C-16, C-22 · v1.0 · 2026-07-11

## Topology

> **Implementation status — 2026-08-19.** A design target, not a description of
> a running deployment: nothing is provisioned (no Fly, no Vercel, no managed
> Postgres). Two items below were also **decided against** during
> implementation and are corrected in place — Redis, and SSE. What is actually
> built and rehearsed locally is in
> [DEPLOYMENT](operations/DEPLOYMENT.md).

| Component | Platform | Notes | Status |
|-----------|----------|-------|--------|
| `apps/web` | Vercel (or equivalent edge/Node hybrid) | Mumbai-first functions; CDN for public surfaces (54) | ☐F not provisioned; build + config rehearsed locally |
| `apps/engine` | Fly.io (or equivalent stateful host) | **Stateful service, Mumbai region**; one process group per cell; WebSocket served directly; workers colocated (53). *SSE was never built — the engine broadcasts snapshots over WebSocket only.* | ☐F not provisioned; image builds, `fly.toml` + deploy workflow exist |
| `apps/finops-runner` | Fly.io, same shape | Poll loop over `finops_jobs` (`FOR UPDATE SKIP LOCKED`), 15 s tick | ☐F not provisioned; image builds + boot-smoked |
| Postgres | Managed (Neon candidate), Mumbai + PITR (62) | | ☐F not provisioned |
| ~~Redis~~ | ~~Upstash Mumbai~~ | **Not used, by decision.** Rate limits and job queueing are Postgres-backed and there is no snapshot cache (ADR-3); no Redis dependency exists in any package, and PX-12 §1 lists it as explicitly *not* required to provision. Adding one would be a new architectural decision, not a provisioning step. | ✗ deliberately absent |

**Cells (target).** Not built: the engine runs as a single instance per
environment, and multi-instance safety has never been exercised (audit §8).
Since 2026-08-26 that constraint is enforced rather than merely documented — an
engine claims a Postgres advisory lock at boot and a second instance refuses to
start (`apps/engine/src/single-writer.ts`, see DEPLOYMENT.md). Building cells
therefore means giving the lease a per-cell key, so the enforcement scales with
the design instead of being removed to make room for it. The
design intent: an engine cell hosts many auctions; cells scale horizontally by auction assignment (a tournament pins to a cell). V1: one production cell + one canary cell — the architecture is cellular from day one so scaling is assignment, not re-architecture.

## Deploying the web

Standard platform flow: staging auto, production promote, instant rollback to previous immutable build. Public surfaces are cached/static-leaning (54) — web deploys are low-drama by design.

## Deploying the engine (the careful one) — target

Steps 1–3 below are unbuilt: there is no canary cell, no live-calendar-aware
promotion tool and no drain/handoff `reconnect` frame. Today the engine drains
on SIGTERM and recovers by replaying the event log; "never deploy during a live
window" is a human rule in the runbook. Step 4 is real.


1. Deploy to **canary cell** → synthetic auction (58 harness) runs the full night compressed → health gates (56).
2. **Live-aware promotion (C-22):** the deploy tool reads the live calendar; promotion to a cell **waits until that cell has zero LIVE auctions** (auto-schedules into the next quiet window; override requires two humans + incident-grade logging).
3. Rolling replace with **drain + handoff**: the outgoing process stops accepting new auctions, persists ledger position (it always is persisted — C-9), closes streams with a `reconnect` frame; clients reconnect to the new process and catch up via snapshot/gap protocol (51) — **a mid-auction deploy, when unavoidable, is a < 10s catch-up blip, not an outage** (rehearsed in staging monthly, 59).
4. Rollback = redeploy previous image (state lives in Postgres + replay, 61 — processes are disposable by construction).

## Migrations

Expand→migrate→contract only (52); run as a separate promoted step before app deploys that need them; never during live windows (C-22); every migration rehearsed on staging's production-shaped data first (59).

**This is policy, and it has not been followed.** `0019_tournaments.sql` renames
a table and drops a column in one step — a contract without an expand. Migrations
are forward-only with no down path, so expand/contract is the *only* thing that
keeps an image rollback available; where it is skipped, the rollback plan becomes
a restore from a backup that does not yet exist. There is no staging to rehearse
on. See [DEPLOYMENT §Rollback](operations/DEPLOYMENT.md#rollback).

## Config & flags

Config changes deploy like code (versioned, staged); runtime flags (63) change exposure without deploys — the emergency lever that respects the freeze.

## The freeze calendar (target)

Not implemented — the calendar is not data in the platform and no tooling reads
it; the freeze is a line in the deployment runbook that a human honours. Beyond
per-cell live-awareness: **weekend evenings IST are standing engine-freeze windows** during season (most auctions are Sat/Sun nights) — routine engine deploys happen weekday mornings. The calendar is data in the platform (56 live health board shares it), not a wiki page.
