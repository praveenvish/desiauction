# FINANCIAL OPERATIONS EVENT CATALOG

## DesiAuction NEXT · v1.0 · 2026-07-16 · CTO · **FROZEN** (IP-6 freeze)

> The complete, **closed** set of financial-operations events. Source of
> truth: `packages/financial-operations/src/events.ts` (`FINOPS_EVENT_TYPES`),
> the five reducers (`replayProfile`, `replaySeries`, `replayDispatch`,
> `replayExport`, `replayPeriod`). Envelope, persisted in `finops_events`
> (append-only): `stream_type` (`profile`|`series`|`dispatch`|`export`|
> `period`) · `stream_id` (ULID) · `seq` (per-stream total order, dense
> from 1) · `type` · `at_ms` (injected server epoch ms) · `actor` (person ULID
> or the system sentinel) · `correlation_id` · `command_id` (idempotency key) ·
> `payload` · `org_id`. Unique `(stream_type, stream_id, seq)` is the
> single-writer proof; unique `(stream_type, stream_id, command_id)` is
> idempotency. **Every monetary value in any payload is a QUOTED settlement
> fact** (integer paise, provenance-pinned) — nothing here is calculated.
> Every reducer fails closed (`unknown_event_type`) on anything not below.

**23 event types. The set is FROZEN — it never grew across four milestones.
Adding a type is an ADR (a thaw).**

## Profile stream (`profile:{orgId}`) — 3 types

| Event | Emitted by | Payload (summary) | Replay effect |
|---|---|---|---|
| `ProfileDeclared` | `declareProfile` | orgId, legalName, posture (`none`\|`gst-registered`), gstin? (shape-validated iff registered), autoReceipt | profile v1 active |
| `ProfileAmended` | `amendProfile` | delta + mandatory reason (the RESULT is re-validated) | profile advanced; documents pin `profileSeq`, so history stays addressable |
| `ProfileRecovered` | `recoverProfile` | divergences, eventCount | — (recovery IS the replay) |

## Series stream (`series:{seriesId}`) — 5 types

One numbering lane per **org · kind · fiscal year, forever** (schema-unique).

| Event | Emitted by | Payload (summary) | Replay effect |
|---|---|---|---|
| `SeriesOpened` | `openSeries` | seriesId, orgId, kind (`receipt`\|`tax-invoice`\|`correction`), fy, prefix | lane open; next number = 1 |
| `DocumentIssued` | `issueReceipt` / `issueInvoice` (M-IP6-2) · auto-receipt policy (follower, derived command id) | docId, number (dense = fold order), party {type,id,label snapshot}, lines [{description, amount, provenance{stream,seq}}], amount (= kernel sum of lines), sourceRef, profileSeq, watermark, contentDigest (digest of the canonical rendered payload — the bytes re-derive from pinned sources forever), tax? (validated for exact recomposition; **no command emits one** — GST decomposition unshipped, posture-gated) | document registered; `number_gap` · `duplicate_document_source` · `watermark_regression` · `decomposition_mismatch` unfoldable |
| `CorrectionIssued` | `issueCorrection` (M-IP6-2) | as DocumentIssued + corrects (docId), reason — lawful only in `correction` lanes; causes are compensating settlement facts (`PaymentRefunded`, `ObligationWaived`) only | correction registered; original untouched forever |
| `SeriesClosed` | `closeSeries` | count (= issued count), registerDigest | lane terminal |
| `SeriesRecovered` | `recoverSeries` | divergences, eventCount | — |

## Dispatch stream (`dispatch:{dispatchId}`) — 5 types

One aggregate per delivery attempt (the frozen Payment pattern). Terminal
means terminal: retry = a NEW dispatch.

| Event | Emitted by | Payload (summary) | Replay effect |
|---|---|---|---|
| `DispatchRequested` | `requestDispatch` (human) · issuance flows | dispatchId, orgId, channel (`in-app`\|`email`\|`whatsapp`\|`org-webhook`), recipientRef, templateId+version, subjectRef (`doc:{docId}` or `notice:*`) | → `requested`; the send pipeline discovers it by scan |
| `DispatchSent` | send pipeline (derived command id `dispatch:{id}:send`) | providerRef | → `sent` |
| `DispatchConfirmed` | provider callback (`provider:{eventRef}`) · synchronous channels (`dispatch:{id}:confirm`) · `confirmDispatchManually` (**manual sentinel** `manual:{commandId}` — never masquerades as provider truth) | providerEventRef | → `confirmed` (terminal) |
| `DispatchFailed` | send pipeline (permanent rejection · `retries_exhausted:{code}` · `channel_unconfigured` · `document_not_reproducible`) · provider callback · `cancelDispatch` (code `cancelled`) | code, detail? | → `failed` (terminal) |
| `DispatchRecovered` | `recoverDispatch` | divergences, eventCount | — |

Transient provider attempts are NOT events: they are audited breadcrumbs
(`finops.DispatchAttemptFailed`, eventSeq 0) plus deterministic job retries —
the aggregate transitions only on outcomes.

## Export stream (`export:{exportId}`) — 4 types

| Event | Emitted by | Payload (summary) | Replay effect |
|---|---|---|---|
| `ExportRequested` | `requestExport` (human) · `requestExportSystem` (daily export, derived id) | exportId, orgId, kind (`tally-xml`\|`journal-csv`\|`gstr1-json`\|`audit-bundle`\|`archive-bundle`), params | → `requested`; the generation pipeline discovers it by scan |
| `ExportCompleted` | generation pipeline (`export:{id}:complete`) after gather → reproduce-every-document → build → store → **read-back verify** | artifactRef, artifactDigest (the truth; artifacts are disposable), rowCount, watermark | → `completed` (terminal) |
| `ExportFailed` | generation pipeline (e.g. `document_not_reproducible:{docId}` — an unverifiable document poisons no archive) | code, detail? | → `failed` (terminal; retry = new run with `retryOf` in params) |
| `ExportRecovered` | `recoverExport` | divergences, eventCount | — |

## Period stream (`period:{periodId}`) — 6 types

One period per **org · fiscal year, forever** (schema-unique); reopen
re-enters the same aggregate.

| Event | Emitted by | Payload (summary) | Replay effect |
|---|---|---|---|
| `PeriodOpened` | `openPeriod` | periodId, orgId, fy, openingWatermark | → `open`; `openedDate` (from the recorded clock) starts close coverage — mid-year adoption is sealable |
| `DayAttested` | daily-ops run (system sentinel, derived id) · `attestDay` (human) | date (in-FY), checks [{name, outcome, detail?}] (the 8-check operational checklist), watermark (monotonic) | latest attestation per date governs; **the sentinel cannot attest a red or burdened day — replay-enforced**; a HUMAN attestation acknowledges the day's prior exceptions |
| `ExceptionNoted` | daily-ops run (one per red check, kind-mapped) · `noteException` (human) | date, kind (closed set: `sweep-mismatch`·`verification-failure`·`late-upstream-event`·`dispatch-dlq`·`export-failure`·`follower-stall`·`manual`), detail, sourceRef? | open until a human attests the day at a later seq; blocks auto-attestation AND close |
| `PeriodClosed` | `closePeriod` (guards: FY fully elapsed · coverage from openedDate · zero open exceptions · watermark current · `period_advanced_retry` race guard) | closingWatermark, **evidence v2**: attestationDigest, daysAttested, exceptionCount, documents {series pins (seriesId, eventCount, documents, registerDigest), total}, exports {run pins, registerDigest, completed}, dispatch tally (quoted telemetry), periodEventCount | → `closed`; `reproduceFiscalEvidence` re-folds the pinned prefixes byte-identically, forever — across reopens |
| `PeriodReopened` | `reopenPeriod` (**override**) | reason, compensates (the close seq) | → `open`; the seal's history stays; a re-close seals fresh evidence |
| `PeriodRecovered` | `recoverPeriod` | divergences, eventCount | — |

## Coordination (deterministic, scan-based, derived command ids)

`PaymentCaptured` (observed) → auto-receipt when `profile.autoReceipt`
(`settlement:payment:{id}:{captureSeq}:auto-receipt`; the receipt-due
candidate list IS the crash catch-up) · requested dispatch → send job
(`dispatch.send:{id}`) · requested export → generation job
(`export.generate:{id}`) · daily-ops slot → attest-day + daily-export jobs
(occasion-keyed) · year-end slot → readiness verification (appends nothing).
Re-running any of it after a crash re-derives the identical command and the
duplicate returns its original ack.

## Closed fail-closed replay reasons

`sequence_gap` · `unknown_event_type` · `illegal_replayed_transition` ·
`malformed_profile` · `malformed_series` · `malformed_document` ·
`malformed_dispatch` · `malformed_export` · `malformed_period` ·
`unknown_profile` · `unknown_series` · `unknown_document` ·
`unknown_dispatch` · `unknown_export` · `unknown_period` · `number_gap` ·
`duplicate_document_source` · `decomposition_mismatch` ·
`watermark_regression`.

**Certified (IP-6 freeze):** reordered, gapped, forged-type, forged-money,
number-gapped, duplicate-source, watermark-regressing and off-catalog events
all fail closed; a concurrent duplicate `(stream, seq)` is rejected by the
unique index; every projection tamper halts and heals byte-identical from the
log; a self-consistent FORGED document folds but is unmasked by reproduction
(no honest re-render agrees with a dishonest figure). See
[IP-6_FREEZE](IP-6_FREEZE.md) §2.
