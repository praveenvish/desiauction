# Issue Reporting & Triage — Public Beta

How issues are reported, classified, and resolved during the beta. The beta has
NO ticketing backend (out of scope) — routing is static (email + the in-product
Support page), and triage is a human process against this rubric.

## How issues arrive

- **In-product**: the Support page (`/support`) lists contact channels, common
  issues with the relevant help article, and bug-reporting guidance.
- **Email**: `support@desiauction.in`. Auction-night incidents use subject
  `AUCTION NIGHT` and are triaged first.
- **A good bug report** includes: what you did step by step, what you expected
  vs. what happened, the competition/org name and rough time, device + browser,
  and a screenshot. (This checklist is on the Support page.)

## Severity classification

| Sev | Definition | Response target (beta) |
|-----|------------|------------------------|
| **S1 — Critical** | Money integrity at risk, data loss, auth broken, or a live auction cannot proceed for anyone. | Immediate. Consider rollback (see criteria below). |
| **S2 — High** | A core workflow (register / auction / settle / receipt) is blocked for a tournament, no workaround. | Same day. |
| **S3 — Medium** | A workflow is degraded but has a workaround; a surface is wrong but not blocking. | Within the beta week. |
| **S4 — Low** | Cosmetic, copy, or an enhancement request. | Backlog; not a beta blocker. |

Only **S1/S2** are release-blocking. Per the CTO directive: resolve
release-blocking issues; do not act on feature requests during beta.

## Triage flow

1. **Acknowledge** the reporter (target within a day; faster for auction-night).
2. **Reproduce** — capture the exact steps; check Sentry for the error digest
   (shown on the branded error page) and the correlation IDs in the audit log
   (platform admin → Audit explorer).
3. **Classify** by the rubric above.
4. **S1**: assess money/data integrity first. The ledger is immutable and the
   audit trail is complete, so investigate — do not mutate. If the platform
   itself is at fault and unrecoverable in place, invoke rollback.
5. **S2**: identify the blocked workflow; provide a workaround if one exists;
   schedule the fix.
6. **S3/S4**: log against [KNOWN_LIMITATIONS](KNOWN_LIMITATIONS.md) or the
   backlog.

## Diagnostics available without engineering

- **Platform admin console** (`/admin`): platform health, per-org finance
  health, the audit explorer (filter by actor/scope/action/time; correlation
  IDs), organization and user inspection. Read-only — it observes, it does not
  act.
- **Health endpoints**: web `/healthz` + `/readyz`, engine `/healthz`.
- **Structured logs**: pino JSON on Fly/Vercel aggregation; PII-redacted.
- **Runbooks**: [TROUBLESHOOTING](TROUBLESHOOTING.md),
  [DISASTER_RECOVERY](DISASTER_RECOVERY.md).

## Escalation to engineering

Engineering has concluded the programme (post-PX-12). Escalate only S1 money/
data-integrity issues that the runbooks and the admin console cannot resolve,
with: the reproduction, the Sentry digest, the affected org/competition, and the
audit correlation IDs.
