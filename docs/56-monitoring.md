# 56 — Monitoring

> Canon: C-2, C-17, C-22 · v1.0 · 2026-07-11

## Stack

OpenTelemetry SDK in all services (traces + metrics), pino logs (55), Sentry (errors + client performance), Grafana-family backend (managed; decision at Phase 2), synthetic checks from two Indian vantage points.

## Product SLOs (what we actually promise)

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

## Golden signals per service

- **Engine:** event append latency, fan-out lag per transport, connected clients, per-auction seq head advance rate, timer drift, freeze count (a `lot.frozen` is always a paged anomaly during live), recovery/replay duration on restart.
- **Web:** request latency/error rates per route class, Web Vitals RUM (57 budgets as thresholds), hydration errors.
- **Workers:** queue depth per class, job latency, retry/DLQ rates (53), OTP/critical queue age (alert > 30s).
- **Data:** connection saturation, replication/PITR lag (62), RLS policy errors (any = page — a tenancy anomaly is never a warning, 49).

## Live-window escalation (C-22, the signature behavior)

The platform knows its calendar: while any auction is `Live`:

- Alert thresholds tighten (engine p99s, transport errors) and route to **page** instead of ticket.
- A per-auction **live health board** exists (ops view): seq advance, connected surfaces, transport mix, freeze/override count, watchdog activity — one screen answering "is this night healthy?"
- Synthetic bid probe (against a health-check auction, not tenant data) runs every 60s.
- Deploy freeze is enforced by the same calendar (60).

## Alert philosophy

Every alert has: an owner, a runbook link (61), and a "why this number." Alerts that fire without action twice get retired or fixed — alert fatigue is a reliability bug. Pages are for *user-visible or imminent* harm; everything else is a ticket into the attention queue of ops.

## Zero silent failures (C-2, made operational)

The set of "impossible" states each have a detector: projection drift vs ledger (nightly checksum), surface money mismatch (client-reported seq/value sampling), audit chain breaks (48), unNotified DLQ items, invoice/payment mismatches (46 reconcile). Detectors page; "we found out from a user" is a postmortem-triggering event by policy.
