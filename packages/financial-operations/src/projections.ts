/**
 * Projection authorities and their verifiers (IP-6_ARCHITECTURE §12).
 *
 * `project*` turns a fold into rows — the ONLY way a finops row is ever
 * produced (the writer calls these inside the append transaction; recovery
 * calls them to heal). `diff*` compares stored rows against the fold — the
 * writer refuses to decide against a row the log does not vouch for (the
 * settlement ADR-7 birthright), and a divergence halts the aggregate.
 */

import { canonicalJson } from "@desiauction/core";

import type { DispatchProjection } from "./dispatch";
import type { ExportProjection } from "./export-run";
import type { PeriodProjection } from "./period";
import type { ProfileProjection } from "./profile";
import type { SeriesProjection } from "./series";
import type {
  DispatchRow,
  DocumentRow,
  ExportRow,
  PeriodDayRow,
  PeriodRow,
  ProfileRow,
  SeriesRow,
} from "./ports";
import { openExceptionsFor } from "./period";
import { canonicalWatermark } from "./watermark";

export function projectProfile(fold: ProfileProjection): ProfileRow {
  return {
    orgId: fold.orgId,
    legalName: fold.legalName,
    posture: fold.posture,
    gstin: fold.gstin,
    autoReceipt: fold.autoReceipt,
    version: fold.version,
    declaredBy: fold.declaredBy,
  };
}

export function projectSeries(fold: SeriesProjection): {
  seriesRow: SeriesRow;
  documentRows: DocumentRow[];
} {
  return {
    seriesRow: {
      seriesId: fold.seriesId,
      orgId: fold.orgId,
      kind: fold.kind,
      fy: fold.fy,
      prefix: fold.prefix,
      status: fold.status,
      documentCount: fold.documents.length,
      registerDigest: fold.registerDigest,
    },
    documentRows: fold.documents.map((doc) => ({
      docId: doc.docId,
      orgId: fold.orgId,
      seriesId: fold.seriesId,
      number: doc.number,
      kind: doc.kind,
      partyType: doc.party.type,
      partyId: doc.party.id,
      partyLabel: doc.party.label,
      amount: doc.amount,
      corrects: doc.corrects,
      sourceRef: doc.sourceRef,
      profileSeq: doc.profileSeq,
      watermark: canonicalWatermark(doc.watermark),
      contentDigest: doc.contentDigest,
      issuedAtSeq: doc.issuedAtSeq,
      issuedBy: doc.issuedBy,
    })),
  };
}

export function projectDispatch(fold: DispatchProjection): DispatchRow {
  return {
    dispatchId: fold.dispatchId,
    orgId: fold.orgId,
    status: fold.status,
    channel: fold.channel,
    recipientRef: fold.recipientRef,
    templateId: fold.templateId,
    templateVersion: fold.templateVersion,
    subjectRef: fold.subjectRef,
    providerRef: fold.providerRef,
    providerEventRef: fold.providerEventRef,
    failureCode: fold.failureCode,
    requestedBy: fold.requestedBy,
  };
}

export function projectExport(fold: ExportProjection): ExportRow {
  return {
    exportId: fold.exportId,
    orgId: fold.orgId,
    status: fold.status,
    kind: fold.kind,
    params: fold.params,
    requestedBy: fold.requestedBy,
    artifactRef: fold.artifactRef,
    artifactDigest: fold.artifactDigest,
    rowCount: fold.rowCount,
    watermark: fold.watermark === null ? null : canonicalWatermark(fold.watermark),
    failureCode: fold.failureCode,
  };
}

export function projectPeriod(fold: PeriodProjection): {
  periodRow: PeriodRow;
  dayRows: PeriodDayRow[];
} {
  return {
    periodRow: {
      periodId: fold.periodId,
      orgId: fold.orgId,
      fy: fold.fy,
      status: fold.status,
      openedBy: fold.openedBy,
      openingWatermark: canonicalWatermark(fold.openingWatermark),
      lastWatermark: canonicalWatermark(fold.lastWatermark),
      evidence: fold.evidence,
      closedAtSeq: fold.closedAtSeq,
      openExceptions: openExceptionsFor(fold),
    },
    dayRows: Object.values(fold.days)
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((day) => ({
        periodId: fold.periodId,
        orgId: fold.orgId,
        date: day.date,
        attestor: day.attestor,
        attestorKind: day.attestorKind,
        failures: day.failures,
        checks: day.checks.map((check) => ({
          name: check.name,
          outcome: check.outcome,
          ...(check.detail !== null ? { detail: check.detail } : {}),
        })),
        watermark: canonicalWatermark(day.watermark),
        attestedAtSeq: day.attestedAtSeq,
      })),
  };
}

// --- Verification (fold vs rows) -----------------------------------------------------

function mismatch(label: string, stored: unknown, expected: unknown): string {
  return `${label}: stored=${canonicalJson(stored)} expected=${canonicalJson(expected)}`;
}

function compare(label: string, stored: unknown, expected: unknown, out: string[]): void {
  if (canonicalJson(stored) !== canonicalJson(expected)) {
    out.push(mismatch(label, stored, expected));
  }
}

export function diffProfile(stored: ProfileRow | null, fold: ProfileProjection): string[] {
  const expected = projectProfile(fold);
  if (stored === null) {
    return [mismatch("profile_row_missing", null, expected.orgId)];
  }
  const out: string[] = [];
  compare("profile", stored, expected, out);
  return out;
}

export function diffSeries(
  storedSeries: SeriesRow | null,
  storedDocuments: readonly DocumentRow[],
  fold: SeriesProjection,
): string[] {
  const expected = projectSeries(fold);
  if (storedSeries === null) {
    return [mismatch("series_row_missing", null, expected.seriesRow.seriesId)];
  }
  const out: string[] = [];
  compare("series", storedSeries, expected.seriesRow, out);
  compare(
    "documents",
    [...storedDocuments].sort((a, b) => a.number - b.number),
    expected.documentRows,
    out,
  );
  return out;
}

export function diffDispatch(stored: DispatchRow | null, fold: DispatchProjection): string[] {
  const expected = projectDispatch(fold);
  if (stored === null) {
    return [mismatch("dispatch_row_missing", null, expected.dispatchId)];
  }
  const out: string[] = [];
  compare("dispatch", stored, expected, out);
  return out;
}

export function diffExport(stored: ExportRow | null, fold: ExportProjection): string[] {
  const expected = projectExport(fold);
  if (stored === null) {
    return [mismatch("export_row_missing", null, expected.exportId)];
  }
  const out: string[] = [];
  compare("export", stored, expected, out);
  return out;
}

export function diffPeriod(
  storedPeriod: PeriodRow | null,
  storedDays: readonly PeriodDayRow[],
  fold: PeriodProjection,
): string[] {
  const expected = projectPeriod(fold);
  if (storedPeriod === null) {
    return [mismatch("period_row_missing", null, expected.periodRow.periodId)];
  }
  const out: string[] = [];
  compare("period", storedPeriod, expected.periodRow, out);
  compare(
    "period_days",
    [...storedDays].sort((a, b) => a.date.localeCompare(b.date)),
    expected.dayRows,
    out,
  );
  return out;
}
