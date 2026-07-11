# 53 — Background Jobs

> Canon: C-16 · v1.0 · 2026-07-11

## Platform

**pg-boss** (Postgres-backed queue) — the deliberate boring choice: transactional enqueue with domain writes (a job enqueued in the same transaction as its cause can never orphan), no extra broker to operate, visible in SQL. Workers run in `apps/engine`'s process group (V1 scale) with a clean seam to split out later.

## The constitutional rule (C-16)

**Nothing on the money path is a background job.** Bids, closes, purchases, purse math happen synchronously inside the engine (C-9). Jobs handle the *aftermath*: notifications, exports, imports, webhook deliveries, reconciliation, media processing.

### Lot timers (the exception that proves it)

The reference stack scheduled lot closes in an external queue with a cron watchdog — three systems simulating one stateful process. Here: **timers live in the engine's memory** (it's a stateful service); expiry triggers the same in-process close. Durability: `endsAt` is persisted with the lot; on engine restart, recovery replays state and re-arms timers (61); a **watchdog job** (every 30s) closes any lot past `endsAt` if the engine somehow didn't — idempotent by seq (the close no-ops if already closed). Two layers, one truth.

## Job catalog (V1)

| Job | Trigger | Priority |
|-----|---------|----------|
| notification.send | Domain events (47) | High (OTP: critical queue) |
| webhook.deliver | Ledger events after commit (51) | High |
| export.generate (PDF/XLSX) | User request | Normal |
| import.process (CSV → staged rows) | User upload | Normal |
| media.process (photo compress/variants) | Upload | Normal |
| payments.reconcile | Cron daily (46) | Normal |
| lots.watchdog | Cron 30s during live auctions only | Critical |
| backups.verify | Cron per 62 | Low |
| retention.sweep (tokens, drafts, notifications) | Cron daily | Low |

## Execution contract

- **Idempotent handlers, mandatory**: every job keyed (`idempotency_key`), effects deduplicated (sends by NotificationRecord key, webhooks by delivery id) — retries are always safe (50's promise extended inward).
- Retries: exponential backoff + jitter, class-specific max (critical 10, normal 5) → **dead-letter** with the failure context; user-visible DLQ items surface in the attention queue (26); ops DLQ alerts per 56.
- Timeouts per class; long jobs checkpoint (imports process in row batches, resumable).
- Priority queues: `critical` (OTP, watchdog) isolated from bulk (`export`) — an export storm never delays an OTP.
- Every job execution traced (OTel span linked to the triggering request/event, 55) and metered (duration, success rate, queue depth, 56).

## Scheduling

Cron via pg-boss schedules, timezone-pinned IST for business crons; live-window awareness: heavy maintenance crons skip while any org auction is LIVE (C-22).
