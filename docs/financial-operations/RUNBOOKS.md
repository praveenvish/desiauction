# FINANCIAL OPERATIONS RUNBOOKS

## DesiAuction NEXT · v1.0 · 2026-07-16 · CTO · **FROZEN** (IP-6 freeze)

> Operating financial operations without its original authors. Every
> procedure is a call into `@desiauction/financial-operations/server` (wired
> in `apps/web` for humans, `apps/finops-runner` for schedules); nothing here
> mutates a row by hand except the one named restore path. Settlement's own
> runbooks remain authoritative for everything upstream.

## 1 · The daily cycle (what the runner does unattended)

Every tick (`apps/finops-runner`, `RUNNER_TICK_MS`): `followAllOrgs` (consume
new settlement history; auto-issue due receipts under declared policy) →
`runnerTick` (seed/fire schedules → scan requested dispatches/exports into
jobs → drain under lease). At 01:30 IST the daily-ops slot fires per org:
`ops.attest-day` (run the follower, evaluate the **8-check operational
checklist**, system-attest a green day or note one mapped exception per red
check) and `export.daily` (the day's register, `dailyKey`-idempotent). At
02:00 IST on April 1 the year-end slot verifies the ended year's close
readiness (recorded as an audit breadcrumb; appends nothing). Kill the
process at any instant: leases expire, derived keys absorb re-fires, cursors
resume, duplicates return original acks.

## 2 · Reading a rejection

Every rejection is a deterministic code and appends nothing. Common:
`not_authorized` (missing finops capability) · `finops_halted` (a projection
row disagrees with the log — §3) · `finops_unfoldable` (the log itself
refuses — §4) · `watermark_behind_source` (run the follower first) ·
`duplicate_document_source` (that settlement fact is already documented) ·
`fiscal_year_mismatch` / `fiscal_year_not_ended` / `days_unattested` /
`exceptions_open` (close guards) · `period_advanced_retry` (re-issue: the
period moved while evidence was composed) · `tax_decomposition_not_available`
(registered issuers cannot invoice until decomposition ships — ADR-6) ·
`dispatch_terminal` / `export_terminal` (retry = a NEW aggregate).

## 3 · An aggregate halted (`finops_halted`)

A projection row disagrees with the event log; the writer refuses to decide
against a row the log does not vouch for. Heal FROM events:
`recoverProfile(orgId)` · `recoverSeries(orgId, seriesId)` ·
`recoverDispatch/Export/Period(orgId, id)` — each re-folds from genesis,
rewrites the rows byte-identically (certified) and appends `*Recovered`. The
halt is re-derived per command, never stored: commands work the moment rows
match the log.

## 4 · An UNHEALABLE log (restore-from-backup)

If recovery returns `finops_unfoldable` (`sequence_gap`,
`unknown_event_type`, `number_gap`, …), the `finops_events` stream itself is
corrupt. Recovery heals nothing and says so. Restore the affected org's
`finops_events` (and downstream projection tables) from PITR/WAL to the last
point before the corruption — **a restore is a prefix, never a splice**
(deleting one forged mid-stream event leaves a gap; roll back to the seq
before it, then recover). File an incident: a corrupt append means the
writer-role restriction (§9.2) or DB integrity was breached.

## 5 · The follower

`runFollower(orgId)` consumes; `followerHealthSnapshot` reports lag;
`watermarkSnapshot` is the frontier every surface renders. A stalled stream
(`waiting`) means the read raced an in-flight settlement transaction — the
next run clears it. **Rewind is always safe**: `rewindFollower(orgId)`
(audited) deletes cursors; the next run re-consumes from genesis and every
effect re-derives idempotently. A cursor AHEAD of its source head is
watermark corruption — the supervisor fails the component; rewind heals.

## 6 · Dispatch operations

Requested dispatches are discovered and sent automatically. Outcomes:
`confirmed` (provider callback / synchronous channel / manual attestation) ·
`failed` (permanent code, `retries_exhausted:*`, `channel_unconfigured`,
`document_not_reproducible`, `cancelled`). Retry a failure:
`retryDispatch(actor, failedId)` → NEW dispatch. Attest out-of-band delivery:
`confirmDispatchManually(actor, id, note)`. Stop a pending one:
`cancelDispatch(actor, id, reason)`. **A dead-lettered send job** (unknown
provider behaviour) waits for a human: fix the provider, then
`requeueDeadJob(actor, jobId)` (`finops.operate`, audited). An unconfigured
channel fails closed — wire the provider adapter into
`finopsDeps({ delivery })` (pre-deploy configuration).

## 7 · Exports & artifacts

Requested runs generate automatically (gather → reproduce every document →
build → store → read-back verify → complete). `verifyExport(exportId)` checks
the stored artifact against the SEALED digest and regeneration against
sources; `archiveSnapshot` lists every run with its verdict. A corrupted or
lost artifact: `regenerateExportArtifact(exportId)` — refuses with
`regeneration_digest_mismatch` if sources contradict the seal (that is a
forged run, not an IO fault; investigate). A failed run:
`retryExport(actor, failedId)` → NEW run (params carry `retryOf`).

## 8 · Fiscal close and evidence

`fiscalCloseSnapshot(periodId)` names what blocks the seal (unattested days
from the period's opening date, open exceptions, year not ended). Exceptions
are answered by a HUMAN attesting the burdened day (`attestDay`). Seal:
`closePeriod` (capability `finops.close`). Verify any seal ever made:
`evidenceSnapshot(periodId, atSeq?)` / `reproduceFiscalEvidence` — byte-exact
from pinned prefixes, valid across reopens forever. Reopen (override +
reason): `reopenPeriod`; correct via new documents; re-close seals fresh
evidence. `evidenceRegisterSnapshot` re-verifies every seal live.

## 9 · Supervision & certification

`superviseOperations(orgId)` derives seven component healths from folds and
observation — **unknown is never healthy**, and it never repairs; every
verdict names the fixing command (`complianceQueueSnapshot` lists them
ranked). `certifyOperations(orgId)` double-derives the replay certification
(streams, projections, documents, artifacts, seals, journal balance) and
records the digest breadcrumb; `certificationRegisterSnapshot` exposes a
claimed digest that re-derivation contradicts. A stale open settlement
payment degrading `settlement-sync` means the settlement expiry sweep is not
scheduled (§10.3).

## 10 · Pre-deploy operational items (carried to first production deploy)

1. **Wire `withTenant`** into the finops serving paths (web writer, runner,
   follower) and deploy under a **non-BYPASSRLS role** (inherited IP-2/IP-4
   MAJ-2, IP-5-confirmed). Every finops path is withTenant-compatible; RLS
   read+write proofs stand on all ten org tables under a non-superuser role.
2. **Restrict `finops_events` writes to the finops writer role** (the
   auction-engine/settlement precedent), so a forged append is a permission
   error, not a restore event.
3. **Schedule the settlement sweeps** (`expirePayment`, the provider
   reconciliation sweep) — settlement server commands, hosted where
   settlement's writer lives (apps/web wiring); the finops supervisor flags
   their absence via stale payments but cannot run them (boundary graph).
4. **Wire provider credentials**: delivery adapters (email/SMS/WhatsApp BSP)
   into `finopsDeps({ delivery })`; an S3-compatible `ArtifactStorePort`
   adapter for durable artifacts (filesystem store is single-node); Razorpay
   production keys (settlement, unchanged).
5. **Point `FINOPS_ARTIFACTS`/outbox storage at durable volumes** (the
   default is `os.tmpdir()`-rooted — correct for dev, not for production).
