import { finopsEvents, grants, people, type Db } from "@desiauction/db";
import { fiscalYearOf, isFinopsCapabilitySet, istDateOf } from "@desiauction/financial-operations";
import type { ProfileRow, SeriesRow } from "@desiauction/financial-operations";
import {
  certificationRegisterSnapshot,
  certificationSnapshot,
  complianceQueueSnapshot,
  complianceSnapshot,
  dispatchSnapshot,
  documentSnapshot,
  evidenceRegisterSnapshot,
  followerHealthSnapshot,
  issuanceSnapshot,
  operationsDashboardSnapshot,
  reproduceDocument,
  retrySnapshot,
  runnerHealthSnapshot,
  watermarkSnapshot,
  type CertificationRegisterSnapshot,
  type CertificationSnapshot,
  type ComplianceQueueSnapshot,
  type ComplianceSnapshot,
  type DocumentSnapshot,
  type EvidenceRegisterSnapshot,
  type FinopsDeps,
  type FollowerHealthSnapshot,
  type OperationsDashboardSnapshot,
  type ReceiptCandidate,
  type RetrySnapshot,
  type RunnerHealthSnapshot,
  type WatermarkSnapshot,
} from "@desiauction/financial-operations/server";
import { and, eq, gte, inArray, isNull } from "drizzle-orm";

import { DELIVERY_LANES } from "./deliveries";

/**
 * PX-8 read composition. Every field here is READ from the certified Financial
 * Operations platform — its snapshots (`operationsDashboardSnapshot`,
 * `complianceQueueSnapshot`, `dispatchSnapshot`, `documentSnapshot`,
 * `certificationSnapshot`, `evidenceRegisterSnapshot`, …) and the store rows
 * the writer itself maintains.
 *
 * Nothing is calculated here that the platform does not already calculate: this
 * module GROUPS rows for a screen, joins a dispatch to the job that carries its
 * retry state, and asks the log for TIMING. No accounting rule, no
 * reconciliation rule, no amount is derived. The platform stays the financial
 * authority.
 */

/** The org's fiscal year, in the platform's own reckoning (IST). */
export function currentFy(deps: FinopsDeps): string {
  return fiscalYearOf(istDateOf(deps.now()));
}

// --- The ops board (CTO §1) ---------------------------------------------------------

export interface ActivityLine {
  readonly type: string;
  readonly count: number;
}

export interface CollectionsLine {
  /** Captured payments still awaiting a receipt — the platform's own catch-up view. */
  readonly awaitingReceipt: number;
  /** Documents the register has actually issued. */
  readonly issued: number;
  readonly autoReceipt: boolean;
}

/**
 * The lifecycle's ENTRANCE, as a screen needs it (PX-8 completion).
 *
 * Every field is the platform's: the profile row the writer maintains, the
 * series with the `nextNumber` the platform DERIVES (no numbering happens here),
 * and `receiptCandidates` — captured payments the platform says have no receipt.
 */
export interface IssuanceView {
  readonly profile: ProfileRow | null;
  readonly series: readonly (SeriesRow & { readonly nextNumber: number })[];
  readonly candidates: readonly (ReceiptCandidate & { readonly teamName: string })[];
  readonly autoReceipt: boolean;
  readonly documentsIssued: number;
}

export interface OpsBoardView {
  readonly fy: string;
  readonly dashboard: OperationsDashboardSnapshot;
  readonly queue: ComplianceQueueSnapshot;
  readonly collections: CollectionsLine;
  readonly follower: FollowerHealthSnapshot;
  readonly runner: RunnerHealthSnapshot;
  readonly watermark: WatermarkSnapshot;
  readonly today: readonly ActivityLine[];
  readonly todayTotal: number;
  readonly issuance: IssuanceView;
}

export async function opsBoardView(deps: FinopsDeps, db: Db, orgId: string): Promise<OpsBoardView> {
  const fy = currentFy(deps);
  const [dashboard, queue, issuance, follower, runner, watermark, today, profile] =
    await Promise.all([
      operationsDashboardSnapshot(deps, orgId, fy),
      complianceQueueSnapshot(deps, orgId),
      issuanceSnapshot(deps, orgId),
      followerHealthSnapshot(deps, orgId),
      runnerHealthSnapshot(deps),
      watermarkSnapshot(deps, orgId),
      activitySince(db, orgId, startOfToday(deps)),
      deps.store.loadProfile(orgId),
    ]);
  // Name the parties on the candidates — money joins to names here, nowhere else.
  const candidates = await Promise.all(
    issuance.receiptDue.map(async (candidate) => ({
      ...candidate,
      teamName: (await deps.reference.teamLabel(candidate.teamId)) ?? candidate.teamId,
    })),
  );
  return {
    fy,
    dashboard,
    queue,
    collections: {
      awaitingReceipt: issuance.receiptDue.length,
      issued: issuance.documentsIssued,
      autoReceipt: issuance.autoReceipt,
    },
    follower,
    runner,
    watermark,
    today,
    todayTotal: today.reduce((sum, line) => sum + line.count, 0),
    issuance: {
      profile,
      series: issuance.series,
      candidates,
      autoReceipt: issuance.autoReceipt,
      documentsIssued: issuance.documentsIssued,
    },
  };
}

/** Local midnight — the operator's "today", not UTC's. */
function startOfToday(deps: FinopsDeps): number {
  const now = new Date(deps.now());
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
}

/**
 * "Today's activity" counts the org's own finops EVENTS since local midnight.
 * The log supplies only the timing and the type; nothing is recomputed and no
 * amount is touched.
 */
export async function activitySince(
  db: Db,
  orgId: string,
  sinceMs: number,
): Promise<ActivityLine[]> {
  const rows = await db
    .select({ type: finopsEvents.type })
    .from(finopsEvents)
    .where(and(eq(finopsEvents.orgId, orgId), gte(finopsEvents.atMs, sinceMs)));
  const counts = new Map<string, number>();
  for (const row of rows) {
    counts.set(row.type, (counts.get(row.type) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count || a.type.localeCompare(b.type));
}

// --- The delivery workspace (CTO §2) ------------------------------------------------

export interface DeliveryView {
  readonly dispatchId: string;
  readonly status: string;
  readonly channel: string;
  readonly recipientRef: string;
  readonly templateId: string;
  readonly templateVersion: string;
  readonly subjectRef: string;
  readonly providerRef: string | null;
  readonly failureCode: string | null;
  readonly requestedBy: string;
  /** The job carrying this dispatch's retry state — null once terminal. */
  readonly job: {
    readonly jobId: string;
    readonly state: string;
    readonly attempts: number;
    readonly maxAttempts: number;
    readonly notBeforeMs: number;
    readonly lastError: string | null;
  } | null;
}

export interface DeadJobView {
  readonly jobId: string;
  readonly kind: string;
  readonly dedupeKey: string;
  readonly attempts: number;
  readonly lastError: string | null;
}

export interface DeliveriesView {
  readonly rows: readonly DeliveryView[];
  readonly retries: RetrySnapshot;
  /** Dead jobs WITH their ids — `retrySnapshot` narrows the id away, and the
   * requeue writer needs it. Same store read, nothing new. */
  readonly dead: readonly DeadJobView[];
  readonly counts: Readonly<Record<string, number>>;
}

export async function deliveriesView(deps: FinopsDeps, orgId: string): Promise<DeliveriesView> {
  const jobs = await deps.store.loadJobs(orgId);
  const byDedupe = new Map(jobs.map((job) => [job.dedupeKey, job]));

  const rows: DeliveryView[] = [];
  const counts: Record<string, number> = {};
  for (const lane of DELIVERY_LANES) {
    const dispatches = await deps.store.loadDispatchesByStatus(orgId, lane);
    counts[lane] = dispatches.length;
    for (const dispatch of dispatches) {
      const job = byDedupe.get(`dispatch.send:${dispatch.dispatchId}`) ?? null;
      rows.push({
        dispatchId: dispatch.dispatchId,
        status: dispatch.status,
        channel: dispatch.channel,
        recipientRef: dispatch.recipientRef,
        templateId: dispatch.templateId,
        templateVersion: dispatch.templateVersion,
        subjectRef: dispatch.subjectRef,
        providerRef: dispatch.providerRef,
        failureCode: dispatch.failureCode,
        requestedBy: dispatch.requestedBy,
        job:
          job === null
            ? null
            : {
                jobId: job.jobId,
                state: job.state,
                attempts: job.attempts,
                maxAttempts: job.maxAttempts,
                notBeforeMs: job.notBeforeMs,
                lastError: job.lastError,
              },
      });
    }
  }
  const dead = await deps.store.loadDeadJobs(orgId);
  return {
    rows,
    retries: await retrySnapshot(deps, orgId),
    dead: dead.map((job) => ({
      jobId: job.jobId,
      kind: job.kind,
      dedupeKey: job.dedupeKey,
      attempts: job.attempts,
      lastError: job.lastError,
    })),
    counts,
  };
}

// --- The reconciliation workspace (CTO §3) ------------------------------------------

export interface ReconciliationView {
  readonly fy: string;
  readonly compliance: ComplianceSnapshot;
  readonly queue: ComplianceQueueSnapshot;
  readonly follower: FollowerHealthSnapshot;
  readonly watermark: WatermarkSnapshot;
  /** A FRESH certification, double-derived by the platform. Null = nondeterministic. */
  readonly certification: CertificationSnapshot | null;
  readonly register: CertificationRegisterSnapshot;
  readonly evidence: EvidenceRegisterSnapshot;
}

export async function reconciliationView(
  deps: FinopsDeps,
  orgId: string,
): Promise<ReconciliationView> {
  const fy = currentFy(deps);
  const [compliance, queue, follower, watermark, certification, register, evidence] =
    await Promise.all([
      complianceSnapshot(deps, orgId, fy),
      complianceQueueSnapshot(deps, orgId),
      followerHealthSnapshot(deps, orgId),
      watermarkSnapshot(deps, orgId),
      certificationSnapshot(deps, orgId),
      certificationRegisterSnapshot(deps, orgId),
      evidenceRegisterSnapshot(deps, orgId),
    ]);
  return { fy, compliance, queue, follower, watermark, certification, register, evidence };
}

// --- The documents register + operations detail (CTO §4) ----------------------------

export interface RegisterRow {
  readonly docId: string;
  readonly number: number;
  readonly kind: string;
  readonly partyLabel: string;
  readonly amount: number;
  readonly corrects: string | null;
  readonly sourceRef: string | null;
  readonly contentDigest: string;
  readonly seriesId: string;
}

/** The org's whole documents register, newest series first. */
export async function registerView(deps: FinopsDeps, orgId: string): Promise<RegisterRow[]> {
  const rows: RegisterRow[] = [];
  for (const seriesId of await deps.store.listStreamIds(orgId, "series")) {
    for (const document of await deps.store.loadDocuments(seriesId)) {
      rows.push({
        docId: document.docId,
        number: document.number,
        kind: document.kind,
        partyLabel: document.partyLabel,
        amount: document.amount,
        corrects: document.corrects,
        sourceRef: document.sourceRef,
        contentDigest: document.contentDigest,
        seriesId,
      });
    }
  }
  return rows.sort((a, b) => b.docId.localeCompare(a.docId));
}

export interface TimelineEntry {
  readonly seq: number;
  readonly atMs: number;
  readonly type: string;
  readonly actor: string;
  readonly stream: string;
}

export interface DocumentDetailView {
  readonly snapshot: DocumentSnapshot;
  /** What the document says it was made FROM — the settlement reference. */
  readonly settlement: {
    readonly sourceRef: string | null;
    readonly watermark: Readonly<Record<string, number>>;
    readonly profileSeq: number;
  };
  readonly deliveries: readonly DeliveryView[];
  readonly timeline: readonly TimelineEntry[];
}

/**
 * One document, end to end: the certified snapshot (with its LIVE reproduction
 * verdict), the settlement facts it pinned at issue, every delivery attempted
 * for it, and the audit timeline of the streams that touched it.
 */
export async function documentDetailView(
  deps: FinopsDeps,
  orgId: string,
  docId: string,
): Promise<DocumentDetailView | null> {
  const snapshot = await documentSnapshot(deps, docId);
  // Existence privacy: another org's document is indistinguishable from none.
  if (snapshot === null || snapshot.document.orgId !== orgId) {
    return null;
  }
  const document = snapshot.document;

  // Every dispatch whose subject is this document, across all four lanes.
  const deliveries: DeliveryView[] = [];
  const jobs = await deps.store.loadJobs(orgId);
  const byDedupe = new Map(jobs.map((job) => [job.dedupeKey, job]));
  const subject = `doc:${docId}`;
  for (const lane of DELIVERY_LANES) {
    for (const dispatch of await deps.store.loadDispatchesByStatus(orgId, lane)) {
      if (dispatch.subjectRef !== subject) {
        continue;
      }
      const job = byDedupe.get(`dispatch.send:${dispatch.dispatchId}`) ?? null;
      deliveries.push({
        dispatchId: dispatch.dispatchId,
        status: dispatch.status,
        channel: dispatch.channel,
        recipientRef: dispatch.recipientRef,
        templateId: dispatch.templateId,
        templateVersion: dispatch.templateVersion,
        subjectRef: dispatch.subjectRef,
        providerRef: dispatch.providerRef,
        failureCode: dispatch.failureCode,
        requestedBy: dispatch.requestedBy,
        job:
          job === null
            ? null
            : {
                jobId: job.jobId,
                state: job.state,
                attempts: job.attempts,
                maxAttempts: job.maxAttempts,
                notBeforeMs: job.notBeforeMs,
                lastError: job.lastError,
              },
      });
    }
  }

  // The audit timeline: the series events that name this document, plus every
  // event on each of its dispatch streams. The log, ordered by when.
  const timeline: TimelineEntry[] = [];
  for (const event of await deps.store.loadStream("series", document.seriesId)) {
    if (event.payload["docId"] === docId) {
      timeline.push({
        seq: event.seq,
        atMs: event.atMs,
        type: event.type,
        actor: event.actor,
        stream: "series",
      });
    }
  }
  for (const delivery of deliveries) {
    for (const event of await deps.store.loadStream("dispatch", delivery.dispatchId)) {
      timeline.push({
        seq: event.seq,
        atMs: event.atMs,
        type: event.type,
        actor: event.actor,
        stream: "dispatch",
      });
    }
  }
  timeline.sort((a, b) => a.atMs - b.atMs || a.seq - b.seq);

  return {
    snapshot,
    settlement: {
      sourceRef: document.sourceRef,
      watermark: document.watermark,
      profileSeq: document.profileSeq,
    },
    deliveries,
    timeline,
  };
}

/** Re-export so screens never reach past this module into the platform. */
export { reproduceDocument, dispatchSnapshot };

// --- Finance authority ---------------------------------------------------------------

export interface FinanceGrantRow {
  readonly grantId: string;
  readonly personId: string;
  readonly name: string | null;
  readonly phone: string;
  readonly capabilitySet: string;
  /** Who handed this role over — provenance the table has always stored. */
  readonly grantedByName: string | null;
  /** When they handed it over (ISO). */
  readonly grantedAt: string | null;
}

/**
 * The org's ACTIVE finance grants. Like settlement's (PX-7), these are ordinary
 * rows in identity's `grants` table whose set names a FINOPS set — a read over
 * identity's storage, filtered to the vocabulary this engine recognises.
 *
 * Without this surface the finance workspace is unreachable from the product:
 * the frozen grants UI offers only frozen sets, and the settlement panel only
 * settlement sets. This is the third partition's door.
 */
export async function financeGrantsOf(db: Db, orgId: string): Promise<FinanceGrantRow[]> {
  const rows = await db
    .select({
      grantId: grants.id,
      personId: grants.personId,
      name: people.name,
      phone: people.phone,
      capabilitySet: grants.capabilitySet,
      grantedBy: grants.grantedBy,
      grantedAt: grants.createdAt,
    })
    .from(grants)
    .innerJoin(people, eq(people.id, grants.personId))
    .where(and(eq(grants.scopeType, "org"), eq(grants.scopeId, orgId), isNull(grants.revokedAt)));
  const mine = rows.filter((row) => isFinopsCapabilitySet(row.capabilitySet));
  // Granter names in one extra read rather than a second join onto `people`:
  // the alias would make drizzle infer the row shape away entirely.
  const granterNames = await namesOf(
    db,
    mine.map((row) => row.grantedBy),
  );
  return mine
    .map((row) => ({
      grantId: row.grantId,
      personId: row.personId,
      name: row.name,
      phone: row.phone,
      capabilitySet: row.capabilitySet,
      grantedByName: granterNames.get(row.grantedBy) ?? null,
      grantedAt: isoOf(row.grantedAt),
    }))
    .sort((a, b) => (a.name ?? a.phone).localeCompare(b.name ?? b.phone));
}

/** id -> display name, for the handful of ids a grant list points at. */
async function namesOf(db: Db, ids: readonly string[]): Promise<Map<string, string | null>> {
  const unique = [...new Set(ids.filter((id) => id !== ""))];
  if (unique.length === 0) {
    return new Map();
  }
  const rows = await db
    .select({ id: people.id, name: people.name })
    .from(people)
    .where(inArray(people.id, unique));
  return new Map(rows.map((row) => [row.id, row.name]));
}

function isoOf(value: Date | string | null): string | null {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
