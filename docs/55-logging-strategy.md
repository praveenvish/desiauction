# 55 — Logging Strategy

> Canon: C-17 · v1.0 · 2026-07-11

## Shape

Structured JSON (pino) everywhere; stdout → platform collector; one schema:

```
{ ts, level, service: web|engine|worker, env,
  msg,                      // human sentence, present tense
  request_id, trace_id,     // correlation (OTel)
  org_id?, auction_id?, seq?,   // domain correlation
  actor?,                   // person/system/ai — ids only, never names
  err?: { type, message, stack, code },
  ...event-specific fields }
```

**`seq` in every live-path log line** is the product-specific rule: any incident during an auction can be replayed against the ledger position it happened at (61 runbooks depend on this).

## Levels

- `error`: something failed that shouldn't — every one is triaged (zero silent failures, C-2); paired with Sentry capture + `ref` shown to users (24).
- `warn`: degraded-but-handled (fallback transport engaged, retry succeeded late, freeze created).
- `info`: domain events and state transitions (the operational narrative: auction started, lot closed, export done).
- `debug`: development only; compiled out of production hot paths (bid handling logs `info` on accept/reject-with-code, nothing chattier).

## Redaction (hard rules)

- **Never logged**: OTPs, tokens (log token *ids*), session ids, phone numbers (log person ids; masked last-4 only where operationally necessary in support tooling), photos/URLs with embedded tokens, payment instrument data (we never hold it anyway, 46), AI prompt contents containing person data (35).
- Redaction is a pino serializer allowlist — fields not on the allowlist for known objects are dropped by default (opt-in logging, not opt-out redaction).
- Client logs (24 error events): sanitized at the client, size-capped, same request_id correlation.

## Retention & access

30 days hot, 13 months cold (fiscal-year incident forensics), then deletion; access to production logs is itself audited (49 break-glass for anything person-correlated); logs are operational data, never analytics (51 planes).

## The narrative test

`info`-level logs for one auction, read in order, must tell the night's story: started → lots → bids (counts) → ceremonies → completed → reconciled. If an on-call engineer can't follow the story at 2am, the logging failed its purpose — this is a review criterion on engine PRs (64).
