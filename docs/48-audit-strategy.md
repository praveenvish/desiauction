# 48 — Audit Strategy

> Canon: C-9, C-20 · v1.0 · 2026-07-11

## Doctrine

The audit log is a **product feature** (the trust the product sells), not an ops appendix. One rule generates it: **Activity, History, and Audit are projections of one event stream** (invariant 29) — there is no separate "audit writer" to forget to call on the money path (the auction ledger's events *are* audit facts, mirrored automatically, 38).

## What is audited (invariant 28's list, exhaustively)

- Every auction ledger event (bids, closes, purchases, overrides — automatic, C-9)
- Every gate/lock/unlock (pool lock, config lock, go-live)
- Every override (with reason, ladder-4 confirmed, 28)
- Every grant create/revoke/preset change (36)
- Every token issue/use/revoke (36)
- Every export (what, by whom, row count — invariant 33)
- Every commercial mutation (invoice, payment transition, refund, comp — 46)
- Every registration decision (approve/reject/waitlist + reason category)
- Every break-glass platform access (37, with mandatory reason)
- Every notification sent (as NotificationRecord, linked)

**Enforcement teeth:** privileged actions run in the same transaction as their audit write — **audit failure fails the action** (invariant 28). This is a schema-level posture, not a middleware hope.

## The envelope

```
AuditEvent {
  id: ulid, orgId, occurredAt,
  actor: { personId | 'system' | 'ai:{feature}', onBehalfOf?, grantId? },
  action: 'lot.reopened' | 'grant.created' | …   (one taxonomy with 51),
  subject: { type, id, label-snapshot },
  context: { tournamentId?, auctionSeq?, requestId, ip-hash },
  payload: action-specific facts (before/after for overrides),
  reason?: required for overrides/break-glass
}
```

Label snapshots make the log readable after renames/erasure (pseudonymized actor labels survive, invariant 4).

## Storage & integrity

- Append-only table (52): no UPDATE/DELETE grants to any runtime role — immutability is a database permission, not an application promise (invariant 10's mechanism, applied to audit).
- Hash chain (each event carries `prev_hash`): cheap tamper-evidence; the chain head is included in backups (62) — restores prove integrity.
- Retention: audit rows retain for the org's life + regulatory horizon; erasure requests pseudonymize actor identity, never remove facts (49 DPDP).

## Who sees what

- **Console → Audit** (`org:audit-read`): the ledger view (30) — filterable by actor/action/object/time, exportable (invariant 33 applies to the audit itself).
- Tournament-scoped slice embedded in the tournament's History tab — same stream, scoped projection (invariant 29).
- Owners see their own team's money trail (receipts + their bids) in Owner Room — transparency to the person whose money moved.
- Players see decisions about themselves (their registration timeline) on their status page (42) — respectful transparency, reasons excluded (invariant 6).
- Platform staff: read via break-glass only, which itself audits (recursion intended).
