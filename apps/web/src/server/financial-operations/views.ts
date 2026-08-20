import {
  finopsEvents,
  finopsJobs,
  grants,
  payments,
  people,
  teams,
  type Db,
} from "@desiauction/db";
import {
  fiscalYearOf,
  formattedNumber,
  isFinopsCapabilitySet,
  istDateOf,
} from "@desiauction/financial-operations";
import type { ProfileRow, SeriesRow } from "@desiauction/financial-operations";
import {
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
import { and, eq, gte, inArray, isNull, sql } from "drizzle-orm";

import { DELIVERY_LANES } from "./deliveries";

/**
 * PX-8 read composition. Every field here is READ from the certified Financial
 * Operations platform — its snapshots (`operationsDashboardSnapshot`,
 * `complianceQueueSnapshot`, `dispatchSnapshot`, `documentSnapshot`,
 * `evidenceRegisterSnapshot`, …) and the store rows the writer itself
 * maintains. Note `certificationSnapshot` is deliberately NOT among them —
 * it writes an audit row, so it cannot be part of a read. See `certifications`
 * on ReconciliationView.
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
  /**
   * `ReceiptCandidate` carries no amount, so the desk asked an operator to
   * issue a receipt against a truncated payment id and a team name without ever
   * showing how much it was for. The figure is settlement's, read here.
   */
  readonly candidates: readonly (ReceiptCandidate & {
    readonly teamName: string;
    readonly capturedPaise: number | null;
  })[];
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
  /** This org's queue. Prefer this over `runner.jobs`, which is platform-wide. */
  readonly jobs: OrgJobs;
  readonly watermark: WatermarkSnapshot;
  readonly today: readonly ActivityLine[];
  readonly todayTotal: number;
  readonly issuance: IssuanceView;
}

export async function opsBoardView(deps: FinopsDeps, db: Db, orgId: string): Promise<OpsBoardView> {
  const fy = currentFy(deps);
  const [dashboard, queue, issuance, follower, runner, watermark, today, profile, jobs] =
    await Promise.all([
      operationsDashboardSnapshot(deps, orgId, fy),
      complianceQueueSnapshot(deps, orgId),
      issuanceSnapshot(deps, orgId),
      followerHealthSnapshot(deps, orgId),
      runnerHealthSnapshot(deps),
      watermarkSnapshot(deps, orgId),
      activitySince(db, orgId, startOfToday(deps)),
      deps.store.loadProfile(orgId),
      orgJobs(deps, db, orgId),
    ]);
  // Name the parties on the candidates — money joins to names here, nowhere
  // else — and carry the amount so "issue a receipt" states what for.
  const capturedByPayment = await capturedOf(
    db,
    issuance.receiptDue.map((candidate) => candidate.paymentId),
  );
  const candidates = await Promise.all(
    issuance.receiptDue.map(async (candidate) => ({
      ...candidate,
      teamName: (await deps.reference.teamLabel(candidate.teamId)) ?? candidate.teamId,
      capturedPaise: capturedByPayment.get(candidate.paymentId) ?? null,
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
    jobs,
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

/**
 * This organization's own job queue.
 *
 * The desk used to print `runnerHealthSnapshot(deps).jobs`, which wraps
 * `store.countJobs()` — a count with no `WHERE` clause and no orgId parameter.
 * Every tenant was therefore shown the PLATFORM's queue as if it were theirs:
 * demo-club owns 5 jobs and the page said "1192 queued", the total across 327
 * organizations. A five-minute-old org with nothing in it said 1192 too.
 *
 * `oldestQueuedMs` is the fact that actually discloses a dead runner. Runner
 * health upstream is `dead === 0` with no queue-depth or job-age test, so a
 * runner that is completely down reports HEALTHY — it cannot produce dead jobs
 * if it never runs. Measured live: 1192 queued, oldest 9 days, 0 dead, verdict
 * "healthy". Age is the disclosing number, so we read it here and show it.
 *
 * Fixing `countJobs` itself means thawing IP-6; scoping the read does not.
 */
export interface OrgJobs {
  readonly queued: number;
  readonly dead: number;
  /**
   * How long the longest-waiting queued job has been waiting, in ms, or null
   * when nothing waits. Resolved HERE against the injected clock rather than
   * shipped as a timestamp for the panel to subtract from `Date.now()`: the
   * panel is a client component, so that would render one number on the server
   * and a different one in the browser.
   */
  readonly oldestQueuedWaitMs: number | null;
}

async function orgJobs(deps: FinopsDeps, db: Db, orgId: string): Promise<OrgJobs> {
  const [row] = await db
    .select({
      queued: sql<number>`count(*) filter (where ${finopsJobs.state} = 'queued')::int`,
      dead: sql<number>`count(*) filter (where ${finopsJobs.state} = 'dead')::int`,
      oldestQueuedMs: sql<
        number | null
      >`min(${finopsJobs.notBeforeMs}) filter (where ${finopsJobs.state} = 'queued')`,
    })
    .from(finopsJobs)
    .where(eq(finopsJobs.orgId, orgId));
  const oldest = row?.oldestQueuedMs ?? null;
  return {
    queued: row?.queued ?? 0,
    dead: row?.dead ?? 0,
    // A job scheduled for the future has not "waited" yet — clamp at zero
    // rather than reporting a negative age.
    oldestQueuedWaitMs: oldest === null ? null : Math.max(0, deps.now() - oldest),
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
  /**
   * When this delivery was asked for, and how long ago that was.
   *
   * The desk had no timestamp and no age at all, so a delivery stuck for seven
   * days looked identical to one requested a minute ago — on the one screen
   * whose entire job is telling you whether things are getting out. `DispatchRow`
   * carries no time, so the timing comes from the event log, where the dispatch
   * stream's first event IS the request. Ages are resolved server-side against
   * the injected clock: the panel is a client component.
   */
  readonly requestedAtMs: number | null;
  readonly waitingMs: number | null;
  /**
   * The document this is delivering, named. Every row's subject link used to
   * read the literal word "document" — four identical links here, hundreds in
   * a real organization.
   */
  readonly subjectNumber: string | null;
  /**
   * Who it is going to, named. The desk printed the raw reference
   * (`owner:01KYA5PAF37HEDPEYA0122X40F`) on the one surface that answers "did
   * the customer get it", while the rest of the platform resolves names.
   *
   * The id is a TEAM, not a person — `owner:` names the team whose owner is
   * billed, and `teams` is where it resolves ("Cup Kings", "Tigers"). An
   * earlier pass looked it up in `people`, which matched zero rows on every
   * real dispatch, so the fix silently never fired and the ULID kept rendering
   * under a comment claiming otherwise. Verified against the live rows.
   */
  readonly recipientName: string | null;
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

export async function deliveriesView(
  deps: FinopsDeps,
  db: Db,
  orgId: string,
): Promise<DeliveriesView> {
  const jobs = await deps.store.loadJobs(orgId);
  const byDedupe = new Map(jobs.map((job) => [job.dedupeKey, job]));

  // When each dispatch was requested. One grouped read over the whole org's
  // dispatch streams rather than a `loadStream` per row: for a dispatch stream
  // the streamId IS the dispatchId, and its first event is the request.
  const requestedRows = await db
    .select({
      dispatchId: finopsEvents.streamId,
      atMs: sql<number>`min(${finopsEvents.atMs})`,
    })
    .from(finopsEvents)
    .where(and(eq(finopsEvents.orgId, orgId), eq(finopsEvents.streamType, "dispatch")))
    .groupBy(finopsEvents.streamId);
  const requestedAt = new Map(requestedRows.map((row) => [row.dispatchId, row.atMs]));

  // Name the documents and the people. `subjectRef` is a docId; `recipientRef`
  // is `<kind>:<id>`, and the id is a person.
  const register = await registerView(deps, orgId);
  const numberOf = new Map(register.map((doc) => [doc.docId, doc.formatted]));
  const now = deps.now();

  const rows: DeliveryView[] = [];
  const counts: Record<string, number> = {};
  const recipientIds: string[] = [];
  for (const lane of DELIVERY_LANES) {
    const dispatches = await deps.store.loadDispatchesByStatus(orgId, lane);
    counts[lane] = dispatches.length;
    for (const dispatch of dispatches) {
      const job = byDedupe.get(`dispatch.send:${dispatch.dispatchId}`) ?? null;
      const requested = requestedAt.get(dispatch.dispatchId) ?? null;
      recipientIds.push(dispatch.recipientRef.split(":")[1] ?? "");
      rows.push({
        dispatchId: dispatch.dispatchId,
        status: dispatch.status,
        channel: dispatch.channel,
        recipientRef: dispatch.recipientRef,
        recipientName: null,
        templateId: dispatch.templateId,
        templateVersion: dispatch.templateVersion,
        subjectRef: dispatch.subjectRef,
        // `subjectRef` is `doc:<docId>`, not a bare id — see `documentDetailView`,
        // which builds the same string to match on.
        subjectNumber: numberOf.get(dispatch.subjectRef.replace(/^doc:/, "")) ?? null,
        providerRef: dispatch.providerRef,
        failureCode: dispatch.failureCode,
        requestedBy: dispatch.requestedBy,
        requestedAtMs: requested,
        waitingMs: requested === null ? null : Math.max(0, now - requested),
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
  // One lookup for every recipient, then fill the rows in place.
  const names = await teamNamesOf(db, recipientIds);
  const named = rows.map((row) => ({
    ...row,
    recipientName: names.get(row.recipientRef.split(":")[1] ?? "") ?? null,
  }));

  const dead = await deps.store.loadDeadJobs(orgId);
  return {
    rows: named,
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
  /**
   * Certifications the JOB RUNNER has recorded, read and nothing more.
   *
   * This used to be a fresh, double-derived certification plus a register that
   * re-derived again to check itself — three folds of the org's whole finance
   * history, every time anyone opened the page. `certifyOperations` writes an
   * audit row inside its transaction, so **looking at this screen appended two
   * `finops.CertificationDerived` rows** to the ledger, actor
   * `FINOPS_SYSTEM_ACTOR`, `source: "runner"` — for a runner that had not run.
   * A review probe left ten identical rows stamped the same minute, displayed
   * back under "Every certification this organization has ever recorded". They
   * were page views wearing the runner's name.
   *
   * Certifying is the runner's job and it is an ACT. This desk's job is to show
   * what the runner did. `loadAuditBreadcrumbs` is documented on the port as
   * read-only, so reading it cannot forge the record it reports. Making the
   * derivation itself non-writing means thawing IP-6 (tracked separately).
   */
  readonly certifications: readonly CertificationRecord[];
  readonly evidence: EvidenceRegisterSnapshot;
}

export interface CertificationRecord {
  readonly atMs: number;
  /** The breadcrumb's own words, e.g. `pass · <digest>`. */
  readonly claim: string | null;
  /** The digest inside that claim, when the breadcrumb carries one. */
  readonly digest: string | null;
  readonly pass: boolean | null;
}

export async function reconciliationView(
  deps: FinopsDeps,
  orgId: string,
): Promise<ReconciliationView> {
  const fy = currentFy(deps);
  const [compliance, queue, follower, watermark, breadcrumbs, evidence] = await Promise.all([
    complianceSnapshot(deps, orgId, fy),
    complianceQueueSnapshot(deps, orgId),
    followerHealthSnapshot(deps, orgId),
    watermarkSnapshot(deps, orgId),
    // Read-only. See the note on `certifications` — the two certification
    // snapshots that used to be here each wrote an audit row on every page view.
    deps.store.loadAuditBreadcrumbs(orgId, "finops.CertificationDerived"),
    evidenceRegisterSnapshot(deps, orgId),
  ]);
  const certifications = breadcrumbs
    .map((row) => {
      // The breadcrumb reads `<verdict> · <digest>`. Parse defensively: it is a
      // log line, not a contract, and an unreadable one must not break the desk.
      const [verdict, digest] = (row.reason ?? "").split(" · ");
      // CASE-INSENSITIVE, because the writer shouts and this read whispered.
      //
      // governance.ts records `PASS · <digest>` / `FAIL · <digest>`; this parsed
      // for lowercase, matched neither, and fell through to `null` — which the
      // reconciliation panel renders as "not matched". So a certification that
      // PASSED told the operator their books do not reconcile. On the one screen
      // whose entire job is to say whether the money agrees with itself, that is
      // the worst possible direction for a bug to point.
      const outcome = verdict?.trim().toLowerCase();
      return {
        atMs: row.atMs,
        claim: row.reason,
        digest: digest === undefined || digest === "" ? null : digest,
        pass: outcome === "pass" ? true : outcome === "fail" ? false : null,
      };
    })
    .reverse();
  return { fy, compliance, queue, follower, watermark, certifications, evidence };
}

// --- The documents register + operations detail (CTO §4) ----------------------------

export interface RegisterRow {
  readonly docId: string;
  readonly number: number;
  /**
   * The number as the statute means it — `RCT/2026-27/000001`. The register
   * used to print the bare `number`, which restarts at 1 in every series, so
   * demo-club's five documents listed as `2, 1, 3, 2, 1`: two rows numbered
   * "2" and two numbered "1", in a document register whose entire job is to
   * identify documents uniquely. Built with the platform's own
   * `formattedNumber`, so this can never drift from what the detail page and
   * the export show.
   */
  readonly formatted: string;
  readonly kind: string;
  readonly partyLabel: string;
  readonly amount: number;
  readonly corrects: string | null;
  readonly sourceRef: string | null;
  readonly contentDigest: string;
  readonly seriesId: string;
  /** The series' financial year, so the desk can total a year without parsing. */
  readonly fy: string | null;
}

/** The org's whole documents register, newest first within each series. */
export async function registerView(deps: FinopsDeps, orgId: string): Promise<RegisterRow[]> {
  const rows: RegisterRow[] = [];
  for (const seriesId of await deps.store.listStreamIds(orgId, "series")) {
    // One load per series, not per document: the prefix and financial year are
    // properties of the series, and every document in it shares them.
    const series = await deps.store.loadSeries(seriesId);
    for (const document of await deps.store.loadDocuments(seriesId)) {
      rows.push({
        docId: document.docId,
        number: document.number,
        formatted:
          series === null
            ? String(document.number)
            : formattedNumber(series.prefix, series.fy, document.number),
        kind: document.kind,
        partyLabel: document.partyLabel,
        amount: document.amount,
        corrects: document.corrects,
        sourceRef: document.sourceRef,
        contentDigest: document.contentDigest,
        seriesId,
        fy: series?.fy ?? null,
      });
    }
  }
  // Sorting by `docId` put the register in ULID order, which is neither
  // numeric nor chronological to a reader — it just looked arbitrary. Group by
  // series, then count down, so the register reads the way a numbered book
  // does: each lane together, newest entry at the top of its lane.
  return rows.sort((a, b) =>
    a.seriesId === b.seriesId ? b.number - a.number : b.seriesId.localeCompare(a.seriesId),
  );
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
  db: Db,
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
  // Same three additions as the deliveries desk: when it was asked for, what it
  // is carrying, and who it is going to as a person rather than a ULID.
  const requestedRows = await db
    .select({
      dispatchId: finopsEvents.streamId,
      atMs: sql<number>`min(${finopsEvents.atMs})`,
    })
    .from(finopsEvents)
    .where(and(eq(finopsEvents.orgId, orgId), eq(finopsEvents.streamType, "dispatch")))
    .groupBy(finopsEvents.streamId);
  const requestedAt = new Map(requestedRows.map((row) => [row.dispatchId, row.atMs]));
  const now = deps.now();
  const recipientIds: string[] = [];
  for (const lane of DELIVERY_LANES) {
    for (const dispatch of await deps.store.loadDispatchesByStatus(orgId, lane)) {
      if (dispatch.subjectRef !== subject) {
        continue;
      }
      const job = byDedupe.get(`dispatch.send:${dispatch.dispatchId}`) ?? null;
      const requested = requestedAt.get(dispatch.dispatchId) ?? null;
      recipientIds.push(dispatch.recipientRef.split(":")[1] ?? "");
      deliveries.push({
        dispatchId: dispatch.dispatchId,
        status: dispatch.status,
        channel: dispatch.channel,
        recipientRef: dispatch.recipientRef,
        recipientName: null,
        templateId: dispatch.templateId,
        templateVersion: dispatch.templateVersion,
        subjectRef: dispatch.subjectRef,
        // Every delivery on this page carries THIS document.
        subjectNumber: snapshot.formatted,
        providerRef: dispatch.providerRef,
        failureCode: dispatch.failureCode,
        requestedBy: dispatch.requestedBy,
        requestedAtMs: requested,
        waitingMs: requested === null ? null : Math.max(0, now - requested),
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
    deliveries: await (async () => {
      const names = await teamNamesOf(db, recipientIds);
      return deliveries.map((row) => ({
        ...row,
        recipientName: names.get(row.recipientRef.split(":")[1] ?? "") ?? null,
      }));
    })(),
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

/**
 * teamId -> team name, for the delivery register's recipient column.
 *
 * Separate from `namesOf` on purpose: that one queries `people`, and a dispatch
 * addresses a team. Pointing the recipient lookup at `people` is exactly the
 * bug this replaces — it returned no rows for every dispatch in the database.
 */
async function teamNamesOf(db: Db, ids: readonly string[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((id) => id !== ""))];
  if (unique.length === 0) {
    return new Map();
  }
  const rows = await db
    .select({ id: teams.id, name: teams.name })
    .from(teams)
    .where(inArray(teams.id, unique));
  return new Map(rows.map((row) => [row.id, row.name]));
}

/** paymentId -> captured amount in paise, for the receipt-candidate list. */
async function capturedOf(db: Db, ids: readonly string[]): Promise<Map<string, number>> {
  const unique = [...new Set(ids.filter((id) => id !== ""))];
  if (unique.length === 0) {
    return new Map();
  }
  const rows = await db
    .select({ id: payments.id, captured: payments.captured })
    .from(payments)
    .where(inArray(payments.id, unique));
  return new Map(rows.map((row) => [row.id, row.captured]));
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
