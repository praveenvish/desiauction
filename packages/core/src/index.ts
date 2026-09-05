export {
  paise,
  addPaise,
  deductPaise,
  comparePaise,
  multiplyPaise,
  serializePaise,
  parsePaise,
  formatPaiseINR,
  parseFeeStatus,
  parseRupeesToPaise,
  FEE_STATUSES,
} from "./money";
export type { Paise, DeductResult, ParsePaiseResult, FeeStatus } from "./money";
export type { Clock } from "./clock";
export { normalizePhone } from "./phone";
export { scrub, scrubText, REDACTED } from "./scrub";
export type { NormalizedPhone, PhoneResult } from "./phone";
export { capabilitiesOf, hasCapability, isCapabilitySet, CAPABILITY_SETS } from "./capabilities";
export type { Capability, CapabilitySet, GrantLike, Scope, ScopeType } from "./capabilities";
export {
  competitionTransition,
  registrationTransition,
  planRegistrationBatch,
  registrationNumber,
  nameKey,
  isRejectionReason,
  isRegistrationRole,
  validateName,
  monogramFor,
  NAME_MAX_LENGTH,
  slugifyName,
  isValidSeasonYear,
  nextSeasonName,
  COMPETITION_STATUSES,
  REGISTRATION_STATUSES,
  REGISTRATION_ROLES,
  REJECTION_REASONS,
} from "./competition";
export type {
  CompetitionStatus,
  CompetitionReadiness,
  RegistrationStatus,
  RegistrationEvent,
  RegistrationTransition,
  RegistrationBatchItem,
  RegistrationBatchPlan,
  RejectionReason,
  RegistrationRole,
  TransitionResult,
  NameResult,
} from "./competition";
export {
  parseRegistrationCsv,
  parseRegistrationRecords,
  tokenizeCsv,
  validateNewPlayer,
} from "./registration-csv";
export { isAmbiguousDate, parseCsvDate } from "./csv-date";
export { planImport, planImportRow } from "./import-diff";
export type {
  ExistingRegistration,
  FieldChange,
  ImportDiff,
  ImportDiffRow,
  ImportPolicy,
  ImportRowPlan,
} from "./import-diff";
export {
  IMPORT_FIELDS,
  IMPORT_FIELD_LABELS,
  REQUIRED_IMPORT_FIELDS,
  applyMapping,
  detectMapping,
  mappingOf,
  normalizeHeader,
  sampleRow,
  signatureOf,
} from "./import-mapping";
export type {
  ColumnMapping,
  DetectedMapping,
  ImportField,
  MappedColumn,
  MappingConflict,
  ValueMaps,
} from "./import-mapping";
export type { DateOrder } from "./csv-date";
export type {
  CsvRegistrationRow,
  CsvRowError,
  CsvParseOptions,
  CsvParseResult,
  NewPlayerCheck,
  NewPlayerInput,
  PlayerField,
  PlayerFieldError,
} from "./registration-csv";
export { fileStem, matchPhotoFiles } from "./photo-match";
export type { PhotoMatch, PhotoMatchRule, PhotoTarget } from "./photo-match";
export {
  fixtureTransition,
  canEditFixture,
  canRescheduleFixture,
  competitionCode,
  fixtureNumber,
  isValidKickoff,
  kickoffToMinutes,
  addDays,
  roundRobinPairings,
  planRoundRobin,
  detectConflicts,
  conflictsInvolving,
  blockingConflicts,
  isGroundSurface,
  isGroundStatus,
  FIXTURE_STATUSES,
  CONFLICT_SEVERITY,
  GROUND_SURFACES,
  GROUND_STATUSES,
} from "./fixture";
export type {
  FixtureStatus,
  FixtureEvent,
  FixtureReadiness,
  FixtureTransition,
  RoundRobinPairing,
  GeneratePlanInput,
  GeneratePlanResult,
  PlannedFixture,
  ConflictType,
  ConflictSeverity,
  Conflict,
  FixtureForConflicts,
  CompetitionWindow,
  GroundSurface,
  GroundStatus,
} from "./fixture";
export {
  parseFixtureCsv,
  FIXTURE_CSV_HEADER,
  DEFAULT_FIXTURE_DURATION_MINUTES,
} from "./fixture-csv";
export type { CsvFixtureRow, CsvFixtureError, FixtureCsvResult } from "./fixture-csv";
export {
  auctionTransition,
  lotTransition,
  bidTransition,
  decideBid,
  ladderStep,
  ladderContains,
  nextMinimumBid,
  isValidSlabs,
  openLotTimer,
  extendOnBid,
  holdRemainingMs,
  resumeLotTimer,
  isTimerExpired,
  isClosingSoon,
  isValidTimerPolicy,
  validateAuctionConfig,
  maxAffordableBid,
  minPossiblePrice,
  basePriceFor,
  requeueAllowed,
  paddleNumber,
  lotNumber,
  replayAuction,
  decideUndo,
  AUCTION_STATUSES,
  LOT_STATUSES,
  BID_STATUSES,
  AUCTION_MACHINE,
  LOT_MACHINE,
  BID_MACHINE,
  AUCTION_EVENT_TYPES,
  DEFAULT_AUCTION_CONFIG,
} from "./auction";
export {
  buildAuctionSnapshot,
  canonicalJson,
  serializeSnapshot,
  snapshotNextMinimumBid,
  isAuctionCommandType,
  isTransportCommandId,
  redactPurses,
  AUCTION_COMMAND_TYPES,
} from "./auction-snapshot";

export { bidRejectionMessage, commandRefusalMessage } from "./auction-copy";
export type {
  AuctionSnapshot,
  SnapshotRefs,
  SnapshotLotRef,
  SnapshotPaddleRef,
  SnapshotBidEntry,
  SnapshotQueueEntry,
  SnapshotPaddleEntry,
  CurrentLotBids,
  AuctionCommandType,
  AuctionCommandEnvelope,
  CommandAck,
  CommandRejectReason,
  PurseScope,
} from "./auction-snapshot";
export type {
  AuctionStatus,
  AuctionCommand,
  AuctionReadiness,
  AuctionTransition,
  LotStatus,
  LotCommand,
  LotGuards,
  LotTransition,
  BidStatus,
  BidCommand,
  BidTransition,
  BidRejectionCode,
  BidInput,
  BidDecision,
  IncrementSlab,
  TimerPolicy,
  LotTimer,
  UnsoldPolicy,
  AuctionConfig,
  ConfigValidation,
  MachineEdge,
  AuctionEventType,
  AuctionEventEnvelope,
  AuctionProjection,
  LotProjection,
  PaddleProjection,
  BidProjection,
  OwnerInviteProjection,
  PaddleGrantProjection,
  LotOutcome,
  LotOutcomeKind,
  UndoDecision,
  UndoTarget,
  ReplayResult,
} from "./auction";
export { buildAuctionLedger } from "./auction-ledger";
export type { AuctionLedgerRow } from "./auction-ledger";
export { DEFAULT_POINTS, ballsOf, buildStandings, compareStandings, oversOf } from "./standings";
export type { FixtureResultInput, PointsPolicy, ResultOutcome, StandingsRow } from "./standings";
export { deriveCeremony } from "./auction-ceremony";
export type { CeremonyPhase, CeremonyState } from "./auction-ceremony";
export {
  BATTING_STYLES,
  BOWLING_STYLES,
  PLAYER_ROLES,
  isBattingStyle,
  parseBattingStyle,
  parseBowlingStyle,
  parseRole,
  isBowlingStyle,
  battingStyleLabel,
  bowlingStyleLabel,
  roleLabel,
  styleLabel,
  deriveAge,
  isMinor,
  MINOR_AGE_THRESHOLD,
  GENDERS,
  GENDER_SELF_DESCRIBED_MAX,
  PROFILE_LOCATION_MAX,
  JERSEY_NAME_MAX,
  isGender,
  genderLabel,
  validateDateOfBirth,
  validateProfileLocation,
  validateJerseyNumber,
} from "./player-profile";
export type { BattingStyle, BowlingStyle, Gender, PlayerRole } from "./player-profile";
export {
  ENTRY_CATEGORIES,
  entryCategoryLabel,
  evaluateRegistration,
  isEntryCategory,
} from "./eligibility";
export type {
  EligibilityAdvisory,
  EligibilityReason,
  EligibilityVerdict,
  EntryCategory,
  RegistrationEligibilityInput,
} from "./eligibility";
export { PROFILE_ITEMS, profileCompleteness } from "./profile-completeness";
export type {
  ProfileCompleteness,
  ProfileCompletenessInput,
  ProfileItem,
} from "./profile-completeness";
export {
  ALLOWED_IMAGE_TYPES,
  MAX_IMAGE_BYTES,
  isAllowedImageType,
  validateUpload,
  bytesMatchImageType,
  deriveMediaKey,
  isValidMediaKey,
  mediaKeyBelongsTo,
} from "./media";
export type { AllowedImageType, MediaSubject, MediaUpload, MediaValidation } from "./media";
export { csvCell, toCsv } from "./csv";
export { OUTCOME_ACTIONS, summarizeOutcomes } from "./outcomes";
export type { OutcomeMetrics } from "./outcomes";
export {
  SHARE_SOURCES,
  ATTRIBUTION_DIRECT,
  ATTRIBUTION_OTHER,
  normalizeShareSource,
} from "./attribution";
export type { ShareSource } from "./attribution";
export { buildCompetitionShareCard, buildPlayerShareCard } from "./share-card";
export type {
  CompetitionShareCard,
  CompetitionShareCardInput,
  PlayerShareCard,
  PlayerShareCardInput,
  ShareCardStat,
  ShareCardTone,
} from "./share-card";

export {
  BETA_TIER,
  TIERS,
  TIER_LIMITS,
  checkTierLimit,
  isTier,
  limitRefusalMessage,
  tierLabel,
  type LimitDecision,
  type LimitSubject,
  type Tier,
  type TierLimits,
} from "./tiers";
export {
  buildPlayerPoster,
  buildTeamPoster,
  isPosterSize,
  isPosterTheme,
  monogramOf,
  POSTER_SIZES,
  POSTER_THEMES,
  type PlayerPoster,
  type PlayerPosterInput,
  type PosterOutcome,
  type PosterSize,
  type PosterTheme,
  type TeamPoster,
  type TeamPosterInput,
  type TeamPosterMember,
  type TeamPosterRow,
} from "./poster";
export {
  TARGET_PRIORITIES,
  TARGET_PRIORITY_LABELS,
  isTargetPriority,
  evaluatePlan,
  whatIf,
  ladderFloor,
  validateTargetMax,
  fallbackWouldCycle,
} from "./team-plan";
export type {
  TargetPriority,
  PlanTarget,
  PlanLot,
  PlanRules,
  PlanCurrentLot,
  PlanInput,
  PlanState,
  PlanBudget,
  PlanFit,
  PlanSuggestion,
  TargetState,
  TargetOutcome,
  TargetMaxValidation,
  LotAdvice,
  LotVerdict,
  Consequence,
} from "./team-plan";
export {
  FEATURES,
  FEATURE_SCOPE_TYPES,
  FEATURE_PLATFORM_SCOPE_ID,
  isFeature,
  resolveFeature,
} from "./feature-settings";
export type {
  Feature,
  FeatureDefinition,
  FeatureScopeType,
  FeatureSettingLike,
  FeatureDenial,
  FeatureResolution,
  FeatureContext,
} from "./feature-settings";
export { planVersusActual } from "./team-plan-report";
export type {
  PlanReport,
  PlanReportInput,
  PlanReportRow,
  PlanRevisionLike,
  PlanSaleLike,
  ReportOutcome,
} from "./team-plan-report";

/**
 * THE SPORT REGISTRY (Phase 0). Vocabulary only — no columns, no migrations.
 * `DEFAULT_SPORT` is the pack every caller resolves to until `competitions.sport`
 * arrives in Phase 1.
 */
export {
  SPORTS,
  DEFAULT_SPORT,
  DEFAULT_SPORT_KEY,
  CRICKET,
  CRICKET_ROLE_KEYS,
  CRICKET_BATTING_STYLE_KEYS,
  CRICKET_BOWLING_STYLE_KEYS,
  isSportKey,
  sportPack,
  normalizeVocabularyKey,
  roleKeys,
  isRoleIn,
  parseRoleIn,
  roleLabelIn,
  attributeSpec,
  attributeOptionKeys,
  attributeOptionLabel,
  isAttributeValueIn,
  parseAttributeIn,
  scoreWithinBounds,
} from "./sports";
export type {
  AttributeSpec,
  AttributeStorage,
  CricketRole,
  CricketBattingStyle,
  CricketBowlingStyle,
  RoleVocabulary,
  ScoreFieldSpec,
  SportPack,
  VocabularyTerm,
} from "./sports";
