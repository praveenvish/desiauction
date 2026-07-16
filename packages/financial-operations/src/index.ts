/**
 * @desiauction/financial-operations — the Financial Operations bounded context
 * (IP-6, M-IP6-1).
 *
 * Pure domain: five aggregates (TaxProfile · DocumentSeries · Dispatch ·
 * ExportRun · FiscalPeriod), their reducers and machines, the closed 23-type
 * event catalog, the pure command handlers, the finops capability engine, the
 * follower and runner decision cores, and the ports. Zero IO, zero ambient
 * time, zero randomness.
 *
 * CONSTITUTIONAL (IP-6_ARCHITECTURE, ADR-1): this context owns operational
 * TESTIMONY, never financial truth. It holds no write path to settlement or
 * auction history, calculates no money, and every quoted figure re-derives
 * from the frozen streams at its pinned watermark. The server tier (writer,
 * store, follower, runner) lives under `./server`.
 */

export {
  DISPATCH_EVENT_TYPES,
  EXPORT_EVENT_TYPES,
  FINOPS_EVENT_TYPES,
  FINOPS_STREAM_TYPES,
  FINOPS_SYSTEM_ACTOR,
  PERIOD_EVENT_TYPES,
  PROFILE_EVENT_TYPES,
  SERIES_EVENT_TYPES,
  isFinopsEventType,
} from "./events";
export type {
  DispatchEventType,
  ExportEventType,
  FinopsDecision,
  FinopsEventEnvelope,
  FinopsEventType,
  FinopsNewEvent,
  FinopsReplayFailure,
  FinopsReplayFailureReason,
  FinopsStreamType,
  PeriodEventType,
  ProfileEventType,
  SeriesEventType,
} from "./events";

export {
  canonicalWatermark,
  fiscalYearBounds,
  fiscalYearOf,
  isFiscalYear,
  istDateOf,
  previousDate,
  watermarkAdvances,
  watermarkKey,
  watermarkOf,
} from "./watermark";
export type { Watermark } from "./watermark";

export { TAX_POSTURES, isGstinShaped, isTaxPosture, replayProfile } from "./profile";
export type { ProfileProjection, ProfileReplayResult, TaxPosture } from "./profile";

export { SERIES_KINDS, isSeriesKind, replaySeries } from "./series";
export type {
  DocumentParty,
  DocumentProjection,
  SeriesKind,
  SeriesProjection,
  SeriesReplayResult,
  SeriesStatus,
} from "./series";

export { DISPATCH_CHANNELS, isDispatchChannel, replayDispatch } from "./dispatch";
export type {
  DispatchChannel,
  DispatchProjection,
  DispatchReplayResult,
  DispatchStatus,
} from "./dispatch";

export { EXPORT_KINDS, isExportKind, replayExport } from "./export-run";
export type { ExportKind, ExportProjection, ExportReplayResult, ExportStatus } from "./export-run";

export {
  EXCEPTION_KINDS,
  closeReadiness,
  isExceptionKind,
  openExceptionsFor,
  replayPeriod,
} from "./period";
export type {
  AttestationCheck,
  CheckOutcome,
  CloseReadiness,
  DayProjection,
  ExceptionKind,
  ExceptionProjection,
  PeriodProjection,
  PeriodReplayResult,
  PeriodStatus,
} from "./period";

export {
  decideAmendProfile,
  decideAttestDay,
  decideClosePeriod,
  decideCloseSeries,
  decideCompleteExport,
  decideDeclareProfile,
  decideFailExport,
  decideMarkDispatchConfirmed,
  decideMarkDispatchFailed,
  decideMarkDispatchSent,
  decideNoteException,
  decideOpenPeriod,
  decideOpenSeries,
  decideReopenPeriod,
  decideRequestDispatch,
  decideRequestExport,
} from "./commands";
export type {
  AmendProfileInput,
  AttestDayInput,
  ClosePeriodInput,
  CloseSeriesInput,
  CompleteExportInput,
  DeclareProfileInput,
  NoteExceptionInput,
  OpenPeriodInput,
  OpenSeriesInput,
  RequestDispatchInput,
  RequestExportInput,
} from "./commands";

export {
  HEALTH_COMPONENTS,
  attestationDigestBytes,
  certificationBytes,
  composeFiscalEvidence,
  deriveHealth,
  evaluateOperationalChecklist,
  overallHealth,
  periodTimeline,
} from "./operations";
export type {
  CertificationCheck,
  CertificationReport,
  ComponentHealth,
  ExportEvidencePin,
  FiscalEvidenceV2,
  FiscalTimelineEntry,
  HealthComponent,
  HealthStatus,
  OperationalChecklistInputs,
  OperationalObservations,
  SeriesEvidencePin,
} from "./operations";

export { buildExportArtifact, paiseToDecimalString } from "./exporters";
export type { BuiltArtifact, ExportDocument, ExportInputs, ExportSeriesMeta } from "./exporters";

export {
  CORRECTION_CAUSES,
  correctionQuote,
  decideIssueDocument,
  formattedNumber,
  invoiceQuote,
  profileAt,
  receiptQuote,
  renderDocumentPayload,
} from "./documents";
export type {
  DocumentQuote,
  IssueDocumentInput,
  QuoteLine,
  QuoteResult,
  RenderInputs,
} from "./documents";

export {
  FINOPS_CAPABILITY_SETS,
  finopsCapabilitiesOf,
  hasFinopsCapability,
  isFinopsCapabilitySet,
} from "./capabilities";
export type { FinopsCapability, FinopsCapabilitySet } from "./capabilities";

export { streamLags, totalLag, verifyBatch, watermarkFromCursors } from "./follower";
export type { BatchVerdict, CursorState, StreamHead, StreamLag } from "./follower";

export {
  DEFAULT_LEASE_MS,
  DEFAULT_MAX_ATTEMPTS,
  JOB_KINDS,
  SCHEDULE_SLOTS,
  attestationDateFor,
  checklistGreen,
  dailyOpsJobKey,
  endedFiscalYearFor,
  evaluateFoundationChecklist,
  exceptionKindForCheck,
  followerJobKey,
  isJobKind,
  leaseExpired,
  nextDailyDueMs,
  nextDueMs,
  nextYearEndDueMs,
  retryDecision,
  yearEndJobKey,
} from "./runner";
export type {
  FoundationChecklistInputs,
  JobKind,
  JobSnapshot,
  JobState,
  RetryDecision,
  ScheduleSlot,
} from "./runner";

export {
  diffDispatch,
  diffExport,
  diffPeriod,
  diffProfile,
  diffSeries,
  projectDispatch,
  projectExport,
  projectPeriod,
  projectProfile,
  projectSeries,
} from "./projections";

export type {
  ArtifactStorePort,
  CapturedPaymentRef,
  CursorRow,
  DeliveryCallback,
  DeliveryPort,
  DeliveryRequest,
  DeliverySendResult,
  DigestFn,
  DispatchRow,
  DocumentRow,
  ExportRow,
  FinopsAppendInput,
  FinopsAuditInput,
  FinopsStore,
  FinopsTx,
  JobRow,
  OrgDirectoryPort,
  PeriodDayRow,
  PeriodRow,
  ProfileRow,
  ReferencePort,
  ScheduleRow,
  SeriesRow,
  SettlementSourcePort,
  SettlementStreamHead,
} from "./ports";
