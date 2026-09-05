import {
  DISPATCH_CHANNELS,
  closeReadiness,
  deriveHealth,
  evaluateOperationalChecklist,
  fiscalYearBounds,
  formattedNumber,
  istDateOf,
  periodTimeline,
  replayPeriod,
  streamLags,
  totalLag,
  watermarkFromCursors,
  type DispatchRow,
  type DocumentRow,
  type ExportRow,
  type FiscalTimelineEntry,
  type JobState,
  type ScheduleRow,
  type SeriesRow,
  type StreamLag,
  type Watermark,
} from "..";

import type { FinopsDeps } from "./deps";
import { receiptCandidates, reproduceDocument, type ReceiptCandidate } from "./documents";
import { reproduceFiscalEvidence, type EvidenceReproduction } from "./evidence";
import {
  CERTIFICATION_ACTION,
  certifyOperations,
  checklistInputsFrom,
  gatherObservations,
  superviseOperations,
} from "./governance";
import { verifyExport, type ExportVerification } from "./pipelines";
import { verifyOrgFinops } from "./writer";

/**
 * The four foundation read models (IP-6_ARCHITECTURE §16; CTO scope §6). Every
 * one is DISPOSABLE and REBUILDABLE: nothing here is stored with authority —
 * each snapshot is assembled on read from cursors, projection rows and live
 * heads, and every underlying row heals from events (writer aggregates) or
 * re-derives from a rewind (cursors). Deleting every snapshot input except the
 * event logs loses nothing.
 */

// --- WatermarkSnapshot -----------------------------------------------------------------

export interface WatermarkSnapshot {
  readonly orgId: string;
  /** The org's consumed settlement frontier — what every surface renders. */
  readonly watermark: Watermark;
  readonly lags: readonly StreamLag[];
  readonly totalBehind: number;
}

export async function watermarkSnapshot(
  deps: FinopsDeps,
  orgId: string,
): Promise<WatermarkSnapshot> {
  const cursors = await deps.store.loadCursors(orgId);
  const heads = await deps.source.listOrgStreamHeads(orgId);
  const lags = streamLags(heads, cursors);
  return {
    orgId,
    watermark: watermarkFromCursors(cursors),
    lags,
    totalBehind: totalLag(lags),
  };
}

// --- FollowerHealthSnapshot ------------------------------------------------------------

export interface FollowerHealthSnapshot {
  readonly orgId: string;
  readonly streams: number;
  readonly totalBehind: number;
  readonly current: boolean;
  readonly lastConsumedAtMs: number | null;
  readonly stalled: readonly StreamLag[];
}

export async function followerHealthSnapshot(
  deps: FinopsDeps,
  orgId: string,
): Promise<FollowerHealthSnapshot> {
  const cursors = await deps.store.loadCursors(orgId);
  const heads = await deps.source.listOrgStreamHeads(orgId);
  const lags = streamLags(heads, cursors);
  const behind = totalLag(lags);
  const lastConsumed = cursors.reduce<number | null>(
    (latest, cursor) =>
      latest === null || cursor.updatedAtMs > latest ? cursor.updatedAtMs : latest,
    null,
  );
  return {
    orgId,
    streams: heads.length,
    totalBehind: behind,
    current: behind === 0,
    lastConsumedAtMs: lastConsumed,
    stalled: lags.filter((lag) => lag.behind > 0),
  };
}

// --- RunnerHealthSnapshot ---------------------------------------------------------------

export interface RunnerHealthSnapshot {
  readonly jobs: Readonly<Record<JobState, number>>;
  readonly schedules: readonly ScheduleRow[];
  readonly healthy: boolean;
  /** How long the oldest queued job has been due, or null if none is waiting. */
  readonly oldestQueuedAgeMs: number | null;
  /** Why `healthy` is false, in an operator's words. Empty when it is true. */
  readonly reasons: readonly string[];
}

/**
 * How long a job may sit due before the runner is presumed to have stopped.
 *
 * The tick is 15s by default, so a job still waiting ten minutes after it was
 * due is not a busy platform — it is nobody working. Generous enough that a
 * long tick or a brief restart cannot trip it.
 */
const STALLED_QUEUE_MS = 10 * 60_000;

export async function runnerHealthSnapshot(deps: FinopsDeps): Promise<RunnerHealthSnapshot> {
  const jobs = await deps.store.countJobs();
  const schedules = await deps.store.loadSchedules();
  const oldest = await deps.store.oldestQueuedNotBeforeMs();
  const oldestQueuedAgeMs = oldest === null ? null : Math.max(0, deps.now() - oldest);

  /*
   * A STOPPED RUNNER USED TO READ AS HEALTHY.
   *
   * `healthy: jobs.dead === 0` answers "has anything failed loudly", which is
   * the easy half. The half that matters is silence: a runner that has crashed,
   * lost its host or never been deployed produces no dead jobs at all, so it
   * scored perfectly while queued work aged behind it — and nothing else in the
   * platform watches the runner (PA-1 §16, §20).
   *
   * Queue DEPTH cannot distinguish a busy platform from a dead one. Queue AGE
   * can: a job still waiting long after it was due means nobody is working.
   */
  const reasons: string[] = [];
  if (jobs.dead > 0) {
    reasons.push(`${String(jobs.dead)} job(s) dead-lettered and awaiting an operator`);
  }
  if (oldestQueuedAgeMs !== null && oldestQueuedAgeMs > STALLED_QUEUE_MS) {
    reasons.push(
      `oldest queued job has been due for ${String(Math.round(oldestQueuedAgeMs / 60_000))} minutes — the runner may not be running`,
    );
  }
  return { jobs, schedules, oldestQueuedAgeMs, reasons, healthy: reasons.length === 0 };
}

// --- OperationalSnapshot ----------------------------------------------------------------

export interface OperationalSnapshot {
  readonly orgId: string;
  readonly profile: { declared: boolean; posture: string | null; version: number | null };
  readonly period: {
    readonly fy: string | null;
    readonly status: string | null;
    readonly openExceptions: number;
    readonly attestedDays: number;
    /** FY elapsed and the period still open — the year-end trigger's surface. */
    readonly awaitingClose: boolean;
  };
  readonly deadJobs: number;
  readonly watermark: Watermark;
  readonly followerCurrent: boolean;
}

export async function operationalSnapshot(
  deps: FinopsDeps,
  orgId: string,
  fy: string,
): Promise<OperationalSnapshot> {
  const profile = await deps.store.loadProfile(orgId);
  const period = await deps.store.loadPeriodFor(orgId, fy);
  const days = period === null ? [] : await deps.store.loadPeriodDays(period.periodId);
  const dead = await deps.store.loadDeadJobs(orgId);
  const watermarks = await watermarkSnapshot(deps, orgId);
  const todayIst = istDateOf(deps.now());
  return {
    orgId,
    profile: {
      declared: profile !== null,
      posture: profile?.posture ?? null,
      version: profile?.version ?? null,
    },
    period: {
      fy: period?.fy ?? null,
      status: period?.status ?? null,
      openExceptions: period?.openExceptions ?? 0,
      attestedDays: days.length,
      awaitingClose:
        period !== null && period.status === "open" && todayIst > fiscalYearBounds(fy).end,
    },
    deadJobs: dead.length,
    watermark: watermarks.watermark,
    followerCurrent: watermarks.totalBehind === 0,
  };
}

// --- DocumentSnapshot · SeriesSnapshot · IssuanceSnapshot (M-IP6-2) ----------------------

export interface DocumentSnapshot {
  readonly document: DocumentRow;
  readonly formatted: string;
  /** The live reproduction verdict: re-rendered digest vs the sealed one. */
  readonly reproducible: boolean;
  readonly reproductionReason: string | null;
}

export async function documentSnapshot(
  deps: FinopsDeps,
  docId: string,
): Promise<DocumentSnapshot | null> {
  const document = await deps.store.loadDocument(docId);
  if (document === null) {
    return null;
  }
  const series = await deps.store.loadSeries(document.seriesId);
  const reproduction = await reproduceDocument(deps, docId);
  return {
    document,
    formatted:
      series === null
        ? String(document.number)
        : formattedNumber(series.prefix, series.fy, document.number),
    reproducible: reproduction.ok && reproduction.matches === true,
    reproductionReason: reproduction.ok ? null : (reproduction.reason ?? null),
  };
}

export interface SeriesSnapshot {
  readonly series: SeriesRow;
  readonly documents: readonly DocumentRow[];
  /** The next number the lane will issue — derived, never invented. */
  readonly nextNumber: number;
}

export async function seriesSnapshot(
  deps: FinopsDeps,
  seriesId: string,
): Promise<SeriesSnapshot | null> {
  const series = await deps.store.loadSeries(seriesId);
  if (series === null) {
    return null;
  }
  const documents = await deps.store.loadDocuments(seriesId);
  return { series, documents, nextNumber: documents.length + 1 };
}

export interface IssuanceSnapshot {
  readonly orgId: string;
  readonly series: readonly (SeriesRow & { readonly nextNumber: number })[];
  readonly documentsIssued: number;
  /** Captured payments still awaiting a receipt — the policy's catch-up view. */
  readonly receiptDue: readonly ReceiptCandidate[];
  readonly autoReceipt: boolean;
}

export async function issuanceSnapshot(deps: FinopsDeps, orgId: string): Promise<IssuanceSnapshot> {
  const profile = await deps.store.loadProfile(orgId);
  const series: (SeriesRow & { nextNumber: number })[] = [];
  let documentsIssued = 0;
  for (const seriesId of await deps.store.listStreamIds(orgId, "series")) {
    const row = await deps.store.loadSeries(seriesId);
    if (row === null) {
      continue;
    }
    series.push({ ...row, nextNumber: row.documentCount + 1 });
    documentsIssued += row.documentCount;
  }
  return {
    orgId,
    series,
    documentsIssued,
    receiptDue: await receiptCandidates(deps, orgId),
    autoReceipt: profile?.autoReceipt ?? false,
  };
}

// --- M-IP6-3 read models: dispatch, exports, providers, queues, retries, archive --------

export interface DispatchSnapshot {
  readonly dispatch: DispatchRow;
  /** The subject document's live reproduction verdict (null for notices). */
  readonly subjectReproducible: boolean | null;
  readonly job: { state: string; attempts: number; lastError: string | null } | null;
  readonly watermark: Watermark;
}

export async function dispatchSnapshot(
  deps: FinopsDeps,
  dispatchId: string,
): Promise<DispatchSnapshot | null> {
  const dispatch = await deps.store.loadDispatch(dispatchId);
  if (dispatch === null) {
    return null;
  }
  let subjectReproducible: boolean | null = null;
  if (dispatch.subjectRef.startsWith("doc:")) {
    const reproduction = await reproduceDocument(deps, dispatch.subjectRef.slice(4));
    subjectReproducible = reproduction.ok && reproduction.matches === true;
  }
  const job =
    (await deps.store.loadJobs(dispatch.orgId)).find(
      (row) => row.dedupeKey === `dispatch.send:${dispatchId}`,
    ) ?? null;
  return {
    dispatch,
    subjectReproducible,
    job:
      job === null ? null : { state: job.state, attempts: job.attempts, lastError: job.lastError },
    watermark: (await watermarkSnapshot(deps, dispatch.orgId)).watermark,
  };
}

export interface ExportSnapshot {
  readonly run: ExportRow;
  readonly verification: ExportVerification | null;
  readonly watermark: Watermark;
}

export async function exportSnapshot(
  deps: FinopsDeps,
  exportId: string,
): Promise<ExportSnapshot | null> {
  const run = await deps.store.loadExport(exportId);
  if (run === null) {
    return null;
  }
  return {
    run,
    verification: await verifyExport(deps, exportId),
    watermark: (await watermarkSnapshot(deps, run.orgId)).watermark,
  };
}

export interface ProviderHealthSnapshot {
  readonly orgId: string;
  readonly channels: readonly {
    readonly channel: string;
    readonly configured: boolean;
    readonly requested: number;
    readonly sent: number;
    readonly confirmed: number;
    readonly failed: number;
    readonly lastFailureCodes: readonly string[];
  }[];
  readonly deadSendJobs: number;
  readonly watermark: Watermark;
}

export async function providerHealthSnapshot(
  deps: FinopsDeps,
  orgId: string,
): Promise<ProviderHealthSnapshot> {
  const byStatus = {
    requested: await deps.store.loadDispatchesByStatus(orgId, "requested"),
    sent: await deps.store.loadDispatchesByStatus(orgId, "sent"),
    confirmed: await deps.store.loadDispatchesByStatus(orgId, "confirmed"),
    failed: await deps.store.loadDispatchesByStatus(orgId, "failed"),
  };
  const channels = DISPATCH_CHANNELS.map((channel) => ({
    channel,
    configured: deps.delivery(channel) !== null,
    requested: byStatus.requested.filter((row) => row.channel === channel).length,
    sent: byStatus.sent.filter((row) => row.channel === channel).length,
    confirmed: byStatus.confirmed.filter((row) => row.channel === channel).length,
    failed: byStatus.failed.filter((row) => row.channel === channel).length,
    lastFailureCodes: byStatus.failed
      .filter((row) => row.channel === channel && row.failureCode !== null)
      .map((row) => row.failureCode ?? "")
      .slice(-5),
  }));
  const deadSendJobs = (await deps.store.loadDeadJobs(orgId)).filter(
    (job) => job.kind === "dispatch.send",
  ).length;
  return {
    orgId,
    channels,
    deadSendJobs,
    watermark: (await watermarkSnapshot(deps, orgId)).watermark,
  };
}

export interface DispatchQueueSnapshot {
  readonly orgId: string;
  readonly requested: number;
  readonly sent: number;
  readonly pendingSendJobs: number;
  readonly watermark: Watermark;
}

export async function dispatchQueueSnapshot(
  deps: FinopsDeps,
  orgId: string,
): Promise<DispatchQueueSnapshot> {
  const jobs = await deps.store.loadJobs(orgId);
  return {
    orgId,
    requested: (await deps.store.loadDispatchesByStatus(orgId, "requested")).length,
    sent: (await deps.store.loadDispatchesByStatus(orgId, "sent")).length,
    pendingSendJobs: jobs.filter(
      (job) => job.kind === "dispatch.send" && (job.state === "queued" || job.state === "leased"),
    ).length,
    watermark: (await watermarkSnapshot(deps, orgId)).watermark,
  };
}

export interface RetrySnapshot {
  readonly orgId: string;
  readonly retrying: readonly {
    readonly kind: string;
    readonly dedupeKey: string;
    readonly attempts: number;
    readonly notBeforeMs: number;
    readonly lastError: string | null;
  }[];
  readonly dead: readonly { readonly kind: string; readonly dedupeKey: string }[];
  readonly watermark: Watermark;
}

export async function retrySnapshot(deps: FinopsDeps, orgId: string): Promise<RetrySnapshot> {
  const jobs = await deps.store.loadJobs(orgId);
  return {
    orgId,
    retrying: jobs
      .filter((job) => job.state === "queued" && job.attempts > 0)
      .map((job) => ({
        kind: job.kind,
        dedupeKey: job.dedupeKey,
        attempts: job.attempts,
        notBeforeMs: job.notBeforeMs,
        lastError: job.lastError,
      })),
    dead: (await deps.store.loadDeadJobs(orgId)).map((job) => ({
      kind: job.kind,
      dedupeKey: job.dedupeKey,
    })),
    watermark: (await watermarkSnapshot(deps, orgId)).watermark,
  };
}

export interface ArchiveSnapshot {
  readonly orgId: string;
  readonly exports: readonly {
    readonly exportId: string;
    readonly kind: string;
    readonly status: string;
    readonly rowCount: number | null;
    readonly artifactRef: string | null;
    readonly verified: boolean | null;
  }[];
  readonly completed: number;
  readonly failed: number;
  readonly watermark: Watermark;
}

export async function archiveSnapshot(deps: FinopsDeps, orgId: string): Promise<ArchiveSnapshot> {
  const runs = await deps.store.loadExportsByOrg(orgId);
  const exports = [];
  for (const run of runs) {
    const verification = run.status === "completed" ? await verifyExport(deps, run.exportId) : null;
    exports.push({
      exportId: run.exportId,
      kind: run.kind,
      status: run.status,
      rowCount: run.rowCount,
      artifactRef: run.artifactRef,
      verified: verification === null ? null : verification.verified,
    });
  }
  return {
    orgId,
    exports,
    completed: runs.filter((run) => run.status === "completed").length,
    failed: runs.filter((run) => run.status === "failed").length,
    watermark: (await watermarkSnapshot(deps, orgId)).watermark,
  };
}

// --- M-IP6-4 governance read models -------------------------------------------------------

export interface OperationalChecklistSnapshot {
  readonly orgId: string;
  readonly checks: readonly { name: string; outcome: string; detail: string | null }[];
  readonly green: boolean;
  readonly watermark: Watermark;
}

/** The full daily checklist, evaluated NOW from fresh observations. */
export async function operationalChecklistSnapshot(
  deps: FinopsDeps,
  orgId: string,
): Promise<OperationalChecklistSnapshot> {
  const observations = await gatherObservations(deps, orgId, deps.now());
  const deadJobs = (await deps.store.loadDeadJobs(orgId)).map((dead) => ({
    kind: dead.kind,
    key: dead.dedupeKey,
  }));
  const divergences = await verifyOrgFinops(deps, orgId);
  const checks = evaluateOperationalChecklist(
    checklistInputsFrom(observations, deadJobs, divergences),
  );
  return {
    orgId,
    checks: checks.map((check) => ({ ...check })),
    green: checks.every((check) => check.outcome === "pass"),
    watermark: (await watermarkSnapshot(deps, orgId)).watermark,
  };
}

export interface OperationsDashboardSnapshot {
  readonly orgId: string;
  readonly overall: string;
  readonly components: readonly { component: string; status: string; detail: string | null }[];
  readonly queues: DispatchQueueSnapshot;
  readonly retries: RetrySnapshot;
  readonly archive: { completed: number; failed: number };
  readonly fiscal: { fy: string | null; status: string | null; openExceptions: number };
  readonly watermark: Watermark;
}

export async function operationsDashboardSnapshot(
  deps: FinopsDeps,
  orgId: string,
  fy: string,
): Promise<OperationsDashboardSnapshot> {
  const verdict = await superviseOperations(deps, orgId);
  const queues = await dispatchQueueSnapshot(deps, orgId);
  const retries = await retrySnapshot(deps, orgId);
  const archive = await archiveSnapshot(deps, orgId);
  const period = await deps.store.loadPeriodFor(orgId, fy);
  return {
    orgId,
    overall: verdict.overall,
    components: verdict.components.map((component) => ({ ...component })),
    queues,
    retries,
    archive: { completed: archive.completed, failed: archive.failed },
    fiscal: {
      fy: period?.fy ?? null,
      status: period?.status ?? null,
      openExceptions: period?.openExceptions ?? 0,
    },
    watermark: verdict.watermark,
  };
}

export interface FiscalTimelineSnapshot {
  readonly periodId: string;
  readonly fy: string;
  readonly entries: readonly FiscalTimelineEntry[];
  readonly watermark: Watermark;
}

/** The period stream, rendered on read from the FOLD (the ledger pattern). */
export async function fiscalTimelineSnapshot(
  deps: FinopsDeps,
  periodId: string,
): Promise<FiscalTimelineSnapshot | null> {
  const events = await deps.store.loadStream("period", periodId);
  if (events.length === 0) {
    return null;
  }
  const fold = replayPeriod(events);
  if (!fold.ok) {
    return null;
  }
  return {
    periodId,
    fy: fold.projection.fy,
    entries: periodTimeline(events),
    watermark: (await watermarkSnapshot(deps, fold.projection.orgId)).watermark,
  };
}

export interface FiscalCloseSnapshot {
  readonly periodId: string;
  readonly fy: string;
  readonly status: string;
  readonly ready: boolean;
  readonly missingDays: number;
  readonly openExceptions: number;
  readonly fiscalYearEnded: boolean;
  readonly watermark: Watermark;
}

/** Close readiness, derived from the fold — what still blocks the seal. */
export async function fiscalCloseSnapshot(
  deps: FinopsDeps,
  periodId: string,
): Promise<FiscalCloseSnapshot | null> {
  const events = await deps.store.loadStream("period", periodId);
  if (events.length === 0) {
    return null;
  }
  const fold = replayPeriod(events);
  if (!fold.ok) {
    return null;
  }
  const readiness = closeReadiness(fold.projection);
  const todayIst = istDateOf(deps.now());
  const ended = todayIst > fiscalYearBounds(fold.projection.fy).end;
  return {
    periodId,
    fy: fold.projection.fy,
    status: fold.projection.status,
    ready: readiness.ready && ended && fold.projection.status === "open",
    missingDays: readiness.missingDays.length,
    openExceptions: readiness.openExceptions,
    fiscalYearEnded: ended,
    watermark: (await watermarkSnapshot(deps, fold.projection.orgId)).watermark,
  };
}

export interface EvidenceSnapshot {
  readonly periodId: string;
  readonly closedAtSeq: number | null;
  readonly evidence: Readonly<Record<string, unknown>> | null;
  readonly reproduction: EvidenceReproduction | null;
  readonly watermark: Watermark;
}

/** A sealed year's evidence + its LIVE reproduction verdict. */
export async function evidenceSnapshot(
  deps: FinopsDeps,
  periodId: string,
  atSeq?: number,
): Promise<EvidenceSnapshot | null> {
  const events = await deps.store.loadStream("period", periodId);
  if (events.length === 0) {
    return null;
  }
  const fold = replayPeriod(events);
  if (!fold.ok) {
    return null;
  }
  const reproduction = await reproduceFiscalEvidence(deps, periodId, atSeq);
  const closes = events.filter((event) => event.type === "PeriodClosed");
  const close =
    atSeq === undefined ? closes[closes.length - 1] : closes.find((event) => event.seq === atSeq);
  return {
    periodId,
    closedAtSeq: close?.seq ?? null,
    evidence: (close?.payload["evidence"] as Record<string, unknown> | undefined) ?? null,
    reproduction: reproduction.ok ? reproduction : null,
    watermark: (await watermarkSnapshot(deps, fold.projection.orgId)).watermark,
  };
}

export interface EvidenceRegisterSnapshot {
  readonly orgId: string;
  readonly seals: readonly {
    periodId: string;
    fy: string;
    closedAtSeq: number;
    verified: boolean;
  }[];
  readonly watermark: Watermark;
}

/** Every seal ever made across the org's periods, each re-verified live. */
export async function evidenceRegisterSnapshot(
  deps: FinopsDeps,
  orgId: string,
): Promise<EvidenceRegisterSnapshot> {
  const seals = [];
  for (const periodId of await deps.store.listStreamIds(orgId, "period")) {
    const events = await deps.store.loadStream("period", periodId);
    const fold = replayPeriod(events);
    if (!fold.ok) {
      continue;
    }
    for (const close of events.filter((event) => event.type === "PeriodClosed")) {
      const reproduction = await reproduceFiscalEvidence(deps, periodId, close.seq);
      seals.push({
        periodId,
        fy: fold.projection.fy,
        closedAtSeq: close.seq,
        verified: reproduction.ok && reproduction.matches === true,
      });
    }
  }
  return {
    orgId,
    seals,
    watermark: (await watermarkSnapshot(deps, orgId)).watermark,
  };
}

export interface ComplianceSnapshot {
  readonly orgId: string;
  readonly fy: string;
  readonly posture: string | null;
  readonly period: { status: string | null; openExceptions: number };
  readonly documents: { total: number; reproducible: boolean };
  readonly exports: { completed: number; verified: boolean };
  readonly evidenceVerified: boolean;
  readonly watermark: Watermark;
}

/** The org's compliance posture for a fiscal year, derived end to end. */
export async function complianceSnapshot(
  deps: FinopsDeps,
  orgId: string,
  fy: string,
): Promise<ComplianceSnapshot> {
  const observations = await gatherObservations(deps, orgId, deps.now());
  const profile = await deps.store.loadProfile(orgId);
  const period = await deps.store.loadPeriodFor(orgId, fy);
  return {
    orgId,
    fy,
    posture: profile?.posture ?? null,
    period: { status: period?.status ?? null, openExceptions: period?.openExceptions ?? 0 },
    documents: {
      total: observations.documents?.total ?? 0,
      reproducible: (observations.documents?.unreproducible ?? 1) === 0,
    },
    exports: {
      completed: (await deps.store.loadExportsByOrg(orgId)).filter(
        (run) => run.status === "completed",
      ).length,
      verified: (observations.exports?.unverifiedArtifacts ?? 1) === 0,
    },
    evidenceVerified: (observations.fiscal?.unverifiedEvidence ?? 1) === 0,
    watermark: (await watermarkSnapshot(deps, orgId)).watermark,
  };
}

export interface ComplianceQueueSnapshot {
  readonly orgId: string;
  readonly items: readonly { kind: string; subject: string; action: string }[];
  readonly watermark: Watermark;
}

/** The ranked attention queue: what a human must answer, with the resolving action. */
export async function complianceQueueSnapshot(
  deps: FinopsDeps,
  orgId: string,
): Promise<ComplianceQueueSnapshot> {
  const items: { kind: string; subject: string; action: string }[] = [];
  const observations = await gatherObservations(deps, orgId, deps.now());
  for (const component of deriveHealth(observations)) {
    if (component.status !== "healthy") {
      items.push({
        kind: `health:${component.component}:${component.status}`,
        subject: component.detail ?? component.component,
        action:
          component.component === "follower"
            ? "runFollower / rewindFollower"
            : component.component === "runner"
              ? "requeueDeadJob"
              : component.component === "exports"
                ? "regenerateExportArtifact"
                : component.component === "documents"
                  ? "recover* / investigate forgery"
                  : component.component === "fiscal"
                    ? "attestDay / closePeriod"
                    : "investigate",
      });
    }
  }
  for (const dispatch of await deps.store.loadDispatchesByStatus(orgId, "failed")) {
    items.push({
      kind: "dispatch:failed",
      subject: `${dispatch.dispatchId} (${dispatch.failureCode ?? ""})`,
      action: "retryDispatch",
    });
  }
  for (const run of await deps.store.loadExportsByOrg(orgId)) {
    if (run.status === "failed") {
      items.push({
        kind: "export:failed",
        subject: `${run.exportId} (${run.failureCode ?? ""})`,
        action: "retryExport",
      });
    }
  }
  return { orgId, items, watermark: (await watermarkSnapshot(deps, orgId)).watermark };
}

export interface CertificationSnapshot {
  readonly orgId: string;
  readonly pass: boolean;
  readonly digest: string;
  readonly checks: readonly { name: string; pass: boolean; detail: string | null }[];
  readonly watermark: Watermark;
}

/** A FRESH certification, double-derived (fails closed on nondeterminism). */
export async function certificationSnapshot(
  deps: FinopsDeps,
  orgId: string,
): Promise<CertificationSnapshot | null> {
  const certification = await certifyOperations(deps, orgId);
  if (
    !certification.ok ||
    certification.report === undefined ||
    certification.digest === undefined
  ) {
    return null;
  }
  return {
    orgId,
    pass: certification.report.pass,
    digest: certification.digest,
    checks: certification.report.checks.map((check) => ({ ...check })),
    watermark: certification.report.watermark,
  };
}

export interface CertificationRegisterSnapshot {
  readonly orgId: string;
  readonly history: readonly { atMs: number; claim: string | null }[];
  /** The latest claim, checked against a FRESH re-derivation: a recorded
   * digest that replay contradicts is a forged certificate, exposed. */
  readonly latestClaimMatchesRederivation: boolean | null;
  readonly watermark: Watermark;
}

export async function certificationRegisterSnapshot(
  deps: FinopsDeps,
  orgId: string,
): Promise<CertificationRegisterSnapshot> {
  const history = await deps.store.loadAuditBreadcrumbs(orgId, CERTIFICATION_ACTION);
  const latest = history[history.length - 1] ?? null;
  let latestClaimMatchesRederivation: boolean | null = null;
  if (latest !== null && latest.reason !== null) {
    const claimedDigest = latest.reason.split(" · ")[1] ?? "";
    const fresh = await certifyOperations(deps, orgId);
    latestClaimMatchesRederivation =
      fresh.ok && fresh.digest !== undefined ? fresh.digest === claimedDigest : false;
  }
  return {
    orgId,
    history: history.map((row) => ({ atMs: row.atMs, claim: row.reason })),
    latestClaimMatchesRederivation,
    watermark: (await watermarkSnapshot(deps, orgId)).watermark,
  };
}
