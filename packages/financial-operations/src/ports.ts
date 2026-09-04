/**
 * Ports (IP-6_ARCHITECTURE §5/§13). The domain declares the shapes it needs;
 * the server tier implements them. No driver, no SQL and no provider SDK may
 * cross this file.
 *
 * THE LOAD-BEARING ABSENCE: `SettlementSourcePort` has no write operation, so
 * no finops code path can express a settlement mutation even by accident —
 * settlement history enters financial operations as read-only envelopes and
 * leaves as nothing (the frozen AuctionSourcePort precedent, one platform up).
 */

import type { SettlementEventEnvelope } from "@desiauction/settlement";

import type { DispatchChannel, DispatchStatus } from "./dispatch";
import type { ExportKind, ExportStatus } from "./export-run";
import type { FinopsEventEnvelope, FinopsStreamType } from "./events";
import type { JobKind, JobState, ScheduleSlot } from "./runner";
import type { PeriodStatus } from "./period";
import type { SeriesKind, SeriesStatus } from "./series";
import type { TaxPosture } from "./profile";
import type { Watermark } from "./watermark";

export type DigestFn = (bytes: string) => string;

// --- Frozen settlement, as financial operations is allowed to see it ----------------

export interface SettlementStreamHead {
  readonly streamType: string;
  readonly streamId: string;
  readonly headSeq: number;
}

/** A captured payment surfaced for issuance DISCOVERY (M-IP6-2). Discovery may
 * read the settlement projection (a verified-upstream convenience, §12);
 * every issuance DECISION re-derives from the event fold. */
export interface CapturedPaymentRef {
  readonly paymentId: string;
  readonly caseId: string;
  readonly teamId: string;
}

/** READ-ONLY by construction — no write method exists here, ever. */
export interface SettlementSourcePort {
  listOrgStreamHeads(orgId: string): Promise<readonly SettlementStreamHead[]>;
  loadEventsFrom(
    streamType: string,
    streamId: string,
    fromSeq: number,
  ): Promise<readonly SettlementEventEnvelope[]>;
  /** Captured payments for an org — receipt-due discovery input (M-IP6-2). */
  listCapturedPayments(orgId: string): Promise<readonly CapturedPaymentRef[]>;
  /** Open (`created`) payments with their ages — reconciliation SUPERVISION
   * input (M-IP6-4): a stale open payment signals the settlement-owned expiry
   * sweep is not being run. Discovery only; never a decision input. */
  listOpenPayments(orgId: string): Promise<readonly { paymentId: string; createdAtMs: number }[]>;
}

/** Org enumeration for the runner's per-org iteration (the sweep pattern). */
export interface OrgDirectoryPort {
  listOrgIds(): Promise<readonly string[]>;
}

/** Reference labels for party SNAPSHOTS at issue (M-IP6-2) — read-only. */
export interface ReferencePort {
  teamLabel(teamId: string): Promise<string | null>;
}

// --- Delivery & artifact ports (M-IP6-3) ---------------------------------------------
//
// The IP-5 PaymentGatewayPort doctrine on the delivery plane: the domain owns
// the port shapes; adapters live at the edge; NO provider SDK type may cross
// this file. Every provider RESPONSE becomes either an immutable event (a
// lifecycle transition) or an audited retry attempt — never a silent guess.

/** What a channel is asked to deliver: the REPRODUCED document bytes (or a
 * canonical notice), never regenerated business content. */
export interface DeliveryRequest {
  readonly dispatchId: string;
  readonly orgId: string;
  readonly channel: DispatchChannel;
  readonly recipientRef: string;
  readonly templateId: string;
  readonly templateVersion: string;
  readonly subjectRef: string;
  /** The canonical payload bytes being delivered. */
  readonly body: string;
  /** The digest of `body` — carried so providers/outboxes can seal what they got. */
  readonly bodyDigest: string;
  /**
   * A key the PROVIDER can deduplicate on, stable across every attempt at this
   * dispatch (audit PA-1 §16).
   *
   * The send is at-least-once and cannot be made otherwise here. `runDispatchSend`
   * calls the provider and only then commits the `sent` transition, so a crash
   * in between leaves the dispatch `requested` and the retry sends again.
   *
   * REVERSING THE ORDER DOES NOT FIX IT, it only chooses a different failure:
   * commit first and a crash before the call records a document as sent that
   * nobody received — silent non-delivery, which this platform treats as the
   * cardinal sin (see the email adapter on the filesystem outbox that "reported
   * Succeeded for a file on a disk nobody reads"). Adding a `sending` state to
   * the frozen machine relocates the same dilemma rather than resolving it: the
   * retry still cannot know whether the provider received the call.
   *
   * Two generals. The only party that can settle it is the provider, so we give
   * it what it needs to: one key per dispatch, identical on every retry. A
   * provider that honours it makes delivery effectively-once; one that ignores
   * it behaves exactly as before, so this is never worse.
   */
  readonly idempotencyKey: string;
}

export type DeliverySendResult =
  | {
      readonly ok: true;
      readonly providerRef: string;
      /** Channels with synchronous delivery truth (in-app, outbox) confirm inline. */
      readonly confirmed?: { readonly providerEventRef: string };
    }
  | { readonly ok: false; readonly code: string; readonly retryable: boolean };

/** A verified provider callback (async channels), resolved by the adapter. */
export type DeliveryCallback =
  | {
      readonly ok: true;
      readonly dispatchId: string;
      readonly providerEventRef: string;
      readonly kind: "delivered" | "failed";
      readonly code?: string;
    }
  | { readonly ok: false; readonly reason: string };

export interface DeliveryPort {
  readonly channel: DispatchChannel;
  send(request: DeliveryRequest): Promise<DeliverySendResult>;
  /** Verify + parse a raw provider callback. Absent on synchronous channels. */
  verifyCallback?(raw: string): DeliveryCallback;
}

/** Content-addressed-ish artifact storage. Artifacts are DISPOSABLE (ADR-9):
 * the digest sealed in the export event is the truth; a lost or corrupted
 * artifact is regenerated from sources, never trusted. */
export interface ArtifactStorePort {
  put(key: string, bytes: string): Promise<{ ref: string }>;
  get(ref: string): Promise<string | null>;
}

// --- Projection rows (plain data; the store maps them to storage) -------------------

export interface ProfileRow {
  readonly orgId: string;
  readonly legalName: string;
  readonly posture: TaxPosture;
  readonly gstin: string | null;
  readonly autoReceipt: boolean;
  readonly version: number;
  readonly declaredBy: string;
}

export interface SeriesRow {
  readonly seriesId: string;
  readonly orgId: string;
  readonly kind: SeriesKind;
  readonly fy: string;
  readonly prefix: string;
  readonly status: SeriesStatus;
  readonly documentCount: number;
  readonly registerDigest: string | null;
}

export interface DocumentRow {
  readonly docId: string;
  readonly orgId: string;
  readonly seriesId: string;
  readonly number: number;
  readonly kind: SeriesKind;
  readonly partyType: string;
  readonly partyId: string;
  readonly partyLabel: string;
  readonly amount: number;
  readonly corrects: string | null;
  readonly sourceRef: string | null;
  readonly profileSeq: number;
  readonly watermark: Watermark;
  readonly contentDigest: string;
  readonly issuedAtSeq: number;
  readonly issuedBy: string;
}

export interface DispatchRow {
  readonly dispatchId: string;
  readonly orgId: string;
  readonly status: DispatchStatus;
  readonly channel: DispatchChannel;
  readonly recipientRef: string;
  readonly templateId: string;
  readonly templateVersion: string;
  readonly subjectRef: string;
  readonly providerRef: string | null;
  readonly providerEventRef: string | null;
  readonly failureCode: string | null;
  readonly requestedBy: string;
}

export interface ExportRow {
  readonly exportId: string;
  readonly orgId: string;
  readonly status: ExportStatus;
  readonly kind: ExportKind;
  readonly params: Readonly<Record<string, unknown>>;
  readonly requestedBy: string;
  readonly artifactRef: string | null;
  readonly artifactDigest: string | null;
  readonly rowCount: number | null;
  readonly watermark: Watermark | null;
  readonly failureCode: string | null;
}

export interface PeriodRow {
  readonly periodId: string;
  readonly orgId: string;
  readonly fy: string;
  readonly status: PeriodStatus;
  readonly openedBy: string;
  readonly openingWatermark: Watermark;
  readonly lastWatermark: Watermark;
  readonly evidence: Readonly<Record<string, unknown>> | null;
  readonly closedAtSeq: number | null;
  readonly openExceptions: number;
}

export interface PeriodDayRow {
  readonly periodId: string;
  readonly orgId: string;
  readonly date: string;
  readonly attestor: string;
  readonly attestorKind: "system" | "human";
  readonly failures: number;
  readonly checks: readonly Readonly<Record<string, unknown>>[];
  readonly watermark: Watermark;
  readonly attestedAtSeq: number;
}

export interface CursorRow {
  readonly orgId: string;
  readonly streamType: string;
  readonly streamId: string;
  readonly lastSeq: number;
  readonly updatedAtMs: number;
}

export interface JobRow {
  readonly jobId: string;
  readonly orgId: string;
  readonly kind: JobKind;
  readonly dedupeKey: string;
  readonly state: JobState;
  readonly attempts: number;
  readonly maxAttempts: number;
  readonly notBeforeMs: number;
  readonly leasedUntilMs: number | null;
  readonly lastError: string | null;
  readonly payload: Readonly<Record<string, unknown>>;
}

export interface ScheduleRow {
  readonly slot: ScheduleSlot;
  readonly nextDueMs: number;
  readonly lastFiredMs: number | null;
}

// --- The unit of work ----------------------------------------------------------------

export interface FinopsAppendInput {
  readonly orgId: string;
  readonly streamType: FinopsStreamType;
  readonly streamId: string;
  readonly type: string;
  readonly atMs: number;
  readonly actor: string;
  readonly correlationId: string;
  readonly commandId: string;
  readonly payload: Readonly<Record<string, unknown>>;
}

export interface FinopsAuditInput {
  readonly actor: string;
  readonly action: string;
  readonly orgId: string;
  readonly subject: string;
  readonly source: string;
  readonly correlationId: string;
  readonly eventSeq: number;
  readonly reason?: string;
}

/**
 * Every finops mutation is exactly one of these: the event, its audit row and
 * its projection rows commit together or not at all (invariant 28).
 */
export interface FinopsTx {
  appendEvent(input: FinopsAppendInput): Promise<number>;
  writeAudit(input: FinopsAuditInput): Promise<void>;
  putProfile(row: ProfileRow): Promise<void>;
  putSeries(row: SeriesRow): Promise<void>;
  /** Replaces the series' document register wholesale — projections are disposable. */
  putDocuments(seriesId: string, rows: readonly DocumentRow[]): Promise<void>;
  putDispatch(row: DispatchRow): Promise<void>;
  putExport(row: ExportRow): Promise<void>;
  putPeriod(row: PeriodRow): Promise<void>;
  putPeriodDays(periodId: string, rows: readonly PeriodDayRow[]): Promise<void>;
  putCursor(row: CursorRow): Promise<void>;
  /** Recovery's eraser: the rewind that makes every consumption re-derivable. */
  deleteCursors(orgId: string): Promise<void>;
  /** Idempotent by (orgId, dedupeKey): returns false when the job already exists. */
  enqueueJob(row: JobRow): Promise<boolean>;
  /**
   * Write a job's new state.
   *
   * `fenceLeasedUntilMs` is the lease the caller CLAIMED with. Supplied, the
   * write only lands while that lease is still the row's — so a worker whose
   * lease expired mid-job cannot overwrite the state of the worker that
   * reclaimed it (audit PA-1 §16). Returns whether the write matched; false
   * means "someone else owns this job now", which is not an error, just a
   * result this worker must not act on.
   */
  updateJob(row: JobRow, fenceLeasedUntilMs?: number | null): Promise<boolean>;
  putSchedule(row: ScheduleRow): Promise<void>;
}

export interface FinopsStore {
  transact<T>(fn: (tx: FinopsTx) => Promise<T>): Promise<T>;
  loadStream(
    streamType: FinopsStreamType,
    streamId: string,
  ): Promise<readonly FinopsEventEnvelope[]>;
  findByCommandId(
    streamType: FinopsStreamType,
    streamId: string,
    commandId: string,
  ): Promise<FinopsEventEnvelope | null>;
  /** Distinct stream ids for an org — recovery's enumeration input. */
  listStreamIds(orgId: string, streamType: FinopsStreamType): Promise<readonly string[]>;
  loadProfile(orgId: string): Promise<ProfileRow | null>;
  loadSeries(seriesId: string): Promise<SeriesRow | null>;
  /** ANY series for org · kind · fy — one numbering lane per key, forever. */
  loadSeriesFor(orgId: string, kind: SeriesKind, fy: string): Promise<SeriesRow | null>;
  loadDocuments(seriesId: string): Promise<readonly DocumentRow[]>;
  /** One document by id, across series (M-IP6-2 — correction linkage reads). */
  loadDocument(docId: string): Promise<DocumentRow | null>;
  loadDispatch(dispatchId: string): Promise<DispatchRow | null>;
  loadExport(exportId: string): Promise<ExportRow | null>;
  loadPeriod(periodId: string): Promise<PeriodRow | null>;
  /** The period for org · fy — one per key, forever (reopen re-enters it). */
  loadPeriodFor(orgId: string, fy: string): Promise<PeriodRow | null>;
  loadPeriodDays(periodId: string): Promise<readonly PeriodDayRow[]>;
  /** Dispatches in a lifecycle state — the send pipeline's scan input (M-IP6-3). */
  loadDispatchesByStatus(orgId: string, status: DispatchStatus): Promise<readonly DispatchRow[]>;
  /** An org's export runs — pipeline scans and archive views (M-IP6-3). */
  loadExportsByOrg(orgId: string): Promise<readonly ExportRow[]>;
  /*
   * DISCOVERY, ACROSS EVERY TENANT, IN ONE ROUND TRIP.
   *
   * The enqueue pass asks "what work is waiting anywhere?". It used to answer
   * that by enumerating every organization and querying each one — a cost that
   * grew with the number of TENANTS rather than the amount of WORK, so an org
   * that has never sent a document still cost a query on every tick. These two
   * read the same rows with one indexed scan on `status`.
   *
   * Cross-tenant by design, exactly like the `listOrgIds()` sweep they replace:
   * the runner's directory, source and store all share one handle (`deps.ts`),
   * and enumerating organizations was always the wider read. Per-org scanning
   * stays available above for the surfaces that genuinely want one tenant.
   */
  listRequestedDispatches(): Promise<readonly { dispatchId: string; orgId: string }[]>;
  listRequestedExports(): Promise<readonly { exportId: string; orgId: string }[]>;
  loadCursors(orgId: string): Promise<readonly CursorRow[]>;
  /** Claim due queued jobs (and expired leases) — SKIP LOCKED semantics. An
   * `orgId` scopes the claim to one tenant (per-org draining, the sharding
   * seam; the production tick drains globally). */
  claimJobs(
    nowMs: number,
    leaseMs: number,
    limit: number,
    orgId?: string,
  ): Promise<readonly JobRow[]>;
  loadJobs(orgId: string): Promise<readonly JobRow[]>;
  loadDeadJobs(orgId: string): Promise<readonly JobRow[]>;
  countJobs(): Promise<Readonly<Record<JobState, number>>>;
  loadSchedules(): Promise<readonly ScheduleRow[]>;
  /** Operational audit breadcrumbs (append-only substrate, read-only) — the
   * certification register's input (M-IP6-4). */
  loadAuditBreadcrumbs(
    orgId: string,
    action: string,
  ): Promise<readonly { readonly atMs: number; readonly reason: string | null }[]>;
  /**
   * Does this org have ANY breadcrumb of this action? Existence only.
   *
   * `loadAuditBreadcrumbs` returns the whole history, which is the right shape
   * for the register that renders it and the wrong one for a question asked on
   * every runner tick — the history grows by a row a day for ever, and the
   * runner only wants to know whether the first one exists yet.
   */
  hasAuditBreadcrumb(orgId: string, action: string): Promise<boolean>;
}
