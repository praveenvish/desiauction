/**
 * The FinOps server tier (IP-6, M-IP6-1): the writer (single mutation
 * authority), the follower, the runner core, the Postgres store and the four
 * foundation snapshots. Imported by `apps/web` (human commands, verification
 * surfaces) and `apps/finops-runner` (scheduled work) — BOTH processes funnel
 * every append through the ONE writer module; the unique (stream_type,
 * stream_id, seq) makes any race loud.
 *
 * This subtree is the only part of the package allowed to touch
 * `@desiauction/db` (dependency-cruiser-enforced); `src/*` outside `server/`
 * stays pure.
 */

export { finopsDeps, type FinopsDeps, type FinopsDepsOverrides } from "./deps";
export {
  createFinopsStore,
  createOrgDirectory,
  createOrgReference,
  createSettlementSource,
  sha256,
} from "./store";
export {
  amendProfile,
  attestDay,
  cancelDispatch,
  closePeriod,
  closeSeries,
  completeExport,
  confirmDispatchManually,
  declareProfile,
  failExport,
  foldStream,
  issueCorrection,
  issueInvoice,
  issueReceipt,
  requestExportSystem,
  markDispatchConfirmed,
  markDispatchFailed,
  markDispatchSent,
  noteException,
  openPeriod,
  openSeries,
  orgWatermark,
  recoverDispatch,
  recoverExport,
  recoverPeriod,
  recoverProfile,
  recoverSeries,
  reopenPeriod,
  requestDispatch,
  requestExport,
  verifyOrgFinops,
  type Executor,
  type FinopsAck,
  type FinopsAckFailure,
  type FinopsActor,
  type RecoveryResult,
} from "./writer";
export { followerLag, rewindFollower, runFollower, type FollowerRunResult } from "./follower";
export {
  drainJobsOnce,
  ensureSchedules,
  followAllOrgs,
  runDailyOps,
  runSchedulesOnce,
  runYearEnd,
  runnerTick,
  type DrainResult,
  type JobHandler,
  type ScheduleTickResult,
} from "./runner-core";
export {
  composeCloseEvidence,
  reproduceFiscalEvidence,
  type EvidenceReproduction,
} from "./evidence";
export {
  CERTIFICATION_ACTION,
  certifyOperations,
  checklistInputsFrom,
  gatherObservations,
  superviseOperations,
  verifyYearEnd,
  type Certification,
  type SupervisorVerdict,
  type YearEndVerification,
} from "./governance";
export {
  archiveSnapshot,
  certificationRegisterSnapshot,
  certificationSnapshot,
  complianceQueueSnapshot,
  complianceSnapshot,
  dispatchQueueSnapshot,
  dispatchSnapshot,
  documentSnapshot,
  evidenceRegisterSnapshot,
  evidenceSnapshot,
  exportSnapshot,
  fiscalCloseSnapshot,
  fiscalTimelineSnapshot,
  followerHealthSnapshot,
  issuanceSnapshot,
  operationalChecklistSnapshot,
  operationalSnapshot,
  operationsDashboardSnapshot,
  providerHealthSnapshot,
  retrySnapshot,
  runnerHealthSnapshot,
  seriesSnapshot,
  watermarkSnapshot,
  type ArchiveSnapshot,
  type CertificationRegisterSnapshot,
  type CertificationSnapshot,
  type ComplianceQueueSnapshot,
  type ComplianceSnapshot,
  type DispatchQueueSnapshot,
  type DispatchSnapshot,
  type DocumentSnapshot,
  type EvidenceRegisterSnapshot,
  type EvidenceSnapshot,
  type ExportSnapshot,
  type FiscalCloseSnapshot,
  type FiscalTimelineSnapshot,
  type FollowerHealthSnapshot,
  type IssuanceSnapshot,
  type OperationalChecklistSnapshot,
  type OperationalSnapshot,
  type OperationsDashboardSnapshot,
  type ProviderHealthSnapshot,
  type RetrySnapshot,
  type RunnerHealthSnapshot,
  type SeriesSnapshot,
  type WatermarkSnapshot,
} from "./snapshots";
export {
  issueDueReceipts,
  receiptCandidates,
  reproduceDocument,
  type AutoIssueResult,
  type ReceiptCandidate,
  type Reproduction,
} from "./documents";
export {
  bytesDigest,
  createFilesystemArtifactStore,
  createInAppAdapter,
  createOutboxAdapter,
} from "./adapters";
export {
  bucketArtifactStoreFromEnv,
  createBucketArtifactStore,
  type BucketArtifactConfig,
  type BucketArtifactEnv,
} from "./s3-artifact-store";
export {
  assembleDispatchBody,
  enqueueDispatchSends,
  enqueueExportGenerations,
  gatherExportInputs,
  ingestDeliveryCallback,
  regenerateExportArtifact,
  requeueDeadJob,
  retryDispatch,
  retryExport,
  runDailyExport,
  runDispatchSend,
  runExportGenerate,
  verifyExport,
  type AssembledBody,
  type ExportVerification,
} from "./pipelines";
