# 56 — Monitoring

> Canon: C-2, C-17, C-22 · v1.0 · 2026-07-11

> **Implementation status — 2026-08-19.** This is a design target that has been
> cited as a description of the running system. Split below so the difference is
> visible. The short version: **structured logs and health probes exist; a
> metrics/tracing stack does not.** There is no OpenTelemetry dependency in any
> package (`grep -r opentelemetry --include=package.json` returns nothing), no
> metrics backend, no synthetic checks, and none of the SLOs below is measured
> anywhere. The first production incident will be diagnosed from row counts, not
> dashboards (audit `docs/audits/FINAL-PRR/REPORT.md`, §11).

## Stack — implemented

- **Logs:** structured pino JSON in all three services, PII-redacted (secrets, OTP codes, the engine-secret header). Fly/Vercel aggregate by default.
- **Errors:** Sentry is wired in web and engine; production DSNs are founder-held and unset, so nothing is currently reported. Note also that 74 bare `catch {}` sites discard the error object, so a share of failures would not reach Sentry even with a DSN (audit P3-7).
- **Health:** web `/healthz` (liveness) and `/readyz` (DB `select 1`); engine `/healthz` (DB + watchdog). These are the whole of the current observability surface.

## Stack — target (not yet provisioned)

OpenTelemetry SDK in all services (traces + metrics), Grafana-family backend (managed; decision at Phase 2), synthetic checks from two Indian vantage points. **No OTel package is installed in this repository** — adopting it is net-new work, not configuration. Dashboards and alert routing are [PRODUCTION_CHECKLIST](operations/PRODUCTION_CHECKLIST.md) §4 items.

## Product SLOs (target — none of these is currently measured)

These are the numbers to promise once a metrics backend exists. Today nothing
computes them, so treat them as acceptance criteria for the observability work
rather than as a service level anyone is holding.


| SLO | Target | Window |
|-----|--------|--------|
| **Bid ack p99** (place → engine ack at client) | < 400ms (in-region) | Per live auction |
| **Event fan-out p95** (append → surface render) | < 500ms | Per live auction |
| **SOLD→Stage** (commit → ceremony start on Stage) | < 1s | Per live auction |
| Live-surface availability during live windows | 99.95% | Monthly |
| Console availability | 99.9% | Monthly |
| Snapshot join (Stage cold load → live) | < 3s p95 | Per live auction |
| OTP delivery p95 | < 15s | Daily |
| Webhook delivery success (≤ 5 retries) | 99.5% | Weekly |

SLOs are user-experienced numbers (measured at the client where possible — RUM), not server-side vanity. Error budgets gate release pace (63).

## Golden signals per service (target)

The signals to emit once there is somewhere to emit them. None is instrumented today.


- **Engine:** event append latency, fan-out lag per transport, connected clients, per-auction seq head advance rate, timer drift, freeze count (a `lot.frozen` is always a paged anomaly during live), recovery/replay duration on restart.
- **Web:** request latency/error rates per route class, Web Vitals RUM (57 budgets as thresholds), hydration errors.
- **Workers:** queue depth per class, job latency, retry/DLQ rates (53), OTP/critical queue age (alert > 30s).
- **Data:** connection saturation, replication/PITR lag (62), RLS policy errors (any = page — a tenancy anomaly is never a warning, 49).

## Live-window escalation (C-22, the signature behavior) — target

Unbuilt in every part: there is no alert routing, no live health board, no
synthetic bid probe and no calendar-driven deploy freeze (the freeze is a human
rule in [DEPLOYMENT](operations/DEPLOYMENT.md) today). Stated as the design:
while any auction is `Live`,

- Alert thresholds tighten (engine p99s, transport errors) and route to **page** instead of ticket.
- A per-auction **live health board** exists (ops view): seq advance, connected surfaces, transport mix, freeze/override count, watchdog activity — one screen answering "is this night healthy?"
- Synthetic bid probe (against a health-check auction, not tenant data) runs every 60s.
- Deploy freeze is enforced by the same calendar (60).

## Alert philosophy

Every alert has: an owner, a runbook link (61), and a "why this number." Alerts that fire without action twice get retired or fixed — alert fatigue is a reliability bug. Pages are for *user-visible or imminent* harm; everything else is a ticket into the attention queue of ops.

## Zero silent failures (C-2) — target

The principle is binding; the machinery is not built. Each detector below is
unimplemented, and "alert on silence" currently has nothing to alert with.


The set of "impossible" states each have a detector: projection drift vs ledger (nightly checksum), surface money mismatch (client-reported seq/value sampling), audit chain breaks (48), unNotified DLQ items, invoice/payment mismatches (46 reconcile). Detectors page; "we found out from a user" is a postmortem-triggering event by policy.
