import { replayJournal, trialBalance } from "@desiauction/settlement";

import {
  certificationBytes,
  deriveHealth,
  fiscalYearBounds,
  FINOPS_SYSTEM_ACTOR,
  istDateOf,
  overallHealth,
  type CertificationCheck,
  type CertificationReport,
  type ComponentHealth,
  type HealthStatus,
  type OperationalChecklistInputs,
  type OperationalObservations,
  type Watermark,
} from "..";

import type { FinopsDeps } from "./deps";
import { reproduceDocument } from "./documents";
import { reproduceFiscalEvidence } from "./evidence";
import { verifyExport } from "./pipelines";
import { foldStream, orgWatermark, verifyOrgFinops } from "./writer";

/**
 * THE OPERATIONS SUPERVISOR & CERTIFICATION (M-IP6-4; IP-6_ARCHITECTURE
 * §15/§16).
 *
 * The supervisor OBSERVES: every input below is an event fold, an immutable
 * substrate, or a port probe — never a mutable projection trusted on its own
 * (fold-vs-row divergence is itself one of the observations). It DERIVES
 * health with the pure rules in the domain and REPAIRS NOTHING: every
 * non-healthy verdict names the explicit human command that fixes it.
 *
 * Certification DERIVES FROM REPLAY: fold every stream twice (byte-compared),
 * verify rows against folds, reproduce every document, verify every artifact,
 * re-derive every sealed year's evidence, and check settlement's own folds
 * balance — a time-free report whose digest is identical for identical
 * repository state. Certifying twice yields the same bytes (the
 * duplicate-certification guarantee); a claimed digest that re-derivation
 * contradicts is a forgery, exposed.
 */

const STALE_PAYMENT_MS = 24 * 60 * 60 * 1000;

// --- Observation gathering ---------------------------------------------------------------

async function observe<T>(gather: () => Promise<T>): Promise<T | null> {
  try {
    return await gather();
  } catch {
    return null; // unobservable → `unknown` → never healthy (fail closed)
  }
}

export async function gatherObservations(
  deps: FinopsDeps,
  orgId: string,
  nowMs: number,
): Promise<OperationalObservations> {
  const follower = await observe(async () => {
    const heads = await deps.source.listOrgStreamHeads(orgId);
    const cursors = await deps.store.loadCursors(orgId);
    const headByKey = new Map(
      heads.map((head) => [`${head.streamType}:${head.streamId}`, head.headSeq]),
    );
    let totalBehind = 0;
    let cursorsAheadOfHead = 0;
    for (const cursor of cursors) {
      const head = headByKey.get(`${cursor.streamType}:${cursor.streamId}`) ?? 0;
      if (cursor.lastSeq > head) {
        cursorsAheadOfHead += 1; // watermark corruption: claims unconsumed history
      }
    }
    for (const head of heads) {
      const cursor = cursors.find(
        (row) => row.streamType === head.streamType && row.streamId === head.streamId,
      );
      totalBehind += Math.max(0, head.headSeq - (cursor?.lastSeq ?? 0));
    }
    return { totalBehind, cursorsAheadOfHead };
  });

  const runner = await observe(async () => {
    const schedules = await deps.store.loadSchedules();
    const deadJobs = (await deps.store.loadDeadJobs(orgId)).length;
    const overdue = schedules.reduce((worst, slot) => Math.max(worst, nowMs - slot.nextDueMs), 0);
    return { deadJobs, schedulesSeeded: schedules.length >= 2, scheduleOverdueMs: overdue };
  });

  const dispatch = await observe(async () => {
    const requested = await deps.store.loadDispatchesByStatus(orgId, "requested");
    let oldestAgeMs = 0;
    for (const row of requested) {
      const events = await deps.store.loadStream("dispatch", row.dispatchId);
      const requestedAt = events[0]?.atMs ?? nowMs;
      oldestAgeMs = Math.max(oldestAgeMs, nowMs - requestedAt);
    }
    return {
      requestedBacklog: requested.length,
      oldestRequestedAgeMs: oldestAgeMs,
      failed: (await deps.store.loadDispatchesByStatus(orgId, "failed")).length,
    };
  });

  const exportsObservation = await observe(async () => {
    const runs = await deps.store.loadExportsByOrg(orgId);
    let unverified = 0;
    for (const run of runs) {
      if (run.status !== "completed") {
        continue;
      }
      // Health judges the ARTIFACT against its SEALED digest. Regeneration
      // equality additionally holds only while the register is unchanged (the
      // heal window) — lawful later documents move the register, so it is a
      // view-level fact (ExportSnapshot), not a health criterion.
      const verification = await verifyExport(deps, run.exportId);
      unverified += verification?.artifactMatchesDigest === true ? 0 : 1;
    }
    return {
      requestedBacklog: runs.filter((run) => run.status === "requested").length,
      failed: runs.filter((run) => run.status === "failed").length,
      unverifiedArtifacts: unverified,
    };
  });

  const documents = await observe(async () => {
    const divergences = (await verifyOrgFinops(deps, orgId)).length;
    let total = 0;
    let unreproducible = 0;
    for (const seriesId of await deps.store.listStreamIds(orgId, "series")) {
      for (const doc of await deps.store.loadDocuments(seriesId)) {
        total += 1;
        const reproduction = await reproduceDocument(deps, doc.docId);
        unreproducible += reproduction.ok && reproduction.matches === true ? 0 : 1;
      }
    }
    return { total, unreproducible, divergences };
  });

  const settlementSync = await observe(async () => {
    // Reconciliation SUPERVISION through the FROZEN pure folds, read-only:
    // the org journal must fold and balance; stale open payments signal the
    // settlement-owned expiry sweep is not being run. Nothing here appends.
    const journalEvents = await deps.source.loadEventsFrom("journal", orgId, 0);
    let journalBalanced = true;
    let unfoldableStreams = 0;
    if (journalEvents.length > 0) {
      const fold = replayJournal(journalEvents);
      if (!fold.ok) {
        unfoldableStreams += 1;
        journalBalanced = false;
      } else {
        journalBalanced = trialBalance(fold.projection).balanced;
      }
    }
    const open = await deps.source.listOpenPayments(orgId);
    const stalePayments = open.filter(
      (payment) => nowMs - payment.createdAtMs > STALE_PAYMENT_MS,
    ).length;
    return { journalBalanced, unfoldableStreams, stalePayments };
  });

  const fiscal = await observe(async () => {
    let openExceptions = 0;
    let awaitingClose = false;
    let unverifiedEvidence = 0;
    const todayIst = istDateOf(nowMs);
    for (const periodId of await deps.store.listStreamIds(orgId, "period")) {
      const fold = await foldStream(deps, "period", periodId);
      if (fold === null || !fold.ok) {
        throw new Error("period_unfoldable");
      }
      const projection = fold.projection as {
        status: string;
        fy: string;
        exceptions: { acknowledgedAtSeq: number | null }[];
        closedAtSeq: number | null;
      };
      openExceptions += projection.exceptions.filter(
        (exception) => exception.acknowledgedAtSeq === null,
      ).length;
      if (projection.status === "open" && todayIst > fiscalYearBounds(projection.fy).end) {
        awaitingClose = true;
      }
      if (projection.closedAtSeq !== null) {
        const reproduction = await reproduceFiscalEvidence(deps, periodId);
        unverifiedEvidence += reproduction.ok && reproduction.matches === true ? 0 : 1;
      }
    }
    return { openExceptions, awaitingClose, unverifiedEvidence };
  });

  return {
    follower,
    runner,
    dispatch,
    exports: exportsObservation,
    documents,
    settlementSync,
    fiscal,
  };
}

export interface SupervisorVerdict {
  readonly orgId: string;
  readonly overall: HealthStatus;
  readonly components: readonly ComponentHealth[];
  readonly watermark: Watermark;
}

/** Observe → derive. Never repairs; repair remains an explicit command. */
export async function superviseOperations(
  deps: FinopsDeps,
  orgId: string,
  nowMs?: number,
): Promise<SupervisorVerdict> {
  const at = nowMs ?? deps.now();
  const components = deriveHealth(await gatherObservations(deps, orgId, at));
  return {
    orgId,
    overall: overallHealth(components),
    components,
    watermark: await orgWatermark(deps, orgId),
  };
}

/** The full daily checklist inputs, from the same observations. */
export function checklistInputsFrom(
  observations: OperationalObservations,
  deadJobs: readonly { kind: string; key: string }[],
  finopsDivergences: readonly string[],
): OperationalChecklistInputs {
  return {
    followerLagEvents: observations.follower?.totalBehind ?? Number.MAX_SAFE_INTEGER,
    finopsDivergences,
    deadJobs,
    documentsUnreproducible: observations.documents?.unreproducible ?? Number.MAX_SAFE_INTEGER,
    exportsUnverified: observations.exports?.unverifiedArtifacts ?? Number.MAX_SAFE_INTEGER,
    dispatchOldestRequestedAgeMs:
      observations.dispatch?.oldestRequestedAgeMs ?? Number.MAX_SAFE_INTEGER,
    settlementSynchronized:
      observations.settlementSync !== null &&
      observations.settlementSync.journalBalanced &&
      observations.settlementSync.unfoldableStreams === 0,
    fiscalEvidenceUnverified: observations.fiscal?.unverifiedEvidence ?? Number.MAX_SAFE_INTEGER,
  };
}

// --- Certification: derived from replay, time-free, double-derived ------------------------

async function deriveCertification(deps: FinopsDeps, orgId: string): Promise<CertificationReport> {
  const checks: CertificationCheck[] = [];
  const streamCounts: Record<string, number> = {};

  // 1 · Replay determinism + projection integrity, every finops stream.
  let nondeterministic = 0;
  let unfoldable = 0;
  for (const streamType of ["profile", "series", "dispatch", "export", "period"] as const) {
    for (const streamId of await deps.store.listStreamIds(orgId, streamType)) {
      const first = await foldStream(deps, streamType, streamId);
      const second = await foldStream(deps, streamType, streamId);
      streamCounts[`${streamType}:${streamId}`] =
        first !== null && first.ok ? first.events.length : -1;
      if (first === null || !first.ok) {
        unfoldable += 1;
        continue;
      }
      if (JSON.stringify(first) !== JSON.stringify(second)) {
        nondeterministic += 1;
      }
    }
  }
  checks.push({
    name: "replay-deterministic",
    pass: nondeterministic === 0 && unfoldable === 0,
    detail:
      nondeterministic === 0 && unfoldable === 0
        ? null
        : `${String(unfoldable)} unfoldable · ${String(nondeterministic)} nondeterministic`,
  });

  const divergences = await verifyOrgFinops(deps, orgId);
  checks.push({
    name: "projections-match-folds",
    pass: divergences.length === 0,
    detail: divergences.length === 0 ? null : divergences.join(" · "),
  });

  // 2 · Every document reproduces byte-identically.
  let documents = 0;
  let unreproducible = 0;
  for (const seriesId of await deps.store.listStreamIds(orgId, "series")) {
    for (const doc of await deps.store.loadDocuments(seriesId)) {
      documents += 1;
      const reproduction = await reproduceDocument(deps, doc.docId);
      unreproducible += reproduction.ok && reproduction.matches === true ? 0 : 1;
    }
  }
  checks.push({
    name: "documents-reproduce",
    pass: unreproducible === 0,
    detail:
      unreproducible === 0 ? `${String(documents)} verified` : `${String(unreproducible)} fail`,
  });

  // 3 · Every completed export's artifact is byte-identical to its SEALED
  // digest (regeneration equality is a heal-window fact, not a certification
  // criterion — lawful later documents move the register).
  let exportsUnverified = 0;
  let exportsVerified = 0;
  for (const run of await deps.store.loadExportsByOrg(orgId)) {
    if (run.status !== "completed") {
      continue;
    }
    const verification = await verifyExport(deps, run.exportId);
    if (verification?.artifactMatchesDigest === true) {
      exportsVerified += 1;
    } else {
      exportsUnverified += 1;
    }
  }
  checks.push({
    name: "exports-verify",
    pass: exportsUnverified === 0,
    detail:
      exportsUnverified === 0
        ? `${String(exportsVerified)} verified`
        : `${String(exportsUnverified)} fail`,
  });

  // 4 · Every sealed year's evidence re-derives from its pins.
  let evidenceUnverified = 0;
  let evidenceVerified = 0;
  for (const periodId of await deps.store.listStreamIds(orgId, "period")) {
    const events = await deps.store.loadStream("period", periodId);
    for (const close of events.filter((event) => event.type === "PeriodClosed")) {
      const reproduction = await reproduceFiscalEvidence(deps, periodId, close.seq);
      if (reproduction.ok && reproduction.matches === true) {
        evidenceVerified += 1;
      } else {
        evidenceUnverified += 1;
      }
    }
  }
  checks.push({
    name: "fiscal-evidence-reproduces",
    pass: evidenceUnverified === 0,
    detail:
      evidenceUnverified === 0
        ? `${String(evidenceVerified)} seal(s) verified`
        : `${String(evidenceUnverified)} fail`,
  });

  // 5 · Settlement's own folds balance (read-only supervision of the source).
  const journalEvents = await deps.source.loadEventsFrom("journal", orgId, 0);
  let journalOk = true;
  if (journalEvents.length > 0) {
    const fold = replayJournal(journalEvents);
    journalOk = fold.ok && trialBalance(fold.projection).balanced;
  }
  checks.push({
    name: "settlement-journal-balanced",
    pass: journalOk,
    detail: journalOk ? null : "journal unfoldable or unbalanced",
  });

  const report: CertificationReport = {
    orgId,
    watermark: await orgWatermark(deps, orgId),
    streamCounts,
    checks,
    pass: checks.every((check) => check.pass),
  };
  return report;
}

export interface Certification {
  readonly ok: boolean;
  readonly reason?: string;
  readonly report?: CertificationReport;
  readonly digest?: string;
}

/**
 * Certify by DOUBLE DERIVATION: the whole report is derived twice and must be
 * byte-identical, or certification fails closed (a nondeterministic
 * certification certifies nothing). The passing digest is recorded as an
 * audit breadcrumb — the tamper-evident register a forged certificate is
 * checked against.
 */
/**
 * The audit action every certification is recorded under.
 *
 * One constant because this string is a contract between a writer and three
 * readers, and the last time the two halves drifted — the writer shouting
 * `PASS` while a reader looked for `pass` — a passing certification was
 * rendered to operators as "not matched".
 */
export const CERTIFICATION_ACTION = "finops.CertificationDerived";

export async function certifyOperations(deps: FinopsDeps, orgId: string): Promise<Certification> {
  const first = await deriveCertification(deps, orgId);
  const second = await deriveCertification(deps, orgId);
  const firstBytes = certificationBytes(first);
  if (firstBytes !== certificationBytes(second)) {
    return { ok: false, reason: "certification_nondeterministic" };
  }
  const digest = deps.digest(firstBytes);
  await deps.store.transact(async (tx) => {
    await tx.writeAudit({
      actor: FINOPS_SYSTEM_ACTOR,
      action: CERTIFICATION_ACTION,
      orgId,
      subject: orgId,
      source: "runner",
      correlationId: deps.newId(),
      eventSeq: 0,
      reason: `${first.pass ? "PASS" : "FAIL"} · ${digest}`,
    });
  });
  return { ok: true, report: first, digest };
}

/** Year-end verification (the runner's year-end job, completed): derive the
 * ended year's close readiness and record the verdict — appending nothing. */
export interface YearEndVerification {
  readonly orgId: string;
  readonly fy: string;
  readonly periodExists: boolean;
  readonly status: string | null;
  readonly awaitingClose: boolean;
  readonly openExceptions: number;
}

export async function verifyYearEnd(
  deps: FinopsDeps,
  orgId: string,
  fy: string,
): Promise<YearEndVerification> {
  const row = await deps.store.loadPeriodFor(orgId, fy);
  if (row === null) {
    return {
      orgId,
      fy,
      periodExists: false,
      status: null,
      awaitingClose: false,
      openExceptions: 0,
    };
  }
  const fold = await foldStream(deps, "period", row.periodId);
  if (fold === null || !fold.ok) {
    return {
      orgId,
      fy,
      periodExists: true,
      status: "unfoldable",
      awaitingClose: true,
      openExceptions: 0,
    };
  }
  const projection = fold.projection as {
    status: string;
    exceptions: { acknowledgedAtSeq: number | null }[];
  };
  const openExceptions = projection.exceptions.filter(
    (exception) => exception.acknowledgedAtSeq === null,
  ).length;
  const verification: YearEndVerification = {
    orgId,
    fy,
    periodExists: true,
    status: projection.status,
    awaitingClose: projection.status === "open",
    openExceptions,
  };
  await deps.store.transact(async (tx) => {
    await tx.writeAudit({
      actor: FINOPS_SYSTEM_ACTOR,
      action: "finops.YearEndVerified",
      orgId,
      subject: row.periodId,
      source: "runner",
      correlationId: deps.newId(),
      eventSeq: 0,
      reason: `${fy} · ${verification.status ?? "none"} · ${String(openExceptions)} open exception(s)`,
    });
  });
  return verification;
}
