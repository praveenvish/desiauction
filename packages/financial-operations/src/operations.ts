/**
 * Operational governance — the pure core (IP-6, M-IP6-4; IP-6_ARCHITECTURE
 * §15/§16). No IO, no ambient time, no randomness.
 *
 * THE CONSTITUTIONAL SHAPE: health is DERIVED from observations, evidence is
 * COMPOSED from fold-derived digests and pins, certification DERIVES from
 * replay — nothing here creates operational truth, and an observation that
 * cannot be made yields `unknown`, which is never healthy (unknown
 * operational state fails closed).
 */

import { canonicalJson } from "@desiauction/core";

import type { AttestationCheck } from "./period";
import type { FinopsEventEnvelope } from "./events";
import { evaluateFoundationChecklist, type FoundationChecklistInputs } from "./runner";
import { canonicalWatermark, type Watermark } from "./watermark";

// --- The Operations Supervisor: derived health ----------------------------------------

export type HealthStatus = "healthy" | "degraded" | "failed" | "unknown";

/** The CLOSED component list the supervisor reports on. */
export const HEALTH_COMPONENTS = [
  "follower",
  "runner",
  "dispatch",
  "exports",
  "documents",
  "settlement-sync",
  "fiscal",
] as const;

export type HealthComponent = (typeof HEALTH_COMPONENTS)[number];

export interface ComponentHealth {
  readonly component: HealthComponent;
  readonly status: HealthStatus;
  readonly detail: string | null;
}

/**
 * Everything the supervisor OBSERVED (gathered by the server tier from folds,
 * ports and immutable substrates — never from a mutable projection it cannot
 * verify). `null` means the observation could not be made — which derives
 * `unknown`, never `healthy`.
 */
export interface OperationalObservations {
  readonly follower: {
    readonly totalBehind: number;
    /** A cursor CLAIMING more history than exists — watermark corruption. */
    readonly cursorsAheadOfHead: number;
  } | null;
  readonly runner: {
    readonly deadJobs: number;
    readonly schedulesSeeded: boolean;
    /** ms the most-overdue schedule slot is past due (0 when none). */
    readonly scheduleOverdueMs: number;
  } | null;
  readonly dispatch: {
    readonly requestedBacklog: number;
    readonly oldestRequestedAgeMs: number;
    readonly failed: number;
  } | null;
  readonly exports: {
    readonly requestedBacklog: number;
    readonly failed: number;
    readonly unverifiedArtifacts: number;
  } | null;
  readonly documents: {
    readonly total: number;
    readonly unreproducible: number;
    /** Fold-vs-row divergences across the org's finops streams. */
    readonly divergences: number;
  } | null;
  readonly settlementSync: {
    readonly journalBalanced: boolean;
    readonly unfoldableStreams: number;
    /** Payments sitting `created` beyond the supervision threshold — the
     * signal that the (settlement-owned) expiry sweep is not being run. */
    readonly stalePayments: number;
  } | null;
  readonly fiscal: {
    readonly openExceptions: number;
    readonly awaitingClose: boolean;
    readonly unverifiedEvidence: number;
  } | null;
}

const DISPATCH_BACKLOG_AGE_BUDGET_MS = 15 * 60 * 1000;
const SCHEDULE_OVERDUE_BUDGET_MS = 6 * 60 * 60 * 1000;

/**
 * Health derivation — one pure rule per component. The supervisor NEVER
 * repairs: every non-healthy verdict names what a human (or an explicit
 * recovery command) must do; nothing here mutates anything.
 */
export function deriveHealth(observations: OperationalObservations): ComponentHealth[] {
  const unknown = (component: HealthComponent): ComponentHealth => ({
    component,
    status: "unknown",
    detail: "observation unavailable — fail closed",
  });

  const follower: ComponentHealth =
    observations.follower === null
      ? unknown("follower")
      : observations.follower.cursorsAheadOfHead > 0
        ? {
            component: "follower",
            status: "failed",
            detail: `${String(observations.follower.cursorsAheadOfHead)} cursor(s) ahead of the source head — watermark corruption; rewind the follower`,
          }
        : observations.follower.totalBehind > 0
          ? {
              component: "follower",
              status: "degraded",
              detail: `${String(observations.follower.totalBehind)} events behind`,
            }
          : { component: "follower", status: "healthy", detail: null };

  const runner: ComponentHealth =
    observations.runner === null
      ? unknown("runner")
      : observations.runner.deadJobs > 0
        ? {
            component: "runner",
            status: "failed",
            detail: `${String(observations.runner.deadJobs)} dead-lettered job(s) — requeue after fixing the cause`,
          }
        : !observations.runner.schedulesSeeded ||
            observations.runner.scheduleOverdueMs > SCHEDULE_OVERDUE_BUDGET_MS
          ? { component: "runner", status: "degraded", detail: "schedules missing or overdue" }
          : { component: "runner", status: "healthy", detail: null };

  const dispatch: ComponentHealth =
    observations.dispatch === null
      ? unknown("dispatch")
      : observations.dispatch.oldestRequestedAgeMs > DISPATCH_BACKLOG_AGE_BUDGET_MS
        ? {
            component: "dispatch",
            status: "degraded",
            detail: `${String(observations.dispatch.requestedBacklog)} dispatch(es) waiting beyond budget`,
          }
        : { component: "dispatch", status: "healthy", detail: null };

  const exports: ComponentHealth =
    observations.exports === null
      ? unknown("exports")
      : observations.exports.unverifiedArtifacts > 0
        ? {
            component: "exports",
            status: "failed",
            detail: `${String(observations.exports.unverifiedArtifacts)} artifact(s) fail verification — regenerate from sources`,
          }
        : { component: "exports", status: "healthy", detail: null };

  const documents: ComponentHealth =
    observations.documents === null
      ? unknown("documents")
      : observations.documents.divergences > 0
        ? {
            component: "documents",
            status: "failed",
            detail: `${String(observations.documents.divergences)} projection divergence(s) — recover the affected aggregates`,
          }
        : observations.documents.unreproducible > 0
          ? {
              component: "documents",
              status: "failed",
              detail: `${String(observations.documents.unreproducible)} document(s) do not reproduce — investigate forgery`,
            }
          : { component: "documents", status: "healthy", detail: null };

  const settlementSync: ComponentHealth =
    observations.settlementSync === null
      ? unknown("settlement-sync")
      : !observations.settlementSync.journalBalanced ||
          observations.settlementSync.unfoldableStreams > 0
        ? {
            component: "settlement-sync",
            status: "failed",
            detail: "settlement folds unbalanced or unfoldable — settlement runbooks apply",
          }
        : observations.settlementSync.stalePayments > 0
          ? {
              component: "settlement-sync",
              status: "degraded",
              detail: `${String(observations.settlementSync.stalePayments)} stale open payment(s) — is the settlement expiry sweep scheduled?`,
            }
          : { component: "settlement-sync", status: "healthy", detail: null };

  const fiscal: ComponentHealth =
    observations.fiscal === null
      ? unknown("fiscal")
      : observations.fiscal.unverifiedEvidence > 0
        ? {
            component: "fiscal",
            status: "failed",
            detail: `${String(observations.fiscal.unverifiedEvidence)} sealed evidence package(s) fail reproduction`,
          }
        : observations.fiscal.openExceptions > 0 || observations.fiscal.awaitingClose
          ? {
              component: "fiscal",
              status: "degraded",
              detail: observations.fiscal.awaitingClose
                ? "fiscal year elapsed — period awaits close"
                : `${String(observations.fiscal.openExceptions)} open exception(s) await a human`,
            }
          : { component: "fiscal", status: "healthy", detail: null };

  return [follower, runner, dispatch, exports, documents, settlementSync, fiscal];
}

export function overallHealth(components: readonly ComponentHealth[]): HealthStatus {
  if (components.some((component) => component.status === "failed")) {
    return "failed";
  }
  if (components.some((component) => component.status === "unknown")) {
    return "unknown"; // unobservable is never healthy — fail closed
  }
  if (components.some((component) => component.status === "degraded")) {
    return "degraded";
  }
  return "healthy";
}

// --- The full operational checklist (extends the foundation's three checks) ------------

export interface OperationalChecklistInputs extends FoundationChecklistInputs {
  readonly documentsUnreproducible: number;
  readonly exportsUnverified: number;
  readonly dispatchOldestRequestedAgeMs: number;
  readonly settlementSynchronized: boolean;
  readonly fiscalEvidenceUnverified: number;
}

/** The M-IP6-4 checklist: the ratified completion — foundation checks plus the
 * governance checks. Names stay within the closed exception-kind mapping. */
export function evaluateOperationalChecklist(
  inputs: OperationalChecklistInputs,
): AttestationCheck[] {
  return [
    ...evaluateFoundationChecklist(inputs),
    {
      name: "documents-reproducible",
      outcome: inputs.documentsUnreproducible === 0 ? "pass" : "fail",
      detail:
        inputs.documentsUnreproducible === 0
          ? null
          : `${String(inputs.documentsUnreproducible)} document(s) fail reproduction`,
    },
    {
      name: "exports-verified",
      outcome: inputs.exportsUnverified === 0 ? "pass" : "fail",
      detail:
        inputs.exportsUnverified === 0
          ? null
          : `${String(inputs.exportsUnverified)} export artifact(s) fail verification`,
    },
    {
      name: "dispatch-current",
      outcome:
        inputs.dispatchOldestRequestedAgeMs <= DISPATCH_BACKLOG_AGE_BUDGET_MS ? "pass" : "fail",
      detail:
        inputs.dispatchOldestRequestedAgeMs <= DISPATCH_BACKLOG_AGE_BUDGET_MS
          ? null
          : "requested dispatches waiting beyond budget",
    },
    {
      name: "settlement-synchronized",
      outcome: inputs.settlementSynchronized ? "pass" : "fail",
      detail: inputs.settlementSynchronized ? null : "settlement folds unbalanced or unfoldable",
    },
    {
      name: "fiscal-evidence-reproducible",
      outcome: inputs.fiscalEvidenceUnverified === 0 ? "pass" : "fail",
      detail:
        inputs.fiscalEvidenceUnverified === 0
          ? null
          : `${String(inputs.fiscalEvidenceUnverified)} evidence package(s) fail reproduction`,
    },
  ];
}

// --- Fiscal close evidence (v2): composed from fold-derived pins and digests -----------

export interface SeriesEvidencePin {
  readonly seriesId: string;
  readonly eventCount: number;
  readonly documents: number;
  readonly registerDigest: string;
}

export interface ExportEvidencePin {
  readonly exportId: string;
  readonly eventCount: number;
  readonly status: string;
}

export interface FiscalEvidenceV2 {
  readonly evidenceVersion: 2;
  readonly watermark: Watermark;
  readonly daysAttested: number;
  readonly exceptionCount: number;
  readonly attestationDigest: string;
  readonly documents: { readonly series: readonly SeriesEvidencePin[]; readonly total: number };
  readonly exports: {
    readonly runs: readonly ExportEvidencePin[];
    readonly registerDigest: string;
    readonly completed: number;
  };
  /** Delivery telemetry, QUOTED at close (transport, not compliance substance). */
  readonly dispatch: {
    readonly requested: number;
    readonly sent: number;
    readonly confirmed: number;
    readonly failed: number;
  };
  readonly periodEventCount: number;
}

export function composeFiscalEvidence(
  input: Omit<FiscalEvidenceV2, "evidenceVersion">,
): FiscalEvidenceV2 {
  return {
    evidenceVersion: 2,
    ...input,
    watermark: canonicalWatermark(input.watermark),
    documents: {
      series: [...input.documents.series].sort((a, b) => a.seriesId.localeCompare(b.seriesId)),
      total: input.documents.total,
    },
    exports: {
      ...input.exports,
      runs: [...input.exports.runs].sort((a, b) => a.exportId.localeCompare(b.exportId)),
    },
  };
}

/** The attestation digest: the period's day facts, canonically ordered. */
export function attestationDigestBytes(
  days: readonly { readonly date: string; readonly attestedAtSeq: number }[],
): string {
  return canonicalJson(
    [...days]
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((day) => ({ date: day.date, seq: day.attestedAtSeq })),
  );
}

// --- Certification: derived from replay, deterministic, time-free ----------------------

export interface CertificationCheck {
  readonly name: string;
  readonly pass: boolean;
  readonly detail: string | null;
}

/** The report is TIME-FREE: identical repository state ⇒ identical bytes ⇒
 * identical digest — which is what makes a duplicate certification harmless
 * and a forged one detectable. */
export interface CertificationReport {
  readonly orgId: string;
  readonly watermark: Watermark;
  readonly streamCounts: Readonly<Record<string, number>>;
  readonly checks: readonly CertificationCheck[];
  readonly pass: boolean;
}

export function certificationBytes(report: CertificationReport): string {
  return canonicalJson({
    ...report,
    watermark: canonicalWatermark(report.watermark),
    checks: [...report.checks].sort((a, b) => a.name.localeCompare(b.name)),
  });
}

// --- The fiscal timeline: the period stream, rendered (the ledger pattern) -------------

export interface FiscalTimelineEntry {
  readonly seq: number;
  readonly type: string;
  readonly atMs: number;
  readonly actor: string;
  readonly summary: string;
}

export function periodTimeline(events: readonly FinopsEventEnvelope[]): FiscalTimelineEntry[] {
  return events.map((event) => {
    const date = typeof event.payload["date"] === "string" ? event.payload["date"] : null;
    const kind = typeof event.payload["kind"] === "string" ? event.payload["kind"] : null;
    const reason = typeof event.payload["reason"] === "string" ? event.payload["reason"] : null;
    const summary =
      event.type === "DayAttested"
        ? `day ${date ?? "?"} attested`
        : event.type === "ExceptionNoted"
          ? `exception (${kind ?? "?"}) on ${date ?? "?"}`
          : event.type === "PeriodClosed"
            ? "fiscal year sealed"
            : event.type === "PeriodReopened"
              ? `reopened — ${reason ?? ""}`
              : event.type === "PeriodOpened"
                ? "fiscal year opened"
                : event.type;
    return { seq: event.seq, type: event.type, atMs: event.atMs, actor: event.actor, summary };
  });
}
