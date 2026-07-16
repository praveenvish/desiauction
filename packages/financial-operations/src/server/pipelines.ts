import { canonicalJson } from "@desiauction/core";

import {
  buildExportArtifact,
  DEFAULT_MAX_ATTEMPTS,
  fiscalYearOf,
  formattedNumber,
  FINOPS_SYSTEM_ACTOR,
  hasFinopsCapability,
  type DeliveryRequest,
  type DispatchChannel,
  type DispatchRow,
  type ExportDocument,
  type ExportInputs,
  type ExportRow,
  type ExportSeriesMeta,
  type JobRow,
} from "..";

import type { FinopsDeps } from "./deps";
import { reproduceDocument } from "./documents";
import {
  completeExport,
  failExport,
  markDispatchConfirmed,
  markDispatchFailed,
  markDispatchSent,
  orgWatermark,
  requestDispatch,
  requestExport,
  requestExportSystem,
  type FinopsAck,
  type FinopsActor,
} from "./writer";

/**
 * THE DELIVERY & EXPORT PIPELINES (M-IP6-3; IP-6_ARCHITECTURE §11/§13/§15).
 *
 * Scan-based, like every coordination on this platform: the runner discovers
 * work by looking at STATE (requested dispatches, requested exports), derives
 * job keys from the aggregate ids, and executes handlers whose every mutation
 * is a writer command with a DERIVED command id — so a crash anywhere between
 * discovery and effect is healed by the next scan re-deriving the identical
 * work, and a duplicate returns its original ack.
 *
 * CONSTITUTIONAL: every dispatched body and every exported payload is the
 * REPRODUCED document bytes (M-IP6-2's `reproduceDocument`) — verified
 * byte-identical against the sealed digest before anything leaves the
 * platform. A document that cannot be reproduced is NEVER delivered and NEVER
 * exported: unreproducible means unverifiable means fail closed.
 */

// --- Standalone audit (the rewindFollower precedent: eventSeq 0) ----------------------

async function auditOperational(
  deps: FinopsDeps,
  orgId: string,
  action: string,
  subject: string,
  reason: string,
): Promise<void> {
  await deps.store.transact(async (tx) => {
    await tx.writeAudit({
      actor: FINOPS_SYSTEM_ACTOR,
      action,
      orgId,
      subject,
      source: "runner",
      correlationId: deps.newId(),
      eventSeq: 0,
      reason,
    });
  });
}

// --- Dispatch send pipeline -------------------------------------------------------------

export interface AssembledBody {
  readonly body: string;
  readonly bodyDigest: string;
}

/**
 * The body a channel delivers: for `doc:{docId}` subjects, the REPRODUCED
 * canonical document bytes (refused unless byte-identical with the sealed
 * digest); for `notice:*` subjects, a canonical notice envelope.
 */
export async function assembleDispatchBody(
  deps: FinopsDeps,
  dispatch: DispatchRow,
): Promise<{ ok: true; assembled: AssembledBody } | { ok: false; reason: string }> {
  if (dispatch.subjectRef.startsWith("doc:")) {
    const docId = dispatch.subjectRef.slice(4);
    const reproduction = await reproduceDocument(deps, docId);
    if (!reproduction.ok || reproduction.matches !== true || reproduction.payload === undefined) {
      return { ok: false, reason: "document_not_reproducible" };
    }
    return {
      ok: true,
      assembled: { body: reproduction.payload, bodyDigest: deps.digest(reproduction.payload) },
    };
  }
  const body = canonicalJson({ notice: dispatch.subjectRef, dispatchId: dispatch.dispatchId });
  return { ok: true, assembled: { body, bodyDigest: deps.digest(body) } };
}

/** Discover `requested` dispatches and enqueue their send jobs (derived keys). */
export async function enqueueDispatchSends(deps: FinopsDeps, nowMs: number): Promise<number> {
  let enqueued = 0;
  for (const orgId of await deps.orgs.listOrgIds()) {
    for (const dispatch of await deps.store.loadDispatchesByStatus(orgId, "requested")) {
      const inserted = await deps.store.transact(async (tx) =>
        tx.enqueueJob({
          jobId: deps.newId(),
          orgId,
          kind: "dispatch.send",
          dedupeKey: `dispatch.send:${dispatch.dispatchId}`,
          state: "queued",
          attempts: 0,
          maxAttempts: DEFAULT_MAX_ATTEMPTS,
          notBeforeMs: nowMs,
          leasedUntilMs: null,
          lastError: null,
          payload: { dispatchId: dispatch.dispatchId },
        }),
      );
      enqueued += inserted ? 1 : 0;
    }
  }
  return enqueued;
}

/**
 * The `dispatch.send` handler. Outcome taxonomy, fail-closed throughout:
 *   · unconfigured channel            → terminal DispatchFailed (event)
 *   · unreproducible document         → terminal DispatchFailed (event)
 *   · permanent provider rejection    → terminal DispatchFailed (event)
 *   · retryable provider failure      → audited attempt + deterministic job
 *                                       retry; exhaustion → terminal
 *                                       DispatchFailed (`retries_exhausted`)
 *   · adapter crash / unknown shape   → job retry → DEAD LETTER (operator
 *                                       requeues after fixing the provider)
 * Every transition is a writer command with a derived command id — replayed
 * sends can never double-transition.
 */
export async function runDispatchSend(deps: FinopsDeps, job: JobRow): Promise<void> {
  const dispatchId =
    typeof job.payload["dispatchId"] === "string" ? job.payload["dispatchId"] : null;
  if (dispatchId === null) {
    throw new Error("malformed_job_payload");
  }
  const dispatch = await deps.store.loadDispatch(dispatchId);
  if (dispatch === null) {
    throw new Error("dispatch_missing");
  }
  if (dispatch.status !== "requested") {
    return; // already progressed — idempotent by observation
  }

  const port = deps.delivery(dispatch.channel);
  if (port === null) {
    await markDispatchFailed(
      deps,
      dispatch.orgId,
      dispatchId,
      "channel_unconfigured",
      `dispatch:${dispatchId}:fail:unconfigured`,
    );
    return;
  }

  const assembled = await assembleDispatchBody(deps, dispatch);
  if (!assembled.ok) {
    await markDispatchFailed(
      deps,
      dispatch.orgId,
      dispatchId,
      assembled.reason,
      `dispatch:${dispatchId}:fail:${assembled.reason}`,
    );
    return;
  }

  const request: DeliveryRequest = {
    dispatchId,
    orgId: dispatch.orgId,
    channel: dispatch.channel,
    recipientRef: dispatch.recipientRef,
    templateId: dispatch.templateId,
    templateVersion: dispatch.templateVersion,
    subjectRef: dispatch.subjectRef,
    body: assembled.assembled.body,
    bodyDigest: assembled.assembled.bodyDigest,
  };
  const result = await port.send(request);

  if (!result.ok) {
    if (result.retryable && job.attempts + 1 < job.maxAttempts) {
      // The attempt is EVIDENCE (audited), the retry is deterministic (job
      // backoff); the aggregate transitions only on an outcome.
      await auditOperational(
        deps,
        dispatch.orgId,
        "finops.DispatchAttemptFailed",
        dispatchId,
        `${result.code} · attempt ${String(job.attempts + 1)}/${String(job.maxAttempts)}`,
      );
      throw new Error(result.code);
    }
    await markDispatchFailed(
      deps,
      dispatch.orgId,
      dispatchId,
      result.retryable ? `retries_exhausted:${result.code}` : result.code,
      `dispatch:${dispatchId}:fail:final`,
    );
    return;
  }

  const sent = await markDispatchSent(
    deps,
    dispatch.orgId,
    dispatchId,
    result.providerRef,
    `dispatch:${dispatchId}:send`,
  );
  if (!sent.ok) {
    throw new Error(`sent_transition_failed:${sent.reason}`);
  }
  if (result.confirmed !== undefined) {
    const confirmed = await markDispatchConfirmed(
      deps,
      dispatch.orgId,
      dispatchId,
      result.confirmed.providerEventRef,
      `dispatch:${dispatchId}:confirm`,
    );
    if (!confirmed.ok) {
      throw new Error(`confirm_transition_failed:${confirmed.reason}`);
    }
  }
}

/**
 * PROVIDER CALLBACK INGRESS (async channels): adapter-verified, idempotent by
 * `provider:{providerEventRef}`, deterministic on late/out-of-order arrivals
 * (the frozen machine rejects them), audited even when nothing appends —
 * rejected truth attempts are evidence (the IP-5 webhook doctrine).
 */
export async function ingestDeliveryCallback(
  deps: FinopsDeps,
  channel: DispatchChannel,
  raw: string,
): Promise<FinopsAck> {
  const port = deps.delivery(channel);
  if (port === null || port.verifyCallback === undefined) {
    return { ok: false, reason: "callback_unsupported" };
  }
  const parsed = port.verifyCallback(raw);
  if (!parsed.ok) {
    // Unverifiable: no tenant is trusted off an unverified payload (§21).
    return { ok: false, reason: `callback_unverified:${parsed.reason}` };
  }
  const dispatch = await deps.store.loadDispatch(parsed.dispatchId);
  if (dispatch === null || dispatch.channel !== channel) {
    return { ok: false, reason: "dispatch_unknown" };
  }
  const commandId = `provider:${parsed.providerEventRef}`;
  const ack =
    parsed.kind === "delivered"
      ? await markDispatchConfirmed(
          deps,
          dispatch.orgId,
          dispatch.dispatchId,
          parsed.providerEventRef,
          commandId,
        )
      : await markDispatchFailed(
          deps,
          dispatch.orgId,
          dispatch.dispatchId,
          parsed.code ?? "provider_failure",
          commandId,
        );
  if (!ack.ok) {
    await auditOperational(
      deps,
      dispatch.orgId,
      "finops.DeliveryCallbackRejected",
      dispatch.dispatchId,
      `${parsed.kind} · ${ack.reason}`,
    );
  }
  return ack;
}

/** RETRY = a NEW dispatch for the same subject (failed is terminal, as ever). */
export async function retryDispatch(
  deps: FinopsDeps,
  actor: FinopsActor,
  failedDispatchId: string,
  commandId: string,
): Promise<FinopsAck> {
  const failed = await deps.store.loadDispatch(failedDispatchId);
  if (failed === null || failed.orgId !== actor.orgId) {
    return { ok: false, reason: "dispatch_unknown" };
  }
  if (failed.status !== "failed") {
    return { ok: false, reason: "dispatch_not_failed" };
  }
  return requestDispatch(
    deps,
    actor,
    {
      channel: failed.channel,
      recipientRef: failed.recipientRef,
      templateId: failed.templateId,
      templateVersion: failed.templateVersion,
      subjectRef: failed.subjectRef,
    },
    commandId,
  );
}

// --- Export generation pipeline ----------------------------------------------------------

/** Discover `requested` exports and enqueue their generation jobs. */
export async function enqueueExportGenerations(deps: FinopsDeps, nowMs: number): Promise<number> {
  let enqueued = 0;
  for (const orgId of await deps.orgs.listOrgIds()) {
    for (const run of await deps.store.loadExportsByOrg(orgId)) {
      if (run.status !== "requested") {
        continue;
      }
      const inserted = await deps.store.transact(async (tx) =>
        tx.enqueueJob({
          jobId: deps.newId(),
          orgId,
          kind: "export.generate",
          dedupeKey: `export.generate:${run.exportId}`,
          state: "queued",
          attempts: 0,
          maxAttempts: DEFAULT_MAX_ATTEMPTS,
          notBeforeMs: nowMs,
          leasedUntilMs: null,
          lastError: null,
          payload: { exportId: run.exportId },
        }),
      );
      enqueued += inserted ? 1 : 0;
    }
  }
  return enqueued;
}

/**
 * Gather an export's inputs: every in-scope document, REPRODUCED (byte-
 * verified) — an export never ships content the platform cannot re-derive.
 */
export async function gatherExportInputs(
  deps: FinopsDeps,
  run: ExportRow,
): Promise<{ ok: true; inputs: ExportInputs } | { ok: false; reason: string }> {
  const fyScope = typeof run.params["fy"] === "string" ? run.params["fy"] : null;
  const seriesScope = typeof run.params["seriesId"] === "string" ? run.params["seriesId"] : null;
  const documents: ExportDocument[] = [];
  const series: ExportSeriesMeta[] = [];

  for (const seriesId of await deps.store.listStreamIds(run.orgId, "series")) {
    const row = await deps.store.loadSeries(seriesId);
    if (row === null) {
      return { ok: false, reason: `series_row_missing:${seriesId}` };
    }
    if (
      (fyScope !== null && row.fy !== fyScope) ||
      (seriesScope !== null && row.seriesId !== seriesScope)
    ) {
      continue;
    }
    series.push({
      seriesId: row.seriesId,
      kind: row.kind,
      fy: row.fy,
      prefix: row.prefix,
      status: row.status,
      documentCount: row.documentCount,
    });
    for (const doc of await deps.store.loadDocuments(seriesId)) {
      const reproduction = await reproduceDocument(deps, doc.docId);
      if (!reproduction.ok || reproduction.matches !== true || reproduction.payload === undefined) {
        return { ok: false, reason: `document_not_reproducible:${doc.docId}` };
      }
      documents.push({
        docId: doc.docId,
        seriesId: row.seriesId,
        kind: doc.kind,
        number: doc.number,
        formatted: formattedNumber(row.prefix, row.fy, doc.number),
        fy: row.fy,
        partyType: doc.partyType,
        partyId: doc.partyId,
        partyLabel: doc.partyLabel,
        amount: doc.amount,
        sourceRef: doc.sourceRef ?? "",
        contentDigest: doc.contentDigest,
        payload: reproduction.payload,
      });
    }
  }

  return {
    ok: true,
    inputs: {
      exportId: run.exportId,
      orgId: run.orgId,
      kind: run.kind,
      params: run.params,
      watermark: await orgWatermark(deps, run.orgId),
      documents,
      series,
    },
  };
}

/** Generate one requested export: gather → build → store → READ-BACK VERIFY → complete. */
export async function runExportGenerate(deps: FinopsDeps, job: JobRow): Promise<void> {
  const exportId = typeof job.payload["exportId"] === "string" ? job.payload["exportId"] : null;
  if (exportId === null) {
    throw new Error("malformed_job_payload");
  }
  const run = await deps.store.loadExport(exportId);
  if (run === null) {
    throw new Error("export_missing");
  }
  if (run.status !== "requested") {
    return; // already progressed — idempotent by observation
  }

  const gathered = await gatherExportInputs(deps, run);
  if (!gathered.ok) {
    // Unverifiable content is a TERMINAL outcome, not a retry: the export
    // must never ship what the platform cannot re-derive.
    await failExport(deps, run.orgId, exportId, gathered.reason, `export:${exportId}:fail`);
    return;
  }

  const artifact = buildExportArtifact(gathered.inputs);
  const key = `${run.orgId}/${exportId}.${artifact.extension}`;
  const { ref } = await deps.artifacts.put(key, artifact.bytes);
  // Read-back verification: what landed is byte-identical to what was built.
  const stored = await deps.artifacts.get(ref);
  if (stored === null || deps.digest(stored) !== deps.digest(artifact.bytes)) {
    throw new Error("artifact_readback_mismatch"); // IO fault → deterministic retry
  }
  const completed = await completeExport(
    deps,
    run.orgId,
    exportId,
    { artifactRef: ref, artifactDigest: deps.digest(artifact.bytes), rowCount: artifact.rowCount },
    `export:${exportId}:complete`,
  );
  if (!completed.ok) {
    throw new Error(`complete_transition_failed:${completed.reason}`);
  }
}

/**
 * VERIFY a completed export's artifact against the sealed digest, and — the
 * stronger check — REGENERATE the bytes from sources and compare: exports are
 * reproducible, so corruption anywhere (store OR log) is detectable forever.
 */
export interface ExportVerification {
  readonly artifactPresent: boolean;
  readonly artifactMatchesDigest: boolean;
  readonly regeneratedMatchesDigest: boolean | null;
  readonly verified: boolean;
}

export async function verifyExport(
  deps: FinopsDeps,
  exportId: string,
): Promise<ExportVerification | null> {
  const run = await deps.store.loadExport(exportId);
  if (run === null || run.status !== "completed" || run.artifactRef === null) {
    return null;
  }
  const stored = await deps.artifacts.get(run.artifactRef);
  const artifactMatchesDigest = stored !== null && deps.digest(stored) === run.artifactDigest;
  const gathered = await gatherExportInputs(deps, run);
  const regenerated = gathered.ok ? buildExportArtifact(gathered.inputs) : null;
  const regeneratedMatchesDigest =
    regenerated === null ? null : deps.digest(regenerated.bytes) === run.artifactDigest;
  return {
    artifactPresent: stored !== null,
    artifactMatchesDigest,
    regeneratedMatchesDigest,
    verified: artifactMatchesDigest && regeneratedMatchesDigest === true,
  };
}

/** ARCHIVE HANDOFF / healing: re-put the regenerated bytes for a lost or
 * corrupted artifact (ADR-9 — the digest in the event is the truth). */
export async function regenerateExportArtifact(
  deps: FinopsDeps,
  exportId: string,
): Promise<{ ok: boolean; reason?: string }> {
  const run = await deps.store.loadExport(exportId);
  if (run === null || run.status !== "completed" || run.artifactRef === null) {
    return { ok: false, reason: "export_not_completed" };
  }
  const gathered = await gatherExportInputs(deps, run);
  if (!gathered.ok) {
    return { ok: false, reason: gathered.reason };
  }
  const artifact = buildExportArtifact(gathered.inputs);
  if (deps.digest(artifact.bytes) !== run.artifactDigest) {
    // Sources no longer reproduce the sealed digest — a forged run, surfaced.
    return { ok: false, reason: "regeneration_digest_mismatch" };
  }
  await deps.artifacts.put(run.artifactRef, artifact.bytes);
  await auditOperational(
    deps,
    run.orgId,
    "finops.ExportArtifactRegenerated",
    exportId,
    run.artifactRef,
  );
  return { ok: true };
}

/** RETRY = a NEW run with the same params (failed is terminal, as ever). */
export async function retryExport(
  deps: FinopsDeps,
  actor: FinopsActor,
  failedExportId: string,
  commandId: string,
): Promise<FinopsAck> {
  const failed = await deps.store.loadExport(failedExportId);
  if (failed === null || failed.orgId !== actor.orgId) {
    return { ok: false, reason: "export_unknown" };
  }
  if (failed.status !== "failed") {
    return { ok: false, reason: "export_not_failed" };
  }
  return requestExport(
    deps,
    actor,
    { kind: failed.kind, params: { ...failed.params, retryOf: failedExportId } },
    commandId,
  );
}

/**
 * The DAILY EXPORT job (runner-owned): one register export per org per day —
 * a `journal-csv` of the day's fiscal year, idempotent by the `dailyKey`
 * pinned in params (a crashed run resumes: the requested run generates; a
 * completed run no-ops).
 */
export async function runDailyExport(deps: FinopsDeps, job: JobRow): Promise<void> {
  const date = typeof job.payload["date"] === "string" ? job.payload["date"] : null;
  if (date === null) {
    throw new Error("malformed_job_payload");
  }
  const orgId = job.orgId;
  const existing = (await deps.store.loadExportsByOrg(orgId)).find(
    (run) => run.params["dailyKey"] === date,
  );
  if (existing !== undefined) {
    if (existing.status === "requested") {
      await runExportGenerate(deps, { ...job, payload: { exportId: existing.exportId } });
    }
    return;
  }
  // Nothing to archive → nothing to create (visible in the snapshots).
  const fy = fiscalYearOf(date);
  let hasDocuments = false;
  for (const seriesId of await deps.store.listStreamIds(orgId, "series")) {
    const row = await deps.store.loadSeries(seriesId);
    if (row !== null && row.fy === fy && row.documentCount > 0) {
      hasDocuments = true;
      break;
    }
  }
  if (!hasDocuments) {
    return;
  }
  const requested = await requestExportSystem(
    deps,
    orgId,
    { kind: "journal-csv", params: { fy, dailyKey: date } },
    `export.daily:${orgId}:${date}`,
  );
  if (!requested.ok) {
    throw new Error(`daily_export_request_failed:${requested.reason}`);
  }
  await runExportGenerate(deps, { ...job, payload: { exportId: requested.streamId } });
}

/** Dead-letter recovery: an operator returns a dead job to the queue, audited. */
export async function requeueDeadJob(
  deps: FinopsDeps,
  actor: FinopsActor,
  jobId: string,
): Promise<{ ok: boolean; reason?: string }> {
  if (
    !hasFinopsCapability(actor.grants, { scopeType: "org", scopeId: actor.orgId }, "finops.operate")
  ) {
    return { ok: false, reason: "not_authorized" };
  }
  const job = (await deps.store.loadJobs(actor.orgId)).find((row) => row.jobId === jobId);
  if (job === undefined) {
    return { ok: false, reason: "job_unknown" };
  }
  if (job.state !== "dead") {
    return { ok: false, reason: "job_not_dead" };
  }
  await deps.store.transact(async (tx) => {
    await tx.updateJob({
      ...job,
      state: "queued",
      attempts: 0,
      notBeforeMs: deps.now(),
      leasedUntilMs: null,
      lastError: null,
    });
    await tx.writeAudit({
      actor: actor.personId,
      action: "finops.DeadJobRequeued",
      orgId: actor.orgId,
      subject: job.dedupeKey,
      source: "web",
      correlationId: deps.newId(),
      eventSeq: 0,
    });
  });
  return { ok: true };
}
