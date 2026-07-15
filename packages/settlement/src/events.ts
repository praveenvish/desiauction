/**
 * The settlement event model (IP-5, M-IP5-1; IP-5_ARCHITECTURE §7/§8).
 *
 * Three streams, one envelope. `seq` is the per-stream total order — the unique
 * (stream_type, stream_id, seq) index is the single-writer proof, exactly as
 * (auction_id, seq) is for the frozen auction log. The catalog below is CLOSED
 * at 24 types: every reducer folds only these and fails closed
 * (`unknown_event_type`) on anything else, so an older reducer reading a newer
 * log halts loudly instead of mis-folding money.
 */

export type StreamType = "case" | "journal" | "payment";

export const STREAM_TYPES: readonly StreamType[] = ["case", "journal", "payment"];

/**
 * The persisted envelope. `commandId` is the idempotency key of the command
 * that caused the event (unique per stream) — a duplicate command returns the
 * original acknowledgement and appends nothing. Reducers ignore it: it is
 * causation, not truth.
 */
export interface SettlementEventEnvelope {
  readonly streamType: StreamType;
  readonly streamId: string;
  readonly seq: number;
  readonly type: string; // validated by the reducers — unknown types fail replay closed
  readonly atMs: number;
  readonly actor: string;
  readonly correlationId: string;
  readonly commandId: string;
  readonly payload: Readonly<Record<string, unknown>>;
}

/** What a pure command handler returns: events to append, never rows to write. */
export interface NewEvent {
  readonly streamType: StreamType;
  readonly streamId: string;
  readonly type: string;
  readonly payload: Readonly<Record<string, unknown>>;
}

export type Decision = { ok: true; events: readonly NewEvent[] } | { ok: false; reason: string };

export const CASE_EVENT_TYPES = [
  "CaseOpened",
  "CaseVerified",
  "CaseDiscrepant",
  "ObligationsComputed",
  "ObligationDischarged",
  "ObligationWaived",
  "ObligationReinstated",
  "ObligationAdjusted",
  "CaseSettled",
  "CaseClosed",
  "CaseReopened",
  "CaseVoided",
  "CaseRecovered",
] as const;

export const JOURNAL_EVENT_TYPES = [
  "JournalPosted",
  "ReceiptIssued",
  "CreditNoteIssued",
  "JournalRecovered",
] as const;

export const PAYMENT_EVENT_TYPES = [
  "PaymentInitiated",
  "PaymentAuthorized",
  "PaymentCaptured",
  "PaymentFailed",
  "PaymentRefunded",
  "PaymentDisputed",
  "PaymentRecovered",
] as const;

export type CaseEventType = (typeof CASE_EVENT_TYPES)[number];
export type JournalEventType = (typeof JOURNAL_EVENT_TYPES)[number];
export type PaymentEventType = (typeof PAYMENT_EVENT_TYPES)[number];
export type SettlementEventType = CaseEventType | JournalEventType | PaymentEventType;

/** The closed catalog: 13 case + 4 journal + 7 payment = 24. Growth is an ADR. */
export const SETTLEMENT_EVENT_TYPES: readonly SettlementEventType[] = [
  ...CASE_EVENT_TYPES,
  ...JOURNAL_EVENT_TYPES,
  ...PAYMENT_EVENT_TYPES,
];

export function isCaseEventType(value: string): value is CaseEventType {
  return (CASE_EVENT_TYPES as readonly string[]).includes(value);
}

export function isJournalEventType(value: string): value is JournalEventType {
  return (JOURNAL_EVENT_TYPES as readonly string[]).includes(value);
}

export function isPaymentEventType(value: string): value is PaymentEventType {
  return (PAYMENT_EVENT_TYPES as readonly string[]).includes(value);
}

export function isSettlementEventType(value: string): value is SettlementEventType {
  return (SETTLEMENT_EVENT_TYPES as readonly string[]).includes(value);
}

/**
 * The closed set of fail-closed replay reasons (§14). A fold that cannot
 * proceed stops with the offending seq and one of these — never a guess.
 */
export type ReplayFailure = {
  ok: false;
  atSeq: number;
  reason: ReplayFailureReason;
};

export type ReplayFailureReason =
  | "sequence_gap"
  | "unknown_event_type"
  | "illegal_replayed_transition"
  | "malformed_case"
  | "malformed_obligation"
  | "malformed_posting"
  | "malformed_receipt"
  | "malformed_payment"
  | "unknown_case"
  | "unknown_team"
  | "unknown_payment"
  | "unknown_posting"
  | "unknown_receipt"
  | "unbalanced_posting"
  | "template_shape_mismatch"
  | "duplicate_posting_source"
  | "obligation_overdischarged"
  | "refund_exceeds_captured"
  | "negative_account_flow";

// --- Payload readers. Fail-closed by construction: a payload field of the
// wrong type reads as null, and every reducer turns that into malformed_*.

export function str(payload: Readonly<Record<string, unknown>>, key: string): string | null {
  const value = payload[key];
  return typeof value === "string" && value !== "" ? value : null;
}

export function num(payload: Readonly<Record<string, unknown>>, key: string): number | null {
  const value = payload[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Money arrives as a plain JSON integer and must be a non-negative safe int. */
export function money(payload: Readonly<Record<string, unknown>>, key: string): number | null {
  const value = payload[key];
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

export function arr(payload: Readonly<Record<string, unknown>>, key: string): unknown[] | null {
  const value = payload[key];
  return Array.isArray(value) ? value : null;
}

export function obj(value: unknown): Readonly<Record<string, unknown>> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : null;
}
