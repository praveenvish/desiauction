/**
 * The Financial Operations event model (IP-6, M-IP6-1; IP-6_ARCHITECTURE §7/§8).
 *
 * Five streams, one envelope — the settlement discipline applied to a new
 * context. `seq` is the per-stream total order; the unique
 * (stream_type, stream_id, seq) index is the single-writer proof. The catalog
 * below is the ratified, prescriptive set: **23 types**. Every reducer folds
 * only these and fails closed (`unknown_event_type`) on anything else, so an
 * older reducer reading a newer log halts loudly instead of mis-folding.
 *
 * CONSTITUTIONAL: no event here carries financial truth. Every money figure in
 * a finops payload is a QUOTATION of a frozen settlement fact, pinned by
 * provenance and watermark (ADR-1, truth vs. testimony). This module can
 * express nothing that competes with the settlement journal.
 */

export type FinopsStreamType = "profile" | "series" | "dispatch" | "export" | "period";

export const FINOPS_STREAM_TYPES: readonly FinopsStreamType[] = [
  "profile",
  "series",
  "dispatch",
  "export",
  "period",
];

/**
 * The persisted envelope — identical shape to the settlement envelope, in a
 * separate log (`finops_events`). `commandId` is causation, not truth: a
 * duplicate command returns the original acknowledgement and appends nothing.
 */
export interface FinopsEventEnvelope {
  readonly streamType: FinopsStreamType;
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
export interface FinopsNewEvent {
  readonly streamType: FinopsStreamType;
  readonly streamId: string;
  readonly type: string;
  readonly payload: Readonly<Record<string, unknown>>;
}

export type FinopsDecision =
  { ok: true; events: readonly FinopsNewEvent[] } | { ok: false; reason: string };

/** The system sentinel (all-zero ULID) — runner and follower writes carry it. */
export const FINOPS_SYSTEM_ACTOR = "00000000000000000000000000";

export const PROFILE_EVENT_TYPES = [
  "ProfileDeclared",
  "ProfileAmended",
  "ProfileRecovered",
] as const;

export const SERIES_EVENT_TYPES = [
  "SeriesOpened",
  "DocumentIssued",
  "CorrectionIssued",
  "SeriesClosed",
  "SeriesRecovered",
] as const;

export const DISPATCH_EVENT_TYPES = [
  "DispatchRequested",
  "DispatchSent",
  "DispatchConfirmed",
  "DispatchFailed",
  "DispatchRecovered",
] as const;

export const EXPORT_EVENT_TYPES = [
  "ExportRequested",
  "ExportCompleted",
  "ExportFailed",
  "ExportRecovered",
] as const;

export const PERIOD_EVENT_TYPES = [
  "PeriodOpened",
  "DayAttested",
  "ExceptionNoted",
  "PeriodClosed",
  "PeriodReopened",
  "PeriodRecovered",
] as const;

export type ProfileEventType = (typeof PROFILE_EVENT_TYPES)[number];
export type SeriesEventType = (typeof SERIES_EVENT_TYPES)[number];
export type DispatchEventType = (typeof DISPATCH_EVENT_TYPES)[number];
export type ExportEventType = (typeof EXPORT_EVENT_TYPES)[number];
export type PeriodEventType = (typeof PERIOD_EVENT_TYPES)[number];

export type FinopsEventType =
  ProfileEventType | SeriesEventType | DispatchEventType | ExportEventType | PeriodEventType;

/** The closed catalog: 3 + 5 + 5 + 4 + 6 = 23. Growth is an ADR (a thaw). */
export const FINOPS_EVENT_TYPES: readonly FinopsEventType[] = [
  ...PROFILE_EVENT_TYPES,
  ...SERIES_EVENT_TYPES,
  ...DISPATCH_EVENT_TYPES,
  ...EXPORT_EVENT_TYPES,
  ...PERIOD_EVENT_TYPES,
];

export function isFinopsEventType(value: string): value is FinopsEventType {
  return (FINOPS_EVENT_TYPES as readonly string[]).includes(value);
}

/**
 * The closed set of fail-closed replay reasons (IP-6_ARCHITECTURE §17). A fold
 * that cannot proceed stops with the offending seq and one of these — never a
 * guess, never a partial projection.
 */
export type FinopsReplayFailure = {
  ok: false;
  atSeq: number;
  reason: FinopsReplayFailureReason;
};

export type FinopsReplayFailureReason =
  | "sequence_gap"
  | "unknown_event_type"
  | "illegal_replayed_transition"
  | "malformed_profile"
  | "malformed_series"
  | "malformed_document"
  | "malformed_dispatch"
  | "malformed_export"
  | "malformed_period"
  | "unknown_profile"
  | "unknown_series"
  | "unknown_document"
  | "unknown_dispatch"
  | "unknown_export"
  | "unknown_period"
  | "number_gap"
  | "duplicate_document_source"
  | "decomposition_mismatch"
  | "watermark_regression";

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

/** Quoted money arrives as a plain JSON integer: non-negative safe int only. */
export function money(payload: Readonly<Record<string, unknown>>, key: string): number | null {
  const value = payload[key];
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

export function bool(payload: Readonly<Record<string, unknown>>, key: string): boolean | null {
  const value = payload[key];
  return typeof value === "boolean" ? value : null;
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

/** ISO calendar date (`yyyy-mm-dd`) — the shape every period fact is keyed by. */
export function isoDate(payload: Readonly<Record<string, unknown>>, key: string): string | null {
  const value = str(payload, key);
  if (value === null || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value
    ? null
    : value;
}
