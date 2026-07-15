# SETTLEMENT SECURITY & THREAT MODEL

## DesiAuction NEXT · v1.0 · 2026-07-15 · CTO · **FROZEN** (IP-5, M-IP5-4)

> What an attacker can and cannot do to settlement money. Source of truth:
> `packages/settlement` (pure invariants), `apps/web/src/server/settlement`
> (writer, authz, webhook), migration `0011`/`0012`/`0013` (RLS). Every claim
> below is backed by a certification test (`settlement-certification.regression`,
> `settlement-*.regression`). Governed by canon C-8/C-9/C-13, docs
> [48](../48-audit-strategy.md)/[49](../49-security-model.md).

## 1 · The trust boundary

Settlement is a purely additive consumer of frozen platforms. It **reads**
`auction_events` and reference data; it **writes** only its own three streams
and their disposable projections, plus one sanctioned cross-context write
(settlement grant issuance into identity's `grants` table, gated by the frozen
`grant.issue`). It holds **no write path** to `auction_events`, the auction
rows, or the frozen capability engine — proven by the zero-diff gate and the
dependency-cruiser boundary.

## 2 · Authorization (the capability partition)

Two evaluation engines partition the capability space with **no bleed in either
direction**, proven by test:

- The **frozen** engine (`hasCapability`) expands unknown sets to nothing, so a
  settlement grant confers **zero** frozen capabilities (`org:owner` is not a
  treasurer).
- The **settlement** engine (`hasSettlementCapability`) recognises only
  settlement sets, so frozen sets confer **zero** settlement capabilities.

Atoms: `settlement.view` · `settlement.manage` (case lifecycle, closure) ·
`settlement.collect` (record money in) · `settlement.override` (waive, refund
reversal, reopen, void, discrepant-exit) · `settlement.export`. Sets:
`settlement:officer` = {view, manage, collect, export} · `settlement:controller`
= officer + {override}. Separation of powers is enforced: recording a payment
never confers forgiving a debt; running a case never confers rewriting one. The
writer **re-checks** capability inside command execution — surface affordances
are courtesy, never the boundary.

**Grant issuance** is the one cross-context write, gated by the frozen
`grant.issue`/`grant.revoke` and refusing unknown sets at creation (nothing
mints an unexpandable grant). Every issue/revoke is audited in-transaction.

## 3 · Tenant isolation (RLS)

Every settlement table (`settlement_events`, `settlement_cases`,
`settlement_obligations`, `journal_postings`, `journal_legs`,
`journal_checkpoints`, `payments`) carries `org_id` and ships `ENABLE` +
`FORCE ROW LEVEL SECURITY` with **both** `USING` and `WITH CHECK` keyed to
`current_setting('app.org_id', true)` in its creating migration — fail-closed
(NULL context ⇒ zero rows, rejected writes), no self-row disjunct. **Certified
(M-IP5-4):** under a dedicated non-superuser role, on **all seven tables**, no
context and a foreign context both fold to zero rows, and a write scoped to a
foreign org is rejected by `WITH CHECK` even while holding a legitimate context.

**Inherited pre-deploy fact (unchanged from IP-2/IP-4 MAJ-2):** runtime
isolation is application-layer today (`withTenant` call sites = 0; the app runs
as an RLS-exempt role locally). The settlement writer is built
**withTenant-compatible** (single transaction per command; the webhook path
establishes tenant context from the verified envelope before any org-scoped
read), so the one pre-deploy wiring item covers settlement with zero rework. No
settlement path depends on BYPASSRLS.

## 4 · Webhook ingress (trusted-envelope)

Provider webhooks authenticate by **HMAC-SHA256 over the raw body** (the
platform webhook secret) plus a **timestamp window** — no session, no database
read before authentication. Order (certified): verify signature → verify window
→ extract the envelope (orgId + paymentId from the order's `notes`) → establish
tenant context from the **verified** org → load the payment (first org-scoped
read) → cross-check the envelope against the pinned initiation → process. A
verified-HMAC envelope naming a mismatched payment fails closed (409, audited).
A bad signature is 401; a stale/malformed event is 400; the payment is never
looked up. Idempotency is by `providerEventId` (a replayed webhook returns the
original ack and appends nothing). **No provider SDK** is imported anywhere; the
adapter is HMAC + an injectable HTTP transport.

## 5 · What an attacker with DB write access can and cannot do

The projections are disposable; the **event log is the truth**. Every row the
writer reads to decide is verified against the fold before it decides (the
IP-4 D-2/D-3 rule, adopted at birth).

| Attack | Result (certified) |
|---|---|
| Tamper a `journal_legs` amount (the money row) | next command **halts** (`settlement_halted`); `recoverJournal` heals it byte-identical |
| Tamper a `payments.captured` / obligation counter | halt; `recoverPayments`/`recoverCase` heal byte-identical |
| Tamper the sealed `closure_evidence` row | halt (`evidence diverged`); `recoverCase` heals; reproduction re-matches |
| Delete a projection row (posting/leg/payment) | reverse-scan detects it; recovery rebuilds |
| Tamper a `journal_checkpoint` (bytes+digest) | genesis re-verification rejects it; recovery re-derives the chain |
| Insert a duplicate `(stream, stream_id, seq)` | unique index **rejects** it; the duplicate never lands |
| Inject a forged event type / forged money / off-template / duplicate-source event into the log | reducer **fails closed**; recovery refuses (restore-from-backup territory, not a repair) |
| Reorder or gap a stream | fold refuses (`sequence_gap`) |
| Replay a webhook / duplicate a command id | idempotent — original ack, no second effect |

**What an attacker CANNOT do without corrupting the immutable log itself:** move
money without a balanced, templated, single-sourced posting; discharge more than
is owed; refund more than was captured; close a case that does not verify; or
make a closed case's evidence stop reproducing. Corruption **of the log** (gap,
malformed payload, unbalanced posting in the log) is unhealable-by-design — a
PITR/restore operation, named in [RUNBOOKS](RUNBOOKS.md), never patched by hand.

## 6 · Money & audit integrity

All money is integer paise from the frozen kernel; float/negative/NaN/overflow
are unrepresentable and fail closed at the log. Double-entry (legs sum to zero)
+ template-shape + one-cause-one-posting + conservation (no account below its
natural side) are reducer-enforced; **trial balance is zero at every seq**
(certified across the whole org journal). Every settlement mutation writes its
`audit_log` row in the **same transaction** (audit failure fails the action);
overrides carry a mandatory reason; the webhook capture is attributed to
`source: webhook:razorpay`, the sweep to `sweep`, recovery to `recovery`. Every
event carries an audit row naming its seq (certified across all three streams).
