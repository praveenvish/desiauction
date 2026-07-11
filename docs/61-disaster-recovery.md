# 61 — Disaster Recovery

> Canon: C-9, C-22 · v1.0 · 2026-07-11

## Objectives

| Scenario | RPO | RTO |
|----------|-----|-----|
| Engine process/host loss | **0** (ledger is committed truth) | < 60s (auto-restart + replay) |
| Database loss (PITR restore) | ≤ 5 min | < 1h |
| Region failure (Mumbai) | ≤ 15 min | < 4h (warm standby region runbook) |
| Provider failure (WhatsApp/Razorpay/AI) | n/a | Degraded modes immediately (invariant 19) |

## The architectural advantage (why DR is tractable here)

**Processes are disposable; the ledger is the truth** (C-9). Engine recovery = replay events → rebuild state → re-arm timers from persisted `endsAt` (53) → clients reconnect and catch up (51). There is no "in-memory state we lost" category of disaster — the design decision *is* the DR strategy. Recovery time budget: < 10s replay for the largest realistic auction (57), drilled monthly via kill-testing in staging (59).

## Scenario runbooks (each documented, each drilled)

- **Engine crash mid-lot:** auto-restart → replay → timers re-armed; watchdog (53) covers the gap; surfaces show "Catching up…" (23). If the crash interrupted a close, the close is transactional — either the Purchase committed (SOLD stands) or it didn't (lot still open); **no ambiguous middle exists** (invariant 13/17). Drill: kill -9 during simulated snipe war.
- **Database failover:** managed HA promotes; engine reconnects with backoff, refuses commands (bids rejected with honest `SYSTEM_HOLD`) until confirmed consistent — **money quiesces, never guesses** (invariant 17). Live rooms see the pause treatment with honest copy (21).
- **PITR restore (data corruption/operator error):** restore to T, replay ledger integrity check (48 hash chain), reconcile projections (rebuildable, 52), org-by-org verification of active tournaments. Because ledger tables are INSERT-only at the permission level (52), the corruption blast radius is projections — rebuildable — in almost every case.
- **Region loss:** warm standby (streamed WAL, 62) in a second Indian region; DNS/edge cutover; engine cells recreated from ledger; the decision tree (who declares, what's said publicly) is written down — honesty during disaster is pre-scripted (03 §5).
- **Mid-auction total platform loss (the nightmare):** the Cockpit's **paper mode**: at any moment the organizer can export the current auction state (one tap, works from the last cached state) as a printable conduct sheet — purse remaining, pool left, squad counts. The night survives on paper and re-enters as pre-assignments after recovery (41). The product's promise is the *night*, not just the software (invariant 19 taken to its conclusion).

## Degraded-mode matrix (invariant 19 operationalized)

| Down | The night continues via |
|------|------------------------|
| WhatsApp/SMS | In-app + manual link sharing; organizer notified (47) |
| Razorpay | Passes already active are unaffected; upgrades queue |
| AI provider | Advisory features vanish silently (35) |
| Realtime transport (WS) | SSE fallback (51); worst case: manual conduct mode + Stage on polling snapshot |
| Media/CDN | Text-first rendering (initials avatars); ceremony intact |

## Discipline

Every runbook: owner, last-drilled date, evidence link. **A runbook not drilled in 2 quarters is treated as broken** (the reference program's OPS-1 lesson — "0% rehearsed" is the state this document exists to prevent). DR drill calendar lives beside the freeze calendar (60).
