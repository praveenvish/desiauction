/**
 * Pure command handlers (IP-6_ARCHITECTURE §14). Every mutation enters the
 * FinOps Writer as one of these: `(current fold, input) → Decision` — events
 * to append or a deterministic rejection reason, never a row write, never IO.
 *
 * No handler here issues documents: DocumentIssued/CorrectionIssued have no
 * command surface in M-IP6-1 (they arrive with M-IP6-2 — the settlement ADR-3
 * discipline). No handler calculates money — there is no money to calculate
 * in the foundation; watermarks and evidence are pinned facts supplied by the
 * caller from frozen folds.
 */

import type { FinopsDecision, FinopsNewEvent } from "./events";
import { isGstinShaped, isTaxPosture, type ProfileProjection, type TaxPosture } from "./profile";
import { isSeriesKind, type SeriesKind, type SeriesProjection } from "./series";
import { isDispatchChannel, type DispatchChannel, type DispatchProjection } from "./dispatch";
import { isExportKind, type ExportKind, type ExportProjection } from "./export-run";
import {
  closeReadiness,
  isExceptionKind,
  openExceptionsFor,
  type AttestationCheck,
  type ExceptionKind,
  type PeriodProjection,
} from "./period";
import {
  fiscalYearBounds,
  isFiscalYear,
  watermarkAdvances,
  canonicalWatermark,
  type Watermark,
} from "./watermark";

const reject = (reason: string): FinopsDecision => ({ ok: false, reason });
const accept = (events: FinopsNewEvent[]): FinopsDecision => ({ ok: true, events });

// --- TaxProfile ----------------------------------------------------------------------

export interface DeclareProfileInput {
  readonly orgId: string;
  readonly legalName: string;
  readonly posture: TaxPosture;
  readonly gstin?: string;
  readonly autoReceipt?: boolean;
}

function declarationInvalid(input: {
  legalName: string;
  posture: string;
  gstin?: string | undefined;
}): string | null {
  if (input.legalName.trim() === "") {
    return "legal_name_required";
  }
  if (!isTaxPosture(input.posture)) {
    return "posture_invalid";
  }
  if (
    input.posture === "gst-registered" &&
    (input.gstin === undefined || !isGstinShaped(input.gstin))
  ) {
    return "gstin_invalid";
  }
  if (input.posture === "none" && input.gstin !== undefined) {
    return "gstin_forbidden_without_registration";
  }
  return null;
}

export function decideDeclareProfile(
  existing: ProfileProjection | null,
  input: DeclareProfileInput,
): FinopsDecision {
  if (existing !== null) {
    return reject("profile_exists");
  }
  const invalid = declarationInvalid(input);
  if (invalid !== null) {
    return reject(invalid);
  }
  return accept([
    {
      streamType: "profile",
      streamId: input.orgId,
      type: "ProfileDeclared",
      payload: {
        orgId: input.orgId,
        legalName: input.legalName,
        posture: input.posture,
        ...(input.gstin !== undefined ? { gstin: input.gstin } : {}),
        autoReceipt: input.autoReceipt ?? false,
      },
    },
  ]);
}

export interface AmendProfileInput {
  readonly reason: string;
  readonly legalName?: string;
  readonly posture?: TaxPosture;
  /** `null` clears the GSTIN (deregistration); absent leaves it untouched. */
  readonly gstin?: string | null;
  readonly autoReceipt?: boolean;
}

export function decideAmendProfile(
  profile: ProfileProjection | null,
  input: AmendProfileInput,
): FinopsDecision {
  if (profile === null) {
    return reject("profile_missing");
  }
  if (input.reason.trim() === "") {
    return reject("reason_required");
  }
  const next = {
    legalName: input.legalName ?? profile.legalName,
    posture: input.posture ?? profile.posture,
    gstin: input.gstin === undefined ? (profile.gstin ?? undefined) : (input.gstin ?? undefined),
  };
  const invalid = declarationInvalid(next);
  if (invalid !== null) {
    return reject(invalid);
  }
  return accept([
    {
      streamType: "profile",
      streamId: profile.orgId,
      type: "ProfileAmended",
      payload: {
        reason: input.reason,
        ...(input.legalName !== undefined ? { legalName: input.legalName } : {}),
        ...(input.posture !== undefined ? { posture: input.posture } : {}),
        ...(input.gstin !== undefined ? { gstin: input.gstin } : {}),
        ...(input.autoReceipt !== undefined ? { autoReceipt: input.autoReceipt } : {}),
      },
    },
  ]);
}

// --- DocumentSeries ------------------------------------------------------------------

export interface OpenSeriesInput {
  readonly seriesId: string;
  readonly orgId: string;
  readonly kind: SeriesKind;
  readonly fy: string;
  readonly prefix: string;
}

export function decideOpenSeries(
  existing: SeriesProjection | null,
  keyTaken: boolean,
  input: OpenSeriesInput,
): FinopsDecision {
  if (existing !== null) {
    return reject("series_exists");
  }
  // ONE numbering lane per org · kind · fiscal year, forever — a closed series
  // still owns its key (unique index in the projection makes this structural).
  if (keyTaken) {
    return reject("series_key_taken");
  }
  if (!isSeriesKind(input.kind)) {
    return reject("series_kind_invalid");
  }
  if (!isFiscalYear(input.fy)) {
    return reject("fy_invalid");
  }
  if (input.prefix.trim() === "") {
    return reject("prefix_required");
  }
  return accept([
    {
      streamType: "series",
      streamId: input.seriesId,
      type: "SeriesOpened",
      payload: {
        seriesId: input.seriesId,
        orgId: input.orgId,
        kind: input.kind,
        fy: input.fy,
        prefix: input.prefix,
      },
    },
  ]);
}

export interface CloseSeriesInput {
  /** The digest of the canonical register bytes — hashed at the edge. */
  readonly registerDigest: string;
}

export function decideCloseSeries(
  series: SeriesProjection | null,
  input: CloseSeriesInput,
): FinopsDecision {
  if (series === null) {
    return reject("series_missing");
  }
  if (series.status !== "open") {
    return reject("series_closed");
  }
  if (input.registerDigest === "") {
    return reject("register_digest_required");
  }
  return accept([
    {
      streamType: "series",
      streamId: series.seriesId,
      type: "SeriesClosed",
      payload: { count: series.documents.length, registerDigest: input.registerDigest },
    },
  ]);
}

// --- Dispatch ------------------------------------------------------------------------

export interface RequestDispatchInput {
  readonly dispatchId: string;
  readonly orgId: string;
  readonly channel: DispatchChannel;
  readonly recipientRef: string;
  readonly templateId: string;
  readonly templateVersion: string;
  readonly subjectRef: string;
}

export function decideRequestDispatch(
  existing: DispatchProjection | null,
  input: RequestDispatchInput,
): FinopsDecision {
  if (existing !== null) {
    return reject("dispatch_exists");
  }
  if (!isDispatchChannel(input.channel)) {
    return reject("channel_invalid");
  }
  if (input.recipientRef === "" || input.templateId === "" || input.subjectRef === "") {
    return reject("dispatch_incomplete");
  }
  return accept([
    {
      streamType: "dispatch",
      streamId: input.dispatchId,
      type: "DispatchRequested",
      payload: {
        dispatchId: input.dispatchId,
        orgId: input.orgId,
        channel: input.channel,
        recipientRef: input.recipientRef,
        templateId: input.templateId,
        templateVersion: input.templateVersion,
        subjectRef: input.subjectRef,
      },
    },
  ]);
}

export function decideMarkDispatchSent(
  dispatch: DispatchProjection | null,
  providerRef: string,
): FinopsDecision {
  if (dispatch === null) {
    return reject("dispatch_missing");
  }
  if (dispatch.status !== "requested") {
    return reject("dispatch_not_requested");
  }
  if (providerRef === "") {
    return reject("provider_ref_required");
  }
  return accept([
    {
      streamType: "dispatch",
      streamId: dispatch.dispatchId,
      type: "DispatchSent",
      payload: { providerRef },
    },
  ]);
}

export function decideMarkDispatchConfirmed(
  dispatch: DispatchProjection | null,
  providerEventRef: string,
): FinopsDecision {
  if (dispatch === null) {
    return reject("dispatch_missing");
  }
  if (dispatch.status !== "sent") {
    return reject("dispatch_not_sent");
  }
  if (providerEventRef === "") {
    return reject("provider_event_ref_required");
  }
  return accept([
    {
      streamType: "dispatch",
      streamId: dispatch.dispatchId,
      type: "DispatchConfirmed",
      payload: { providerEventRef },
    },
  ]);
}

export function decideMarkDispatchFailed(
  dispatch: DispatchProjection | null,
  code: string,
  detail?: string,
): FinopsDecision {
  if (dispatch === null) {
    return reject("dispatch_missing");
  }
  if (dispatch.status !== "requested" && dispatch.status !== "sent") {
    return reject("dispatch_terminal");
  }
  if (code === "") {
    return reject("failure_code_required");
  }
  return accept([
    {
      streamType: "dispatch",
      streamId: dispatch.dispatchId,
      type: "DispatchFailed",
      payload: { code, ...(detail !== undefined ? { detail } : {}) },
    },
  ]);
}

// --- ExportRun -----------------------------------------------------------------------

export interface RequestExportInput {
  readonly exportId: string;
  readonly orgId: string;
  readonly kind: ExportKind;
  readonly params: Readonly<Record<string, unknown>>;
}

export function decideRequestExport(
  existing: ExportProjection | null,
  input: RequestExportInput,
): FinopsDecision {
  if (existing !== null) {
    return reject("export_exists");
  }
  if (!isExportKind(input.kind)) {
    return reject("export_kind_invalid");
  }
  return accept([
    {
      streamType: "export",
      streamId: input.exportId,
      type: "ExportRequested",
      payload: {
        exportId: input.exportId,
        orgId: input.orgId,
        kind: input.kind,
        params: input.params,
      },
    },
  ]);
}

export interface CompleteExportInput {
  readonly artifactRef: string;
  readonly artifactDigest: string;
  readonly rowCount: number;
  readonly watermark: Watermark;
}

export function decideCompleteExport(
  run: ExportProjection | null,
  input: CompleteExportInput,
): FinopsDecision {
  if (run === null) {
    return reject("export_missing");
  }
  if (run.status !== "requested") {
    return reject("export_terminal");
  }
  if (
    input.artifactRef === "" ||
    input.artifactDigest === "" ||
    !Number.isSafeInteger(input.rowCount) ||
    input.rowCount < 0
  ) {
    return reject("export_result_invalid");
  }
  return accept([
    {
      streamType: "export",
      streamId: run.exportId,
      type: "ExportCompleted",
      payload: {
        artifactRef: input.artifactRef,
        artifactDigest: input.artifactDigest,
        rowCount: input.rowCount,
        watermark: canonicalWatermark(input.watermark),
      },
    },
  ]);
}

export function decideFailExport(
  run: ExportProjection | null,
  code: string,
  detail?: string,
): FinopsDecision {
  if (run === null) {
    return reject("export_missing");
  }
  if (run.status !== "requested") {
    return reject("export_terminal");
  }
  if (code === "") {
    return reject("failure_code_required");
  }
  return accept([
    {
      streamType: "export",
      streamId: run.exportId,
      type: "ExportFailed",
      payload: { code, ...(detail !== undefined ? { detail } : {}) },
    },
  ]);
}

// --- FiscalPeriod --------------------------------------------------------------------

export interface OpenPeriodInput {
  readonly periodId: string;
  readonly orgId: string;
  readonly fy: string;
  readonly openingWatermark: Watermark;
}

export function decideOpenPeriod(
  existing: PeriodProjection | null,
  keyTaken: boolean,
  input: OpenPeriodInput,
): FinopsDecision {
  if (existing !== null) {
    return reject("period_exists");
  }
  // ONE period per org · fiscal year, forever (reopen re-enters the same one).
  if (keyTaken) {
    return reject("period_exists_for_fy");
  }
  if (!isFiscalYear(input.fy)) {
    return reject("fy_invalid");
  }
  return accept([
    {
      streamType: "period",
      streamId: input.periodId,
      type: "PeriodOpened",
      payload: {
        periodId: input.periodId,
        orgId: input.orgId,
        fy: input.fy,
        openingWatermark: canonicalWatermark(input.openingWatermark),
      },
    },
  ]);
}

export interface AttestDayInput {
  readonly date: string;
  readonly checks: readonly AttestationCheck[];
  readonly watermark: Watermark;
  /** Whether the writer executes this under the system sentinel. */
  readonly system: boolean;
}

export function decideAttestDay(
  period: PeriodProjection | null,
  input: AttestDayInput,
): FinopsDecision {
  if (period === null) {
    return reject("period_missing");
  }
  if (period.status !== "open") {
    return reject("period_not_open");
  }
  const bounds = fiscalYearBounds(period.fy);
  if (input.date < bounds.start || input.date > bounds.end) {
    return reject("date_outside_period");
  }
  if (input.checks.length === 0) {
    return reject("checks_required");
  }
  if (!watermarkAdvances(period.lastWatermark, input.watermark)) {
    return reject("watermark_regression");
  }
  const failures = input.checks.filter((check) => check.outcome === "fail").length;
  if (input.system && (failures > 0 || openExceptionsFor(period, input.date) > 0)) {
    return reject("system_cannot_attest_exceptions");
  }
  return accept([
    {
      streamType: "period",
      streamId: period.periodId,
      type: "DayAttested",
      payload: {
        date: input.date,
        checks: input.checks.map((check) => ({
          name: check.name,
          outcome: check.outcome,
          ...(check.detail !== null ? { detail: check.detail } : {}),
        })),
        watermark: canonicalWatermark(input.watermark),
      },
    },
  ]);
}

export interface NoteExceptionInput {
  readonly date: string;
  readonly kind: ExceptionKind;
  readonly detail: string;
  readonly sourceRef?: string;
}

export function decideNoteException(
  period: PeriodProjection | null,
  input: NoteExceptionInput,
): FinopsDecision {
  if (period === null) {
    return reject("period_missing");
  }
  if (period.status !== "open") {
    return reject("period_not_open");
  }
  const bounds = fiscalYearBounds(period.fy);
  if (input.date < bounds.start || input.date > bounds.end) {
    return reject("date_outside_period");
  }
  if (!isExceptionKind(input.kind)) {
    return reject("exception_kind_invalid");
  }
  if (input.detail.trim() === "") {
    return reject("detail_required");
  }
  return accept([
    {
      streamType: "period",
      streamId: period.periodId,
      type: "ExceptionNoted",
      payload: {
        date: input.date,
        kind: input.kind,
        detail: input.detail,
        ...(input.sourceRef !== undefined ? { sourceRef: input.sourceRef } : {}),
      },
    },
  ]);
}

export interface ClosePeriodInput {
  readonly closingWatermark: Watermark;
  readonly evidence: Readonly<Record<string, unknown>>;
  /** The IST date the close is attempted — the FY must have fully elapsed. */
  readonly todayIst: string;
}

export function decideClosePeriod(
  period: PeriodProjection | null,
  input: ClosePeriodInput,
): FinopsDecision {
  if (period === null) {
    return reject("period_missing");
  }
  if (period.status !== "open") {
    return reject("period_not_open");
  }
  // A year is sealed only once it has fully elapsed (IST).
  if (input.todayIst <= fiscalYearBounds(period.fy).end) {
    return reject("fiscal_year_not_ended");
  }
  if (!watermarkAdvances(period.lastWatermark, input.closingWatermark)) {
    return reject("watermark_regression");
  }
  const readiness = closeReadiness(period);
  if (!readiness.ready) {
    return reject(readiness.openExceptions > 0 ? "exceptions_open" : "days_unattested");
  }
  return accept([
    {
      streamType: "period",
      streamId: period.periodId,
      type: "PeriodClosed",
      payload: {
        closingWatermark: canonicalWatermark(input.closingWatermark),
        evidence: input.evidence,
      },
    },
  ]);
}

export function decideReopenPeriod(
  period: PeriodProjection | null,
  reason: string,
): FinopsDecision {
  if (period === null) {
    return reject("period_missing");
  }
  if (period.status !== "closed" || period.closedAtSeq === null) {
    return reject("period_not_closed");
  }
  if (reason.trim() === "") {
    return reject("reason_required");
  }
  return accept([
    {
      streamType: "period",
      streamId: period.periodId,
      type: "PeriodReopened",
      payload: { reason, compensates: period.closedAtSeq },
    },
  ]);
}
