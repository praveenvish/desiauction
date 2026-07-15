/**
 * @desiauction/settlement — the Settlement bounded context (IP-5).
 *
 * Pure domain: machines, reducers, posting templates, obligation computation,
 * checkpoints, capabilities and ports. Zero IO, zero ambient time, zero
 * randomness — the frozen `packages/core` discipline, verbatim. The Settlement
 * Writer (apps/web) is the single mutation authority; this package decides.
 */

export {
  CASE_EVENT_TYPES,
  JOURNAL_EVENT_TYPES,
  PAYMENT_EVENT_TYPES,
  SETTLEMENT_EVENT_TYPES,
  STREAM_TYPES,
  isCaseEventType,
  isJournalEventType,
  isPaymentEventType,
  isSettlementEventType,
} from "./events";
export type {
  CaseEventType,
  Decision,
  JournalEventType,
  NewEvent,
  PaymentEventType,
  ReplayFailure,
  ReplayFailureReason,
  SettlementEventEnvelope,
  SettlementEventType,
  StreamType,
} from "./events";

export {
  CASE_MACHINE,
  CASE_STATUSES,
  OBLIGATION_BASES,
  OVERRIDE_COMMANDS,
  caseCommandAllowed,
  caseFullyDischarged,
  isObligationBasis,
  outstandingOf,
  replayCase,
  totalObligations,
} from "./case";
export type {
  CaseCommand,
  CaseMachineEdge,
  CaseProjection,
  CaseReplayResult,
  CaseStatus,
  ObligationBasis,
  ObligationProjection,
} from "./case";

export {
  POSTING_TEMPLATES,
  REFUND_LIABILITY_ACCOUNT,
  buildCollectionPosting,
  buildObligationPosting,
  buildRefundPosting,
  buildWaiverPosting,
  caseControlAccount,
  duesAccount,
  emptyJournal,
  foldJournalEvents,
  fundsAccount,
  isPostingTemplate,
  parseAccount,
  postingsForCase,
  refundLiability,
  refundReinstatement,
  replayJournal,
  statementOf,
  trialBalance,
  validatePostingShape,
  walletOf,
  wallets,
  waivedAccount,
} from "./journal";
export type {
  AccountBalance,
  AccountFamily,
  BuiltPosting,
  JournalProjection,
  JournalReplayResult,
  LegDirection,
  ParsedAccount,
  PostingLeg,
  PostingRecord,
  PostingTemplate,
  ReceiptRecord,
  StatementLine,
  TrialBalance,
  Wallet,
} from "./journal";

export {
  PAYMENT_MACHINE,
  PAYMENT_METHODS,
  PAYMENT_STATUSES,
  isManualMethod,
  isPaymentMethod,
  paymentCommandAllowed,
  refundableOf,
  replayPayment,
} from "./payment";
export type {
  PaymentCommand,
  PaymentMachineEdge,
  PaymentMethod,
  PaymentProjection,
  PaymentReplayResult,
  PaymentStatus,
} from "./payment";

export {
  COLLECTION_POLICIES,
  collectionCommandId,
  collectionsSummary,
  coordinationEffects,
  decideAttestCapture,
  decideExpirePayment,
  decideInitiatePayment,
  decideManualRefund,
  decideWebhookEvent,
  paymentHasEffects,
} from "./collections";
export type {
  AttestCaptureInput,
  CollectionPolicy,
  CollectionRejection,
  CollectionsSummary,
  CoordinationContext,
  CoordinationEffect,
  InitiatePaymentInput,
  ManualRefundInput,
  WebhookFacts,
} from "./collections";

export {
  canonicalSourceBytes,
  committedByTeam,
  computeObligations,
  foldSource,
  verifySource,
} from "./intake";
export type {
  IntakePin,
  ObligationItem,
  ObligationsResult,
  SourceFold,
  SourceFoldResult,
  VerifyOutcome,
  VerifyReason,
} from "./intake";

export {
  buildPolicyEvent,
  decideAdjust,
  decideClose,
  decideComputeObligations,
  decideOpenCase,
  decideReopen,
  decideSettle,
  decideVerifyCase,
  decideVoid,
  decideWaive,
  derivedCommandId,
  policyFor,
  sourceStreamId,
} from "./commands";
export type {
  AdjustInput,
  CloseInput,
  OpenCaseInput,
  PolicyInput,
  PolicyName,
  PolicyResult,
  RejectionReason,
  ReopenInput,
  VoidInput,
  WaiveInput,
} from "./commands";

export {
  CHECKPOINT_CADENCE,
  canonicalJournalBytes,
  checkpointDue,
  checkpointOf,
  deriveCheckpointChain,
  foldFromCheckpoint,
  parseJournalProjection,
  verifyCheckpoint,
} from "./checkpoint";
export type {
  CheckpointChainResult,
  CheckpointVerification,
  CheckpointedFoldResult,
  JournalCheckpoint,
} from "./checkpoint";

export {
  diffCase,
  diffJournal,
  diffPayment,
  projectCase,
  projectJournal,
  projectPayment,
} from "./verify";

export {
  caseFinancial,
  casePostings,
  closureSummary,
  closureTimeline,
  collectionSummary,
  decideCloseCase,
  journalSummary,
  reconciledOverlay,
  verifyClosure,
} from "./closure";
export type {
  CaseFinancial,
  ClosureCheck,
  ClosureCheckName,
  ClosureEvidence,
  ClosureInput,
  ClosureSummary,
  ClosureVerification,
  JournalSummaryLine,
  ReconciledOverlay,
  TeamCollection,
  TimelineRow,
} from "./closure";

export {
  SETTLEMENT_CAPABILITY_SETS,
  hasSettlementCapability,
  isSettlementCapabilitySet,
  settlementCapabilitiesOf,
} from "./capabilities";
export type { SettlementCapability, SettlementCapabilitySet } from "./capabilities";

export type {
  AppendEventInput,
  AuctionSourcePort,
  AuctionSourceRef,
  AuditInput,
  CaseRow,
  CheckpointRow,
  DigestFn,
  GatewayOrder,
  GatewayOrderInput,
  LegRow,
  ObligationRow,
  PaymentGatewayPort,
  PaymentRow,
  PostingRow,
  ProviderPaymentRecord,
  ProviderRefundRecord,
  SettlementStore,
  SettlementTx,
  WebhookEnvelope,
  WebhookVerification,
} from "./ports";
