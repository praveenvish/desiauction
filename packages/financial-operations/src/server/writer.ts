import { canonicalJson, type GrantLike } from "@desiauction/core";

import {
  FINOPS_SYSTEM_ACTOR,
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
  decideIssueDocument,
  decideOpenPeriod,
  decideOpenSeries,
  decideReopenPeriod,
  decideRequestDispatch,
  decideRequestExport,
  correctionQuote,
  invoiceQuote,
  receiptQuote,
  diffDispatch,
  diffExport,
  diffPeriod,
  diffProfile,
  diffSeries,
  hasFinopsCapability,
  istDateOf,
  projectDispatch,
  projectExport,
  projectPeriod,
  projectProfile,
  projectSeries,
  replayDispatch,
  replayExport,
  replayPeriod,
  replayProfile,
  replaySeries,
  watermarkFromCursors,
  type AmendProfileInput,
  type AttestationCheck,
  type DeclareProfileInput,
  type DocumentParty,
  type DocumentQuote,
  type DispatchProjection,
  type ExceptionKind,
  type ExportKind,
  type ExportProjection,
  type FinopsCapability,
  type FinopsDecision,
  type FinopsEventEnvelope,
  type FinopsNewEvent,
  type FinopsStreamType,
  type FinopsTx,
  type PeriodProjection,
  type ProfileProjection,
  type RequestDispatchInput,
  type SeriesKind,
  type SeriesProjection,
  type Watermark,
} from "..";

import type { FinopsDeps } from "./deps";
import { composeCloseEvidence } from "./evidence";

/**
 * THE FINOPS WRITER (IP-6_ARCHITECTURE §7/§13/§14) — the single mutation
 * authority for every financial-operations aggregate. No route, no worker and
 * no read model writes these tables anywhere else; the web tier and the runner
 * both funnel through THIS module, and the unique (stream_type, stream_id,
 * seq) makes any concurrent writer fail loudly.
 *
 * Every command follows one shape (validate → reduce → persist → audit →
 * publish), with no exceptions:
 *
 *   capability (re-checked here — surfaces are courtesy, never the boundary)
 *   → idempotency (a duplicate commandId returns the ORIGINAL ack)
 *   → load the stream, FOLD it (pure reducer)              [reduce]
 *   → VERIFY the projection rows against the fold          [validate]
 *   → decide (pure command handler → events)               [validate]
 *   → ONE transaction: append + ONE audit row per event    [persist · audit]
 *     + rebuild the projection rows FROM the fold          [publish]
 *
 * "Publish" is the same-transaction projection update: finops read models of
 * finops streams have ZERO lag, exactly like every writer before this one.
 * Divergence between rows and log HALTS the aggregate (`finops_halted`) until
 * recovery heals the rows FROM the events. The halt is re-derived per command,
 * never stored — a restarted process is exactly as fail-closed as a running one.
 *
 * NOTHING HERE CALCULATES MONEY. There is no money in the foundation's
 * commands at all; documents (M-IP6-2) will QUOTE settlement facts.
 */

export interface FinopsActor {
  readonly personId: string;
  readonly orgId: string;
  readonly grants: readonly GrantLike[];
}

export type FinopsAckFailure = { ok: false; reason: string; detail?: string };

export type FinopsAck =
  { ok: true; status: "accepted" | "duplicate"; streamId: string; seq: number } | FinopsAckFailure;

/** Who executes: a person (capability-checked) or the system sentinel. */
export type Executor =
  | { kind: "person"; actor: FinopsActor; capability: FinopsCapability }
  | { kind: "system"; orgId: string; source: "runner" | "follower" | "recovery" };

function executorOrg(executor: Executor): string {
  return executor.kind === "person" ? executor.actor.orgId : executor.orgId;
}

function executorActor(executor: Executor): string {
  return executor.kind === "person" ? executor.actor.personId : FINOPS_SYSTEM_ACTOR;
}

function executorSource(executor: Executor): string {
  return executor.kind === "person" ? "web" : executor.source;
}

// --- Aggregate wiring: one reducer, one verifier, one projector per stream ----------

interface AggregateOps<F> {
  readonly streamType: FinopsStreamType;
  replay(events: readonly FinopsEventEnvelope[]):
    | { ok: true; projection: F }
    | {
        ok: false;
        atSeq: number;
        reason: string;
      };
  verify(deps: FinopsDeps, streamId: string, fold: F): Promise<string[]>;
  project(tx: FinopsTx, fold: F): Promise<void>;
}

const profileOps: AggregateOps<ProfileProjection> = {
  streamType: "profile",
  replay: replayProfile,
  async verify(deps, streamId, fold) {
    return diffProfile(await deps.store.loadProfile(streamId), fold);
  },
  async project(tx, fold) {
    await tx.putProfile(projectProfile(fold));
  },
};

const seriesOps: AggregateOps<SeriesProjection> = {
  streamType: "series",
  replay: replaySeries,
  async verify(deps, streamId, fold) {
    return diffSeries(
      await deps.store.loadSeries(streamId),
      await deps.store.loadDocuments(streamId),
      fold,
    );
  },
  async project(tx, fold) {
    const projected = projectSeries(fold);
    await tx.putSeries(projected.seriesRow);
    await tx.putDocuments(fold.seriesId, projected.documentRows);
  },
};

const dispatchOps: AggregateOps<DispatchProjection> = {
  streamType: "dispatch",
  replay: replayDispatch,
  async verify(deps, streamId, fold) {
    return diffDispatch(await deps.store.loadDispatch(streamId), fold);
  },
  async project(tx, fold) {
    await tx.putDispatch(projectDispatch(fold));
  },
};

const exportOps: AggregateOps<ExportProjection> = {
  streamType: "export",
  replay: replayExport,
  async verify(deps, streamId, fold) {
    return diffExport(await deps.store.loadExport(streamId), fold);
  },
  async project(tx, fold) {
    await tx.putExport(projectExport(fold));
  },
};

const periodOps: AggregateOps<PeriodProjection> = {
  streamType: "period",
  replay: replayPeriod,
  async verify(deps, streamId, fold) {
    return diffPeriod(
      await deps.store.loadPeriod(streamId),
      await deps.store.loadPeriodDays(streamId),
      fold,
    );
  },
  async project(tx, fold) {
    const projected = projectPeriod(fold);
    await tx.putPeriod(projected.periodRow);
    await tx.putPeriodDays(fold.periodId, projected.dayRows);
  },
};

export const AGGREGATE_OPS = {
  profile: profileOps,
  series: seriesOps,
  dispatch: dispatchOps,
  export: exportOps,
  period: periodOps,
} as const;

// --- The one command pipeline --------------------------------------------------------

interface CommandInput<F> {
  readonly ops: AggregateOps<F>;
  readonly streamId: string;
  readonly executor: Executor;
  readonly commandId: string;
  readonly reason?: string;
  decide(fold: F | null): FinopsDecision;
}

async function execute<F>(deps: FinopsDeps, input: CommandInput<F>): Promise<FinopsAck> {
  const { ops, streamId, executor, commandId } = input;

  // Capability — re-checked inside command execution, never only at a surface.
  if (
    executor.kind === "person" &&
    !hasFinopsCapability(
      executor.actor.grants,
      { scopeType: "org", scopeId: executor.actor.orgId },
      executor.capability,
    )
  ) {
    return { ok: false, reason: "not_authorized" };
  }

  // Idempotency: a duplicate returns the ORIGINAL ack and appends nothing.
  const duplicate = await deps.store.findByCommandId(ops.streamType, streamId, commandId);
  if (duplicate !== null) {
    return { ok: true, status: "duplicate", streamId, seq: duplicate.seq };
  }

  // Load + fold. An unfoldable log is an unhealable halt (restore territory).
  const events = await deps.store.loadStream(ops.streamType, streamId);
  let fold: F | null = null;
  if (events.length > 0) {
    const replayed = ops.replay(events);
    if (!replayed.ok) {
      return {
        ok: false,
        reason: "finops_unfoldable",
        detail: `${replayed.reason}@${String(replayed.atSeq)}`,
      };
    }
    fold = replayed.projection;
    // Verify every row this command could decide against — the ADR-7 birthright.
    const divergences = await ops.verify(deps, streamId, fold);
    if (divergences.length > 0) {
      return { ok: false, reason: "finops_halted", detail: divergences.join(" · ") };
    }
  }

  const decision = input.decide(fold);
  if (!decision.ok) {
    return { ok: false, reason: decision.reason };
  }

  return commit(deps, ops, executor, commandId, events, decision.events, input.reason);
}

/**
 * Append the decided events with their audit rows and rebuild the aggregate's
 * projection rows FROM the resulting fold — inside one transaction. The rows
 * are written from the log, never from the command: a row can only ever say
 * what the events say.
 */
async function commit<F>(
  deps: FinopsDeps,
  ops: AggregateOps<F>,
  executor: Executor,
  commandId: string,
  existing: readonly FinopsEventEnvelope[],
  events: readonly FinopsNewEvent[],
  reason?: string,
): Promise<FinopsAck> {
  const atMs = deps.now();
  const correlationId = deps.newId();
  const orgId = executorOrg(executor);
  const actor = executorActor(executor);
  const source = executorSource(executor);
  const streamId = events[0]?.streamId ?? "";

  const last = await deps.store.transact(async (tx) => {
    const appended: FinopsEventEnvelope[] = [];
    for (const event of events) {
      const seq = await tx.appendEvent({
        orgId,
        streamType: ops.streamType,
        streamId: event.streamId,
        type: event.type,
        atMs,
        actor,
        correlationId,
        commandId,
        payload: event.payload,
      });
      await tx.writeAudit({
        actor,
        action: `finops.${event.type}`,
        orgId,
        subject: event.streamId,
        source,
        correlationId,
        eventSeq: seq,
        ...(reason !== undefined ? { reason } : {}),
      });
      appended.push({
        streamType: ops.streamType,
        streamId: event.streamId,
        seq,
        type: event.type,
        atMs,
        actor,
        correlationId,
        commandId,
        payload: event.payload,
      });
    }

    const replayed = ops.replay([...existing, ...appended]);
    if (!replayed.ok) {
      // Unreachable: the decision was taken against this very fold. If it ever
      // happens the transaction rolls back — a projection is never written
      // from a log the reducer refuses.
      throw new Error(`replay_failed:${replayed.reason}@${String(replayed.atSeq)}`);
    }
    await ops.project(tx, replayed.projection);
    return appended[appended.length - 1];
  });

  return { ok: true, status: "accepted", streamId, seq: last?.seq ?? 0 };
}

// --- Folds for read/verify surfaces ---------------------------------------------------

export async function foldStream(
  deps: FinopsDeps,
  streamType: FinopsStreamType,
  streamId: string,
): Promise<
  | { ok: true; events: readonly FinopsEventEnvelope[]; projection: unknown }
  | { ok: false; reason: string; atSeq: number }
  | null
> {
  const events = await deps.store.loadStream(streamType, streamId);
  if (events.length === 0) {
    return null;
  }
  const replayed = AGGREGATE_OPS[streamType].replay(events);
  return replayed.ok
    ? { ok: true, events, projection: replayed.projection }
    : { ok: false, reason: replayed.reason, atSeq: replayed.atSeq };
}

/** The org's consumed settlement frontier — the watermark commands pin. */
export async function orgWatermark(deps: FinopsDeps, orgId: string): Promise<Watermark> {
  return watermarkFromCursors(await deps.store.loadCursors(orgId));
}

// --- TaxProfile commands ---------------------------------------------------------------

export async function declareProfile(
  deps: FinopsDeps,
  actor: FinopsActor,
  input: Omit<DeclareProfileInput, "orgId">,
  commandId: string,
): Promise<FinopsAck> {
  return execute(deps, {
    ops: profileOps,
    streamId: actor.orgId,
    executor: { kind: "person", actor, capability: "finops.manage" },
    commandId,
    decide: (fold) => decideDeclareProfile(fold, { ...input, orgId: actor.orgId }),
  });
}

export async function amendProfile(
  deps: FinopsDeps,
  actor: FinopsActor,
  input: AmendProfileInput,
  commandId: string,
): Promise<FinopsAck> {
  return execute(deps, {
    ops: profileOps,
    streamId: actor.orgId,
    executor: { kind: "person", actor, capability: "finops.manage" },
    commandId,
    reason: input.reason,
    decide: (fold) => decideAmendProfile(fold, input),
  });
}

// --- DocumentSeries commands (lifecycle only — issuance is M-IP6-2) --------------------

export async function openSeries(
  deps: FinopsDeps,
  actor: FinopsActor,
  input: { kind: SeriesKind; fy: string; prefix: string; seriesId?: string },
  commandId: string,
): Promise<FinopsAck> {
  const seriesId = input.seriesId ?? deps.newId();
  const taken = await deps.store.loadSeriesFor(actor.orgId, input.kind, input.fy);
  return execute(deps, {
    ops: seriesOps,
    streamId: seriesId,
    executor: { kind: "person", actor, capability: "finops.manage" },
    commandId,
    decide: (fold) =>
      decideOpenSeries(fold, taken !== null, {
        seriesId,
        orgId: actor.orgId,
        kind: input.kind,
        fy: input.fy,
        prefix: input.prefix,
      }),
  });
}

export async function closeSeries(
  deps: FinopsDeps,
  actor: FinopsActor,
  seriesId: string,
  commandId: string,
): Promise<FinopsAck> {
  return execute(deps, {
    ops: seriesOps,
    streamId: seriesId,
    executor: { kind: "person", actor, capability: "finops.manage" },
    commandId,
    decide: (fold) =>
      decideCloseSeries(fold, {
        registerDigest:
          fold === null ? "" : deps.digest(canonicalJson(projectSeries(fold).documentRows)),
      }),
  });
}

// --- Dispatch commands ------------------------------------------------------------------

export async function requestDispatch(
  deps: FinopsDeps,
  actor: FinopsActor,
  input: Omit<RequestDispatchInput, "dispatchId" | "orgId"> & { dispatchId?: string },
  commandId: string,
): Promise<FinopsAck> {
  const dispatchId = input.dispatchId ?? deps.newId();
  return execute(deps, {
    ops: dispatchOps,
    streamId: dispatchId,
    executor: { kind: "person", actor, capability: "finops.dispatch" },
    commandId,
    decide: (fold) =>
      decideRequestDispatch(fold, {
        dispatchId,
        orgId: actor.orgId,
        channel: input.channel,
        recipientRef: input.recipientRef,
        templateId: input.templateId,
        templateVersion: input.templateVersion,
        subjectRef: input.subjectRef,
      }),
  });
}

/** Runner/provider transitions — system-sourced, like settlement's ingress. */
export async function markDispatchSent(
  deps: FinopsDeps,
  orgId: string,
  dispatchId: string,
  providerRef: string,
  commandId: string,
): Promise<FinopsAck> {
  return execute(deps, {
    ops: dispatchOps,
    streamId: dispatchId,
    executor: { kind: "system", orgId, source: "runner" },
    commandId,
    decide: (fold) => decideMarkDispatchSent(fold, providerRef),
  });
}

export async function markDispatchConfirmed(
  deps: FinopsDeps,
  orgId: string,
  dispatchId: string,
  providerEventRef: string,
  commandId: string,
): Promise<FinopsAck> {
  return execute(deps, {
    ops: dispatchOps,
    streamId: dispatchId,
    executor: { kind: "system", orgId, source: "runner" },
    commandId,
    decide: (fold) => decideMarkDispatchConfirmed(fold, providerEventRef),
  });
}

export async function markDispatchFailed(
  deps: FinopsDeps,
  orgId: string,
  dispatchId: string,
  code: string,
  commandId: string,
  detail?: string,
): Promise<FinopsAck> {
  return execute(deps, {
    ops: dispatchOps,
    streamId: dispatchId,
    executor: { kind: "system", orgId, source: "runner" },
    commandId,
    decide: (fold) => decideMarkDispatchFailed(fold, code, detail),
  });
}

/**
 * MANUAL COMPLETION (M-IP6-3): an operator attests out-of-band delivery. Maps
 * onto the frozen `DispatchConfirmed` shape — the providerEventRef carries the
 * manual sentinel + commandId, so it never masquerades as provider truth (the
 * IP-5 attestation doctrine) and stays idempotent.
 */
export async function confirmDispatchManually(
  deps: FinopsDeps,
  actor: FinopsActor,
  dispatchId: string,
  note: string,
  commandId: string,
): Promise<FinopsAck> {
  if (note.trim() === "") {
    return { ok: false, reason: "reason_required" };
  }
  return execute(deps, {
    ops: dispatchOps,
    streamId: dispatchId,
    executor: { kind: "person", actor, capability: "finops.dispatch" },
    commandId,
    reason: note,
    decide: (fold) => decideMarkDispatchConfirmed(fold, `manual:${commandId}`),
  });
}

/**
 * MANUAL CANCELLATION (M-IP6-3): maps onto the frozen terminal
 * `DispatchFailed` shape with the `cancelled` code — history records the
 * attempt AND the decision to stop it; a retry is a NEW dispatch, as ever.
 */
export async function cancelDispatch(
  deps: FinopsDeps,
  actor: FinopsActor,
  dispatchId: string,
  reason: string,
  commandId: string,
): Promise<FinopsAck> {
  if (reason.trim() === "") {
    return { ok: false, reason: "reason_required" };
  }
  return execute(deps, {
    ops: dispatchOps,
    streamId: dispatchId,
    executor: { kind: "person", actor, capability: "finops.dispatch" },
    commandId,
    reason,
    decide: (fold) => decideMarkDispatchFailed(fold, "cancelled", reason),
  });
}

// --- ExportRun commands -----------------------------------------------------------------

export async function requestExport(
  deps: FinopsDeps,
  actor: FinopsActor,
  input: { kind: ExportKind; params: Readonly<Record<string, unknown>>; exportId?: string },
  commandId: string,
): Promise<FinopsAck> {
  const exportId = input.exportId ?? deps.newId();
  return execute(deps, {
    ops: exportOps,
    streamId: exportId,
    executor: { kind: "person", actor, capability: "finops.export" },
    commandId,
    decide: (fold) =>
      decideRequestExport(fold, {
        exportId,
        orgId: actor.orgId,
        kind: input.kind,
        params: input.params,
      }),
  });
}

/** System-initiated export runs (M-IP6-3: the runner's daily export job). */
export async function requestExportSystem(
  deps: FinopsDeps,
  orgId: string,
  input: { kind: ExportKind; params: Readonly<Record<string, unknown>>; exportId?: string },
  commandId: string,
): Promise<FinopsAck> {
  const exportId = input.exportId ?? deps.newId();
  return execute(deps, {
    ops: exportOps,
    streamId: exportId,
    executor: { kind: "system", orgId, source: "runner" },
    commandId,
    decide: (fold) =>
      decideRequestExport(fold, { exportId, orgId, kind: input.kind, params: input.params }),
  });
}

export async function completeExport(
  deps: FinopsDeps,
  orgId: string,
  exportId: string,
  result: { artifactRef: string; artifactDigest: string; rowCount: number },
  commandId: string,
): Promise<FinopsAck> {
  const watermark = await orgWatermark(deps, orgId);
  return execute(deps, {
    ops: exportOps,
    streamId: exportId,
    executor: { kind: "system", orgId, source: "runner" },
    commandId,
    decide: (fold) => decideCompleteExport(fold, { ...result, watermark }),
  });
}

export async function failExport(
  deps: FinopsDeps,
  orgId: string,
  exportId: string,
  code: string,
  commandId: string,
  detail?: string,
): Promise<FinopsAck> {
  return execute(deps, {
    ops: exportOps,
    streamId: exportId,
    executor: { kind: "system", orgId, source: "runner" },
    commandId,
    decide: (fold) => decideFailExport(fold, code, detail),
  });
}

// --- FiscalPeriod commands ---------------------------------------------------------------

export async function openPeriod(
  deps: FinopsDeps,
  actor: FinopsActor,
  input: { fy: string; periodId?: string },
  commandId: string,
): Promise<FinopsAck> {
  const periodId = input.periodId ?? deps.newId();
  const taken = await deps.store.loadPeriodFor(actor.orgId, input.fy);
  const openingWatermark = await orgWatermark(deps, actor.orgId);
  return execute(deps, {
    ops: periodOps,
    streamId: periodId,
    executor: { kind: "person", actor, capability: "finops.operate" },
    commandId,
    decide: (fold) =>
      decideOpenPeriod(fold, taken !== null, {
        periodId,
        orgId: actor.orgId,
        fy: input.fy,
        openingWatermark,
      }),
  });
}

/** One entry for both attestors: the runner (system) and a human (operate). */
export async function attestDay(
  deps: FinopsDeps,
  executor: Executor,
  periodId: string,
  input: { date: string; checks: readonly AttestationCheck[] },
  commandId: string,
): Promise<FinopsAck> {
  const watermark = await orgWatermark(deps, executorOrg(executor));
  const resolved: Executor =
    executor.kind === "person" ? { ...executor, capability: "finops.operate" } : executor;
  return execute(deps, {
    ops: periodOps,
    streamId: periodId,
    executor: resolved,
    commandId,
    decide: (fold) =>
      decideAttestDay(fold, {
        date: input.date,
        checks: input.checks,
        watermark,
        system: resolved.kind === "system",
      }),
  });
}

export async function noteException(
  deps: FinopsDeps,
  executor: Executor,
  periodId: string,
  input: { date: string; kind: ExceptionKind; detail: string; sourceRef?: string },
  commandId: string,
): Promise<FinopsAck> {
  const resolved: Executor =
    executor.kind === "person" ? { ...executor, capability: "finops.operate" } : executor;
  return execute(deps, {
    ops: periodOps,
    streamId: periodId,
    executor: resolved,
    commandId,
    decide: (fold) => decideNoteException(fold, input),
  });
}

export async function closePeriod(
  deps: FinopsDeps,
  actor: FinopsActor,
  periodId: string,
  commandId: string,
): Promise<FinopsAck> {
  const closingWatermark = await orgWatermark(deps, actor.orgId);
  const todayIst = istDateOf(deps.now());
  // SEAL THE YEAR (M-IP6-4): compose the full evidence package from event
  // folds — attestation history, document registers, export register (all
  // pinned by prefix), the settlement watermark, and quoted delivery
  // telemetry. Re-folding the pins reproduces every derived field forever
  // (the closure-evidence discipline at year scale; server/evidence.ts).
  const preloaded = await foldStream(deps, "period", periodId);
  if (preloaded === null) {
    return { ok: false, reason: "period_missing" };
  }
  if (!preloaded.ok) {
    return {
      ok: false,
      reason: "finops_unfoldable",
      detail: `${preloaded.reason}@${String(preloaded.atSeq)}`,
    };
  }
  const evidence = await composeCloseEvidence(
    deps,
    actor.orgId,
    preloaded.projection as PeriodProjection,
    closingWatermark,
  );
  return execute(deps, {
    ops: periodOps,
    streamId: periodId,
    executor: { kind: "person", actor, capability: "finops.close" },
    commandId,
    decide: (fold) => {
      if (fold === null) {
        return { ok: false, reason: "period_missing" };
      }
      // The evidence was composed against a preloaded fold; a period that
      // advanced in between would seal a stale pin — reject and retry.
      if (fold.eventCount !== evidence.periodEventCount) {
        return { ok: false, reason: "period_advanced_retry" };
      }
      const evidencePayload: Record<string, unknown> = { ...evidence };
      return decideClosePeriod(fold, { closingWatermark, evidence: evidencePayload, todayIst });
    },
  });
}

export async function reopenPeriod(
  deps: FinopsDeps,
  actor: FinopsActor,
  periodId: string,
  reason: string,
  commandId: string,
): Promise<FinopsAck> {
  return execute(deps, {
    ops: periodOps,
    streamId: periodId,
    executor: { kind: "person", actor, capability: "finops.override" },
    commandId,
    reason,
    decide: (fold) => decideReopenPeriod(fold, reason),
  });
}

// --- Document issuance (M-IP6-2 — awakens the foundation's dormant branches) ---------------
//
// IssueReceipt / IssueInvoice / IssueCorrection: the caller names REFERENCES
// (a payment, a case+team, a cause event); the writer QUOTES the amounts off
// the frozen settlement folds — no money figure can be supplied from outside.
// The watermark-coverage guard doubles as tenancy: a document can only quote
// history THIS org's follower has consumed (foreign streams have no cursor).

interface AssembledIssue {
  readonly profile: ProfileProjection;
  readonly profileSeq: number;
  readonly watermark: Watermark;
  readonly party: DocumentParty;
}

async function assembleIssue(
  deps: FinopsDeps,
  orgId: string,
  quote: DocumentQuote,
  partyLabel: string | undefined,
): Promise<AssembledIssue | FinopsAckFailure> {
  const profileEvents = await deps.store.loadStream("profile", orgId);
  if (profileEvents.length === 0) {
    return { ok: false, reason: "profile_missing" };
  }
  const profileFold = replayProfile(profileEvents);
  if (!profileFold.ok) {
    return {
      ok: false,
      reason: "finops_unfoldable",
      detail: `${profileFold.reason}@${String(profileFold.atSeq)}`,
    };
  }
  const label = partyLabel ?? (await deps.reference.teamLabel(quote.partyId));
  if (label === null || label === "") {
    return { ok: false, reason: "party_label_unresolved" };
  }
  return {
    profile: profileFold.projection,
    profileSeq: profileFold.projection.lastSeq,
    watermark: await orgWatermark(deps, orgId),
    party: { type: "team", id: quote.partyId, label },
  };
}

async function executeIssue(
  deps: FinopsDeps,
  executor: Executor,
  seriesId: string,
  commandId: string,
  quote: DocumentQuote,
  options: { partyLabel?: string; corrects?: string; reason?: string } = {},
): Promise<FinopsAck> {
  const orgId = executorOrg(executor);
  const assembled = await assembleIssue(deps, orgId, quote, options.partyLabel);
  if ("ok" in assembled) {
    return assembled;
  }
  const docId = deps.newId();
  const resolved: Executor =
    executor.kind === "person" ? { ...executor, capability: "finops.document" } : executor;
  return execute(deps, {
    ops: seriesOps,
    streamId: seriesId,
    executor: resolved,
    commandId,
    ...(options.reason !== undefined ? { reason: options.reason } : {}),
    decide: (fold) =>
      decideIssueDocument(
        fold,
        {
          docId,
          party: assembled.party,
          quote,
          profile: assembled.profile,
          profileSeq: assembled.profileSeq,
          watermark: assembled.watermark,
          ...(options.corrects !== undefined ? { corrects: options.corrects } : {}),
          ...(options.reason !== undefined ? { reason: options.reason } : {}),
        },
        deps.digest,
      ),
  });
}

export async function issueReceipt(
  deps: FinopsDeps,
  executor: Executor,
  input: { seriesId: string; paymentId: string; partyLabel?: string },
  commandId: string,
): Promise<FinopsAck> {
  const events = await deps.source.loadEventsFrom("payment", input.paymentId, 0);
  if (events.length === 0) {
    return { ok: false, reason: "source_unknown" };
  }
  const quoted = receiptQuote(events);
  if (!quoted.ok) {
    return { ok: false, reason: quoted.reason };
  }
  return executeIssue(deps, executor, input.seriesId, commandId, quoted.quote, {
    ...(input.partyLabel !== undefined ? { partyLabel: input.partyLabel } : {}),
  });
}

export async function issueInvoice(
  deps: FinopsDeps,
  actor: FinopsActor,
  input: { seriesId: string; caseId: string; teamId: string; partyLabel?: string },
  commandId: string,
): Promise<FinopsAck> {
  const events = await deps.source.loadEventsFrom("case", input.caseId, 0);
  if (events.length === 0) {
    return { ok: false, reason: "source_unknown" };
  }
  const quoted = invoiceQuote(events, input.teamId);
  if (!quoted.ok) {
    return { ok: false, reason: quoted.reason };
  }
  return executeIssue(
    deps,
    { kind: "person", actor, capability: "finops.document" },
    input.seriesId,
    commandId,
    quoted.quote,
    { ...(input.partyLabel !== undefined ? { partyLabel: input.partyLabel } : {}) },
  );
}

export async function issueCorrection(
  deps: FinopsDeps,
  actor: FinopsActor,
  input: {
    seriesId: string;
    correctsDocId: string;
    causeStreamType: "payment" | "case";
    causeStreamId: string;
    causeSeq: number;
    reason: string;
    partyLabel?: string;
  },
  commandId: string,
): Promise<FinopsAck> {
  const original = await deps.store.loadDocument(input.correctsDocId);
  if (original === null || original.orgId !== actor.orgId) {
    return { ok: false, reason: "corrects_unknown" };
  }
  if (original.kind === "correction") {
    // Corrections chain to source documents, never to each other — a second
    // compensation quotes a second settlement cause against the ORIGINAL.
    return { ok: false, reason: "corrects_invalid" };
  }
  const events = await deps.source.loadEventsFrom(input.causeStreamType, input.causeStreamId, 0);
  if (events.length === 0) {
    return { ok: false, reason: "source_unknown" };
  }
  const quoted = correctionQuote(events, input.causeSeq);
  if (!quoted.ok) {
    return { ok: false, reason: quoted.reason };
  }
  // The cause must compensate THE document it claims to correct: same party,
  // same settlement stream the original stood on.
  const causePrefix = `${input.causeStreamType}:${input.causeStreamId}:`;
  if (
    quoted.quote.partyId !== original.partyId ||
    original.sourceRef === null ||
    !original.sourceRef.startsWith(causePrefix)
  ) {
    return { ok: false, reason: "corrects_mismatch" };
  }
  return executeIssue(
    deps,
    { kind: "person", actor, capability: "finops.document" },
    input.seriesId,
    commandId,
    quoted.quote,
    {
      corrects: input.correctsDocId,
      reason: input.reason,
      ...(input.partyLabel !== undefined ? { partyLabel: input.partyLabel } : {}),
    },
  );
}

// --- Recovery (heal FROM events; never invents facts) -------------------------------------

export type RecoveryResult =
  | { ok: true; divergences: number; eventCount: number }
  | { ok: false; reason: string; detail?: string };

async function recover<F>(
  deps: FinopsDeps,
  ops: AggregateOps<F>,
  orgId: string,
  streamId: string,
  recoveredType: string,
): Promise<RecoveryResult> {
  const events = await deps.store.loadStream(ops.streamType, streamId);
  if (events.length === 0) {
    return { ok: false, reason: "stream_missing" };
  }
  const replayed = ops.replay(events);
  if (!replayed.ok) {
    // UNHEALABLE: the log itself refuses to fold. Restore-from-backup territory
    // (runbooks) — recovery repairs rows from events, never events from hope.
    return {
      ok: false,
      reason: "finops_unfoldable",
      detail: `${replayed.reason}@${String(replayed.atSeq)}`,
    };
  }
  const divergences = await ops.verify(deps, streamId, replayed.projection);
  const ack = await commit(
    deps,
    ops,
    { kind: "system", orgId, source: "recovery" },
    deps.newId(),
    events,
    [
      {
        streamType: ops.streamType,
        streamId,
        type: recoveredType,
        payload: { divergences: divergences.length, eventCount: events.length },
      },
    ],
  );
  if (!ack.ok) {
    return {
      ok: false,
      reason: ack.reason,
      ...(ack.detail !== undefined ? { detail: ack.detail } : {}),
    };
  }
  return { ok: true, divergences: divergences.length, eventCount: events.length };
}

export async function recoverProfile(deps: FinopsDeps, orgId: string): Promise<RecoveryResult> {
  return recover(deps, profileOps, orgId, orgId, "ProfileRecovered");
}

export async function recoverSeries(
  deps: FinopsDeps,
  orgId: string,
  seriesId: string,
): Promise<RecoveryResult> {
  return recover(deps, seriesOps, orgId, seriesId, "SeriesRecovered");
}

export async function recoverDispatch(
  deps: FinopsDeps,
  orgId: string,
  dispatchId: string,
): Promise<RecoveryResult> {
  return recover(deps, dispatchOps, orgId, dispatchId, "DispatchRecovered");
}

export async function recoverExport(
  deps: FinopsDeps,
  orgId: string,
  exportId: string,
): Promise<RecoveryResult> {
  return recover(deps, exportOps, orgId, exportId, "ExportRecovered");
}

export async function recoverPeriod(
  deps: FinopsDeps,
  orgId: string,
  periodId: string,
): Promise<RecoveryResult> {
  return recover(deps, periodOps, orgId, periodId, "PeriodRecovered");
}

/**
 * Fold every finops stream of the org and diff its rows — the health check the
 * attestation checklist runs. Reports; never halts by itself.
 */
export async function verifyOrgFinops(deps: FinopsDeps, orgId: string): Promise<string[]> {
  const divergences: string[] = [];
  for (const streamType of ["profile", "series", "dispatch", "export", "period"] as const) {
    for (const streamId of await deps.store.listStreamIds(orgId, streamType)) {
      const events = await deps.store.loadStream(streamType, streamId);
      const ops = AGGREGATE_OPS[streamType];
      const replayed = ops.replay(events);
      if (!replayed.ok) {
        divergences.push(
          `${streamType}:${streamId} unfoldable ${replayed.reason}@${String(replayed.atSeq)}`,
        );
        continue;
      }
      const diffs = await (ops as AggregateOps<unknown>).verify(
        deps,
        streamId,
        replayed.projection,
      );
      divergences.push(...diffs.map((diff) => `${streamType}:${streamId} ${diff}`));
    }
  }
  return divergences;
}
