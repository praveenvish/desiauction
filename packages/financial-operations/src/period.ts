/**
 * The FiscalPeriod aggregate (IP-6_ARCHITECTURE §7/§8.5): one per org · fiscal
 * year, one stream, one reducer. Pure.
 *
 * A period ATTESTS, it never accounts (ADR-10): daily attestations record that
 * the day's operational checklist was evaluated, exceptions record what a
 * human must look at, and the close SEALS evidence — no balance is computed,
 * no journal entry exists here. The acknowledgment rule is deterministic and
 * fold-derived: an exception is OPEN until a HUMAN attestation of its day
 * lands at a later seq; the system sentinel can never attest a red day or a
 * day with open exceptions. Re-attestation is append-only; the latest
 * attestation of a date governs.
 */

import {
  isoDate,
  num,
  obj,
  str,
  FINOPS_SYSTEM_ACTOR,
  type FinopsEventEnvelope,
  type FinopsReplayFailure,
} from "./events";
import {
  fiscalYearBounds,
  isFiscalYear,
  istDateOf,
  watermarkAdvances,
  watermarkOf,
  type Watermark,
} from "./watermark";

export type ExceptionKind =
  | "sweep-mismatch"
  | "verification-failure"
  | "late-upstream-event"
  | "dispatch-dlq"
  | "export-failure"
  | "follower-stall"
  | "manual";

export const EXCEPTION_KINDS: readonly ExceptionKind[] = [
  "sweep-mismatch",
  "verification-failure",
  "late-upstream-event",
  "dispatch-dlq",
  "export-failure",
  "follower-stall",
  "manual",
];

export function isExceptionKind(value: string): value is ExceptionKind {
  return (EXCEPTION_KINDS as readonly string[]).includes(value);
}

export type CheckOutcome = "pass" | "fail";

export interface AttestationCheck {
  readonly name: string;
  readonly outcome: CheckOutcome;
  readonly detail: string | null;
}

export type PeriodStatus = "open" | "closed";

export interface DayProjection {
  readonly date: string;
  readonly attestor: string;
  readonly attestorKind: "system" | "human";
  readonly checks: readonly AttestationCheck[];
  readonly failures: number;
  readonly watermark: Watermark;
  readonly attestedAtSeq: number;
}

export interface ExceptionProjection {
  readonly date: string;
  readonly kind: ExceptionKind;
  readonly detail: string;
  readonly sourceRef: string | null;
  readonly notedAtSeq: number;
  readonly acknowledgedAtSeq: number | null;
}

export interface PeriodProjection {
  status: PeriodStatus;
  periodId: string;
  orgId: string;
  fy: string;
  openedBy: string;
  /**
   * The IST date the period was opened (derived from the PeriodOpened event's
   * recorded clock — an event fact, so the fold stays deterministic). Coverage
   * for the close guard starts here: an org adopting the platform mid-year is
   * not asked to attest days before its books existed.
   */
  openedDate: string;
  openingWatermark: Watermark;
  /** The frontier the period last recorded — attestations may never regress it. */
  lastWatermark: Watermark;
  /** Latest attestation per date (append-only history lives in the log). */
  days: Record<string, DayProjection>;
  exceptions: ExceptionProjection[];
  /** The sealed evidence of the most recent close (null while open). */
  evidence: Readonly<Record<string, unknown>> | null;
  closedAtSeq: number | null;
  closures: number;
  reopenings: number;
  recoveries: number;
  lastSeq: number;
  eventCount: number;
}

export type PeriodReplayResult = { ok: true; projection: PeriodProjection } | FinopsReplayFailure;

export function openExceptionsFor(projection: PeriodProjection, date?: string): number {
  return projection.exceptions.filter(
    (exception) =>
      exception.acknowledgedAtSeq === null && (date === undefined || exception.date === date),
  ).length;
}

function checksOf(value: unknown): AttestationCheck[] | null {
  const raw = Array.isArray(value) ? value : null;
  if (raw === null || raw.length === 0) {
    return null;
  }
  const checks: AttestationCheck[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const record = obj(item);
    const name = record === null ? null : str(record, "name");
    const outcome = record === null ? null : str(record, "outcome");
    if (name === null || (outcome !== "pass" && outcome !== "fail") || seen.has(name)) {
      return null;
    }
    seen.add(name);
    const detail = record === null ? null : str(record, "detail");
    checks.push({ name, outcome, detail });
  }
  return checks;
}

function dateWithin(fy: string, date: string): boolean {
  const bounds = fiscalYearBounds(fy);
  return date >= bounds.start && date <= bounds.end;
}

export function replayPeriod(events: readonly FinopsEventEnvelope[]): PeriodReplayResult {
  let projection: PeriodProjection | null = null;

  for (const event of events) {
    const fail = (reason: FinopsReplayFailure["reason"]): PeriodReplayResult => ({
      ok: false,
      atSeq: event.seq,
      reason,
    });

    if (projection === null) {
      if (event.seq !== 1) {
        return fail("sequence_gap");
      }
      if (event.type !== "PeriodOpened") {
        return fail("unknown_period");
      }
      const periodId = str(event.payload, "periodId");
      const orgId = str(event.payload, "orgId");
      const fy = str(event.payload, "fy");
      const openingWatermark = watermarkOf(event.payload["openingWatermark"]);
      if (
        periodId === null ||
        periodId !== event.streamId ||
        orgId === null ||
        fy === null ||
        !isFiscalYear(fy) ||
        openingWatermark === null
      ) {
        return fail("malformed_period");
      }
      projection = {
        status: "open",
        periodId,
        orgId,
        fy,
        openedBy: event.actor,
        openedDate: istDateOf(event.atMs),
        openingWatermark,
        lastWatermark: openingWatermark,
        days: {},
        exceptions: [],
        evidence: null,
        closedAtSeq: null,
        closures: 0,
        reopenings: 0,
        recoveries: 0,
        lastSeq: 1,
        eventCount: 1,
      };
      continue;
    }

    if (event.seq !== projection.lastSeq + 1) {
      return fail("sequence_gap");
    }
    const state = projection;

    switch (event.type) {
      case "PeriodOpened":
        return fail("illegal_replayed_transition");

      case "DayAttested": {
        if (state.status !== "open") {
          return fail("illegal_replayed_transition");
        }
        const date = isoDate(event.payload, "date");
        const checks = checksOf(event.payload["checks"]);
        const watermark = watermarkOf(event.payload["watermark"]);
        if (date === null || checks === null || watermark === null) {
          return fail("malformed_period");
        }
        if (!dateWithin(state.fy, date)) {
          return fail("malformed_period");
        }
        if (!watermarkAdvances(state.lastWatermark, watermark)) {
          return fail("watermark_regression");
        }
        const failures = checks.filter((check) => check.outcome === "fail").length;
        const isSystem = event.actor === FINOPS_SYSTEM_ACTOR;
        // The sentinel may only attest a fully green day with nothing pending:
        // a red or burdened day demands a HUMAN, whose attestation IS the
        // acknowledgment. This is replay-enforced, not merely command-checked.
        if (isSystem && (failures > 0 || openExceptionsFor(state, date) > 0)) {
          return fail("illegal_replayed_transition");
        }
        if (!isSystem) {
          state.exceptions = state.exceptions.map((exception) =>
            exception.date === date && exception.acknowledgedAtSeq === null
              ? { ...exception, acknowledgedAtSeq: event.seq }
              : exception,
          );
        }
        state.days[date] = {
          date,
          attestor: event.actor,
          attestorKind: isSystem ? "system" : "human",
          checks,
          failures,
          watermark,
          attestedAtSeq: event.seq,
        };
        state.lastWatermark = watermark;
        break;
      }

      case "ExceptionNoted": {
        if (state.status !== "open") {
          return fail("illegal_replayed_transition");
        }
        const date = isoDate(event.payload, "date");
        const kindRaw = str(event.payload, "kind");
        const detail = str(event.payload, "detail");
        if (
          date === null ||
          !dateWithin(state.fy, date) ||
          kindRaw === null ||
          !isExceptionKind(kindRaw) ||
          detail === null
        ) {
          return fail("malformed_period");
        }
        state.exceptions.push({
          date,
          kind: kindRaw,
          detail,
          sourceRef: str(event.payload, "sourceRef"),
          notedAtSeq: event.seq,
          acknowledgedAtSeq: null,
        });
        break;
      }

      case "PeriodClosed": {
        if (state.status !== "open") {
          return fail("illegal_replayed_transition");
        }
        const closingWatermark = watermarkOf(event.payload["closingWatermark"]);
        const evidence = obj(event.payload["evidence"]);
        if (closingWatermark === null || evidence === null) {
          return fail("malformed_period");
        }
        if (!watermarkAdvances(state.lastWatermark, closingWatermark)) {
          return fail("watermark_regression");
        }
        // A period with an unacknowledged exception cannot fold to closed —
        // the seal is only expressible over a fully-answered year.
        if (openExceptionsFor(state) > 0) {
          return fail("illegal_replayed_transition");
        }
        state.status = "closed";
        state.evidence = { ...evidence };
        state.closedAtSeq = event.seq;
        state.closures += 1;
        state.lastWatermark = closingWatermark;
        break;
      }

      case "PeriodReopened": {
        if (state.status !== "closed") {
          return fail("illegal_replayed_transition");
        }
        if (str(event.payload, "reason") === null || num(event.payload, "compensates") === null) {
          return fail("malformed_period");
        }
        state.status = "open";
        state.reopenings += 1;
        // The prior seal survives in the LOG; only the live anchor clears.
        state.closedAtSeq = null;
        state.evidence = null;
        break;
      }

      case "PeriodRecovered": {
        state.recoveries += 1;
        break;
      }

      default:
        return fail("unknown_event_type");
    }

    state.lastSeq = event.seq;
    state.eventCount += 1;
  }

  if (projection === null) {
    return { ok: false, atSeq: 0, reason: "unknown_period" };
  }
  return { ok: true, projection };
}

/**
 * The close-readiness report (command-level guard, the settlement `verifyClosure`
 * precedent): every day from the period's opening (or the FY start, whichever
 * is later) through the FY end attested, and zero open exceptions. Replay
 * independently enforces the exception half; the day-coverage half is a
 * command guard so a lawful log stays compact.
 */
export interface CloseReadiness {
  readonly ready: boolean;
  readonly missingDays: readonly string[];
  readonly openExceptions: number;
}

export function closeReadiness(projection: PeriodProjection): CloseReadiness {
  const bounds = fiscalYearBounds(projection.fy);
  const from = projection.openedDate > bounds.start ? projection.openedDate : bounds.start;
  const missing: string[] = [];
  for (
    let cursor = new Date(`${from}T00:00:00.000Z`).getTime();
    cursor <= new Date(`${bounds.end}T00:00:00.000Z`).getTime();
    cursor += 86_400_000
  ) {
    const date = new Date(cursor).toISOString().slice(0, 10);
    if (projection.days[date] === undefined) {
      missing.push(date);
    }
  }
  const open = openExceptionsFor(projection);
  return { ready: missing.length === 0 && open === 0, missingDays: missing, openExceptions: open };
}
