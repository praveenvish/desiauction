/**
 * The Runner's pure core (IP-6_ARCHITECTURE §15, ADR-4): every scheduling and
 * retry DECISION is a pure function here; the worker loop in `server/` merely
 * executes them. Deterministic by construction — no jitter, no ambient clock;
 * `nowMs` is always an argument.
 *
 * C-16 holds vacuously: there is no money path in financial operations, and
 * no job can affect a settlement or auction outcome because no write path to
 * those streams exists anywhere in this package.
 */

import { fiscalYearOf, istDateOf, previousDate } from "./watermark";
import type { AttestationCheck, ExceptionKind } from "./period";

// --- Jobs ----------------------------------------------------------------------------

export type JobState = "queued" | "leased" | "done" | "dead";

/** The closed set of job kinds; new kinds arrive with their milestone
 * (M-IP6-3 added the dispatch/export pipeline kinds). */
export type JobKind =
  | "follower.run"
  | "ops.attest-day"
  | "ops.year-end"
  | "dispatch.send"
  | "export.generate"
  | "export.daily";

export const JOB_KINDS: readonly JobKind[] = [
  "follower.run",
  "ops.attest-day",
  "ops.year-end",
  "dispatch.send",
  "export.generate",
  "export.daily",
];

export function isJobKind(value: string): value is JobKind {
  return (JOB_KINDS as readonly string[]).includes(value);
}

export interface JobSnapshot {
  readonly state: JobState;
  readonly attempts: number;
  readonly maxAttempts: number;
  readonly leasedUntilMs: number | null;
}

export const DEFAULT_MAX_ATTEMPTS = 5;
export const DEFAULT_LEASE_MS = 60_000;
const BACKOFF_BASE_MS = 5_000;
const BACKOFF_CAP_MS = 3_600_000;

export type RetryDecision = { kind: "retry"; notBeforeMs: number } | { kind: "dead" };

/**
 * Deterministic exponential backoff, capped at one hour: attempt n retries
 * after base·2^(n−1). Exhaustion is a DEAD LETTER, never a silent drop — dead
 * jobs surface in the ops checklist and become exceptions on the day.
 */
export function retryDecision(
  attemptsMade: number,
  maxAttempts: number,
  nowMs: number,
): RetryDecision {
  if (attemptsMade >= maxAttempts) {
    return { kind: "dead" };
  }
  const delay = Math.min(BACKOFF_BASE_MS * 2 ** (attemptsMade - 1), BACKOFF_CAP_MS);
  return { kind: "retry", notBeforeMs: nowMs + delay };
}

/** A leased job whose lease lapsed is reclaimable — crash recovery is a timeout. */
export function leaseExpired(job: JobSnapshot, nowMs: number): boolean {
  return job.state === "leased" && job.leasedUntilMs !== null && job.leasedUntilMs <= nowMs;
}

/**
 * Derived job keys — the coordinator discipline applied to scheduling: the
 * same (kind, org, occasion) can only ever enqueue ONE job, so a crashed or
 * double-fired scheduler re-derives the identical key and the unique index
 * makes the second enqueue a no-op.
 */
export function dailyOpsJobKey(orgId: string, date: string): string {
  return `ops.attest-day:${orgId}:${date}`;
}

export function followerJobKey(orgId: string, date: string): string {
  return `follower.run:${orgId}:${date}`;
}

export function yearEndJobKey(orgId: string, fy: string): string {
  return `ops.year-end:${orgId}:${fy}`;
}

/** The day a daily-ops run attests: the IST day BEFORE the run fires. */
export function attestationDateFor(nowMs: number): string {
  return previousDate(istDateOf(nowMs));
}

/** The fiscal year that ENDED most recently relative to `nowMs` (IST). */
export function endedFiscalYearFor(nowMs: number): string {
  const currentStart = Number(fiscalYearOf(istDateOf(nowMs)).slice(0, 4));
  const priorStart = currentStart - 1;
  return `${String(priorStart)}-${String((priorStart + 1) % 100).padStart(2, "0")}`;
}

// --- Schedules -----------------------------------------------------------------------

export type ScheduleSlot = "daily-ops" | "year-end";

export const SCHEDULE_SLOTS: readonly ScheduleSlot[] = ["daily-ops", "year-end"];

function istInstant(date: string, hhmm: string): number {
  return Date.parse(`${date}T${hhmm}:00.000+05:30`);
}

/**
 * The next 01:30 IST at or after `afterMs` — early morning, off live windows
 * (C-22), after the day it attests has fully elapsed.
 */
export function nextDailyDueMs(afterMs: number): number {
  const candidate = istInstant(istDateOf(afterMs), "01:30");
  return candidate > afterMs ? candidate : istInstant(istDateOf(afterMs + 86_400_000), "01:30");
}

/** The next April 1st, 02:00 IST at or after `afterMs` — the FY boundary tick. */
export function nextYearEndDueMs(afterMs: number): number {
  const year = Number(istDateOf(afterMs).slice(0, 4));
  for (const candidateYear of [year, year + 1]) {
    const candidate = istInstant(`${String(candidateYear)}-04-01`, "02:00");
    if (candidate > afterMs) {
      return candidate;
    }
  }
  // Unreachable (April 1st of year+1 is always ahead); kept total.
  return istInstant(`${String(year + 2)}-04-01`, "02:00");
}

export function nextDueMs(slot: ScheduleSlot, afterMs: number): number {
  return slot === "daily-ops" ? nextDailyDueMs(afterMs) : nextYearEndDueMs(afterMs);
}

// --- The foundation attestation checklist (IP-6_ARCHITECTURE §15) ---------------------

export interface FoundationChecklistInputs {
  /** Total events the follower is behind, after its run. */
  readonly followerLagEvents: number;
  /** Divergences from folding every org finops stream against its rows. */
  readonly finopsDivergences: readonly string[];
  /** Dead-lettered jobs for the org. */
  readonly deadJobs: readonly { kind: string; key: string }[];
}

/**
 * The FOUNDATION checklist — the checks that exist in M-IP6-1. The settlement
 * sweep/verification checks join in M-IP6-4 exactly as ratified; the checklist
 * shape is already the closed §8.5 vocabulary.
 */
export function evaluateFoundationChecklist(inputs: FoundationChecklistInputs): AttestationCheck[] {
  return [
    {
      name: "follower-current",
      outcome: inputs.followerLagEvents === 0 ? "pass" : "fail",
      detail:
        inputs.followerLagEvents === 0 ? null : `${String(inputs.followerLagEvents)} events behind`,
    },
    {
      name: "finops-aggregates-healthy",
      outcome: inputs.finopsDivergences.length === 0 ? "pass" : "fail",
      detail: inputs.finopsDivergences.length === 0 ? null : inputs.finopsDivergences.join(" · "),
    },
    {
      name: "runner-queue-healthy",
      outcome: inputs.deadJobs.length === 0 ? "pass" : "fail",
      detail:
        inputs.deadJobs.length === 0
          ? null
          : inputs.deadJobs.map((job) => `${job.kind}:${job.key}`).join(" · "),
    },
  ];
}

export function checklistGreen(checks: readonly AttestationCheck[]): boolean {
  return checks.every((check) => check.outcome === "pass");
}

/** Deterministic mapping from a failed check to its exception kind (§8.5).
 * M-IP6-4 added the governance checks; unknown names still fail to `manual`. */
export function exceptionKindForCheck(checkName: string): ExceptionKind {
  switch (checkName) {
    case "follower-current":
      return "follower-stall";
    case "finops-aggregates-healthy":
    case "documents-reproducible":
    case "fiscal-evidence-reproducible":
      return "verification-failure";
    case "runner-queue-healthy":
    case "dispatch-current":
      return "dispatch-dlq";
    case "exports-verified":
      return "export-failure";
    case "settlement-synchronized":
      return "sweep-mismatch";
    default:
      return "manual";
  }
}
