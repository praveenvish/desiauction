# SETTLEMENT RUNBOOKS

## DesiAuction NEXT · v1.0 · 2026-07-15 · CTO · **FROZEN** (IP-5, M-IP5-4)

> Operating settlement without its original authors. Every procedure is a call
> into `apps/web/src/server/settlement`; nothing here mutates a row by hand
> except the two named restore paths.

## 1 · The lifecycle (the happy path)

1. **Open** a case on a completed/abandoned auction — `openCase` (pins the
   frozen log). `settlement.manage`.
2. **Verify** — `verifyCase` (re-folds the source against the pin; a mismatch →
   `discrepant`, money quiesces). Exit discrepancy with an audited override
   re-verify (re-pins).
3. **Compute obligations** — `computeCaseObligations` (→ `settling`).
4. **Collect** — `createPayment` + `attestManualCapture` (manual) or the gateway
   webhook (`handleRazorpayWebhook`). `settlement.collect`. Waive with
   `waiveObligation` (`settlement.override`).
5. **Settle** — `settleCase` (guard: zero outstanding).
6. **Check readiness** — `readyForClosure` (reports blockers).
7. **Close** — `closeCase` (runs financial verification, seals evidence).
   `settlement.manage`.
8. **Reconciled overlay** — the auction surface renders `reconciledOverlayFor`;
   the ceremony read model is `closureCeremony`.

## 2 · A command was rejected — reading the reason

Every rejection is a deterministic code. Common ones:
`case_not_collecting` / `amount_exceeds_outstanding` (payment initiation) ·
`obligations_outstanding` (settle) · `verification_failed:{check}` (close) ·
`not_authorized` (missing capability) · `settlement_halted` (a projection row
diverged from the log — go to §3) · `journal_halted` (the journal is halted —
§3). Rejections append **no event**; state is unchanged. Re-issuing with a fixed
input is safe (a duplicate `commandId` returns the original ack).

## 3 · An aggregate halted (`settlement_halted` / `journal_halted`)

A halt means a **projection row disagrees with the event log** — the writer
refuses to decide against a row the log does not vouch for. This is
fail-closed, not data loss.

1. Diagnose: `verifyJournal(deps, orgId)` (journal + checkpoints) or fold the
   case/payment and diff. The divergence list names the exact row and field.
2. Heal: `recoverJournal` / `recoverCase(caseId)` / `recoverPayments` — each
   re-folds from genesis and rebuilds the rows FROM the events, emitting a
   `*Recovered` event. **Byte-identical** to the pre-tamper rows (certified).
3. Resume: the halt clears automatically (it is re-derived per command, not a
   stored flag) — commands work once the rows match the log.

**Cold recovery** (fresh process, or after a crash mid-coordination): run
`runCoordination(caseId)` and `runPaymentCoordination(paymentId)` to re-derive
any downstream effect lost between a source commit and its coordination commit —
idempotent by derived command id, safe to run at any time.

## 4 · An UNHEALABLE log (restore-from-backup)

If recovery returns `ok: false` with a reason like `sequence_gap`,
`unknown_event_type`, `unbalanced_posting`, or `malformed_*`, the **event log
itself** is corrupt (a gap, a forged type, an unbalanced posting IN the log).
Recovery heals nothing and says so. This is **not** a repair-by-hand situation:

1. Restore the affected org's `settlement_events` (and downstream projections)
   from the most recent PITR/WAL point before the corruption.
2. Re-run recovery to rebuild the projections from the restored log.
3. File an incident: a corrupt append means the writer-role restriction (§6) or
   the DB integrity was breached.

## 5 · Checkpoints (journal acceleration)

Journal checkpoints (every 1,000 events) accelerate the command path. They are
**disposable and never truth**: created unverified, promoted only by
`verifyJournal` (a genesis re-fold proving byte-identity). To rebuild the chain:
`recoverJournal` (on divergence) or `verifyJournal` (maintenance) re-derives and
re-verifies it. Truncating `journal_checkpoints` is always safe; the next
`verifyJournal` re-creates it.

## 6 · Pre-deploy operational items (carried to first production deploy)

1. **Wire `withTenant`** into the settlement serving path and deploy under a
   **non-BYPASSRLS role** before multi-tenant exposure (inherited IP-2/IP-4
   MAJ-2). The settlement writer is already withTenant-compatible; the webhook
   path resolves org from the verified envelope before any org-scoped read.
2. **Restrict `settlement_events` write access to the settlement writer role**
   (the auction-engine-role precedent), so a forged append is a permission
   error, not a recovery event.
3. **Schedule** the payment-expiry sweep (`expirePayment`) and the daily
   provider reconciliation sweep (the `fetchPayment` port) — commands exist,
   scheduling is ops wiring.
4. **Wire Razorpay production credentials** (`keyId`/`keySecret`/`webhookSecret`)
   into `settlementDeps({ gateways })` and register the webhook endpoint
   (`handleRazorpayWebhook`). The adapter is complete and HMAC-tested; only
   configuration is pending.

## 7 · Evidence & disputes

A closed case's evidence is immutable (in the `CaseClosed` event) and
reproducible: `reproduceClosureEvidence(caseId)` re-folds the pinned prefixes,
re-runs verification, and returns `matches: true` — even years later, even after
a reopen. A disputed sale/collection is reconstructed by folding the case
stream (`closureTimeline`) and the org journal (`journalSummary`), both linked
to `audit_log` by `correlationId` and to `settlement_events` by seq.
