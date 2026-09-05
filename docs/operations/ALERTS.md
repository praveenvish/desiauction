# Alerts — the five that must exist before beta

> PA-1R Phase 4.4 · 2026-09-05 · closes [PA-1 REPORT](../audits/PA-1/REPORT.md) §20, §42

`docs/56-monitoring.md` lists eight SLOs and an aspirational metrics stack. None
of it is provisioned, and adopting OpenTelemetry is net-new work. This file is
the smaller, buildable thing: **the alerts without which a production incident
is diagnosed from row counts**, each expressed against a signal that already
exists in the code today.

Every one names what it watches, why that number, and what to do. An alert
without an action is a notification, and notifications get muted.

---

## Why five, and why these

The audit's top production risks were ranked by *detectability*, and the four
worst all shared "Detectability: poor". These five close exactly those:

| Risk (PA-1 §30) | Alert |
|---|---|
| Gateway payments silently never capture | 2 · error rate, and 5 · webhook refusals |
| No observability in the web tier | 1 · service health (the probe that proves logs flow) |
| FinOps job executed twice / runner stopped | 3 · runner silence |
| A bad night nobody hears about | 4 · engine liveness during a live window |

---

## 1 · Service health

**Signal:** `GET /healthz` (liveness) and `GET /readyz` (readiness) on web and
engine. Both exist and are already wired into `fly.toml`'s checks.

**Alert when:** `/readyz` returns non-200 for 2 consecutive minutes on any
service, or `/healthz` fails at all.

**Why:** `/readyz` reflects database reachability; `/healthz` deliberately does
not, so that a database blip pulls an instance from rotation without the
orchestrator killing a healthy process. Alerting on both separately preserves
that distinction — a `/readyz` alert is "we cannot serve", a `/healthz` alert is
"the process is wrong".

**Action:** [TROUBLESHOOTING](TROUBLESHOOTING.md). If `/readyz` is red across
every instance, it is the database, not the app.

---

## 2 · Error rate

**Signal:** Sentry event volume per service (needs `SENTRY_DSN`, §7.6 of the
checklist), plus `level>=error` lines from the pino loggers now present in all
three services.

**Alert when:** more than 10 errors in 5 minutes from any service, or ANY event
at `fatal`.

**Why:** `fatal` is only emitted where the process is about to die — the engine's
`die()` on lease loss, the runner's unhandled rejection. That is always worth
waking someone. The rate threshold is deliberately loose: this is the first
alert a new production system has, and one that cries wolf gets muted in week
one.

**Action:** the event's `requestId` joins it to every other line from the same
request (`server/logger.ts`).

---

## 3 · Runner silence

**Signal:** `runnerHealthSnapshot().healthy` and `.oldestQueuedAgeMs`
(`packages/financial-operations/src/server/snapshots.ts`), surfaced on
`/admin/health`.

**Alert when:** `healthy` is false for 15 minutes.

**Why this is the subtle one.** The runner has no HTTP surface — its `fly.toml`
says so deliberately, because killing it loses nothing. That also means nothing
watches it. Health used to be `dead === 0`, which answers "did anything fail
loudly" and scores a *stopped* runner as perfect: a crashed or never-deployed
runner produces no dead jobs at all. It now also fails when the oldest queued
job has been due more than ten minutes, because queue **depth** cannot tell a
busy platform from a dead one and queue **age** can.

**Action:** restart it. A restart is the health remedy by design — leases expire,
cursors resume, job keys absorb the re-fire.

---

## 4 · Engine liveness during a live window

**Signal:** engine `/healthz` (watchdog tick + DB), plus `auctions.status` — the
platform knows its own live windows.

**Alert when:** the engine is unhealthy **at all** while any auction is `live`
or `paused`. Page, do not ticket.

**Why:** this is the one hour the product exists for, and the failure is
user-visible within seconds: the countdown stops on every screen in the room.
Outside a live window the same condition is a ticket.

**Action:** the single-writer lease is the usual cause. `DEPLOYMENT.md` covers a
wedged lease; note the production database needs the TCP keepalives from
checklist §2 or an orphaned lease is not reaped at all.

---

## 5 · Webhook refusals

**Signal:** non-2xx responses from `/api/webhooks/*`, and the `finops` and
`settlement` error lines those routes now emit.

**Alert when:** any webhook route returns 5xx, or more than 3 consecutive 4xx
from the same provider.

**Why:** these routes fail *closed and quietly* by design — an unconfigured
secret 404s, an unverifiable payload is refused. That is right, and it means a
misconfiguration is invisible without this alert. A run of 401s is a rotated
secret; a run of 404s is a route that thinks it is unconfigured; a 5xx is the
class of defect PA-1 found twice (a write attempted by a role that may not).

**Action:** [SECRET_ROTATION](SECRET_ROTATION.md) for 401s; check the relevant
`*_SECRET` for 404s; for 5xx, `pnpm --filter @desiauction/web posture:verify`
under the production roles reproduces the whole class locally.

---

## What is deliberately NOT here

- **Latency SLOs.** `docs/56` promises bid-ack p99 and SOLD→Stage. Nothing
  measures them, and an alert on an unmeasured number is a lie. They arrive with
  a metrics backend, not before.
- **Queue depth as a page.** Depth without age is noise — that is the mistake
  alert 3 corrects.
- **Per-organizer alerts.** At beta scale a human reads the ops board; alerting
  per tenant is how a five-alert page becomes a five-hundred-alert page nobody
  reads.
