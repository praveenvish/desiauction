import { canonicalJson } from "@desiauction/core";

import {
  attestationDigestBytes,
  composeFiscalEvidence,
  projectSeries,
  replayExport,
  replayPeriod,
  replaySeries,
  type FiscalEvidenceV2,
  type PeriodProjection,
  type Watermark,
} from "..";

import type { FinopsDeps } from "./deps";

/**
 * Fiscal close evidence (M-IP6-4; the IP-5 closure-evidence discipline at
 * year scale). Everything below derives from EVENT FOLDS — never from a
 * mutable projection row — and everything sealed is pinned: series and export
 * prefixes by event count, the attestation history by the period prefix the
 * close stands on. Re-folding those pinned prefixes reproduces the evidence
 * byte-for-byte, forever — even across a later reopen.
 *
 * This module is a LEAF (no writer import): the writer composes evidence at
 * close through it; reproduction and verification live beside composition so
 * the two can never drift apart.
 */

export async function composeCloseEvidence(
  deps: FinopsDeps,
  orgId: string,
  fold: PeriodProjection,
  watermark: Watermark,
): Promise<FiscalEvidenceV2> {
  const days = Object.values(fold.days);
  const attestationDigest = deps.digest(attestationDigestBytes(days));

  const series = [];
  let totalDocuments = 0;
  for (const seriesId of await deps.store.listStreamIds(orgId, "series")) {
    const events = await deps.store.loadStream("series", seriesId);
    const replayed = replaySeries(events);
    if (!replayed.ok) {
      throw new Error(`series_unfoldable:${seriesId}`);
    }
    const registerDigest = deps.digest(
      canonicalJson(projectSeries(replayed.projection).documentRows),
    );
    series.push({
      seriesId,
      eventCount: events.length,
      documents: replayed.projection.documents.length,
      registerDigest,
    });
    totalDocuments += replayed.projection.documents.length;
  }

  const runs = [];
  const exportRegister = [];
  let completed = 0;
  for (const exportId of await deps.store.listStreamIds(orgId, "export")) {
    const events = await deps.store.loadStream("export", exportId);
    const replayed = replayExport(events);
    if (!replayed.ok) {
      throw new Error(`export_unfoldable:${exportId}`);
    }
    runs.push({ exportId, eventCount: events.length, status: replayed.projection.status });
    exportRegister.push({
      exportId,
      status: replayed.projection.status,
      artifactDigest: replayed.projection.artifactDigest,
      rowCount: replayed.projection.rowCount,
    });
    completed += replayed.projection.status === "completed" ? 1 : 0;
  }
  const registerDigest = deps.digest(
    canonicalJson([...exportRegister].sort((a, b) => a.exportId.localeCompare(b.exportId))),
  );

  const tally = { requested: 0, sent: 0, confirmed: 0, failed: 0 };
  for (const status of ["requested", "sent", "confirmed", "failed"] as const) {
    tally[status] = (await deps.store.loadDispatchesByStatus(orgId, status)).length;
  }

  return composeFiscalEvidence({
    watermark,
    daysAttested: days.length,
    exceptionCount: fold.exceptions.length,
    attestationDigest,
    documents: { series, total: totalDocuments },
    exports: { runs, registerDigest, completed },
    dispatch: tally,
    periodEventCount: fold.eventCount,
  });
}

export interface EvidenceReproduction {
  readonly ok: boolean;
  readonly reason?: string;
  /** Per-field verdicts for the re-derivable core. */
  readonly checks?: readonly { name: string; matches: boolean }[];
  readonly matches?: boolean;
  readonly closedAtSeq?: number;
}

/**
 * Reproduce a sealed close's evidence from its pinned prefixes and compare —
 * the year-scale constitutional test. Verifies the LATEST close by default or
 * a specific historical one (`atSeq`): old seals stay verifiable across
 * reopens, forever.
 */
export async function reproduceFiscalEvidence(
  deps: FinopsDeps,
  periodId: string,
  atSeq?: number,
): Promise<EvidenceReproduction> {
  const events = await deps.store.loadStream("period", periodId);
  const closes = events.filter((event) => event.type === "PeriodClosed");
  const close =
    atSeq === undefined ? closes[closes.length - 1] : closes.find((event) => event.seq === atSeq);
  if (close === undefined) {
    return { ok: false, reason: "close_event_missing" };
  }
  const sealed = close.payload["evidence"] as Record<string, unknown> | undefined;
  if (sealed === undefined) {
    return { ok: false, reason: "evidence_missing" };
  }

  // Re-fold the period PREFIX the close stood on.
  const prefix = events.filter((event) => event.seq < close.seq);
  const replayed = replayPeriod(prefix);
  if (!replayed.ok) {
    return { ok: false, reason: `period_prefix_unfoldable:${replayed.reason}` };
  }
  const fold = replayed.projection;

  const checks: { name: string; matches: boolean }[] = [
    {
      name: "attestationDigest",
      matches:
        sealed["attestationDigest"] ===
        deps.digest(attestationDigestBytes(Object.values(fold.days))),
    },
    { name: "daysAttested", matches: sealed["daysAttested"] === Object.keys(fold.days).length },
  ];
  if (typeof sealed["exceptionCount"] === "number") {
    checks.push({
      name: "exceptionCount",
      matches: sealed["exceptionCount"] === fold.exceptions.length,
    });
  }

  // Version 2: re-derive the document and export registers from PINNED prefixes.
  if (sealed["evidenceVersion"] === 2) {
    const documents = sealed["documents"] as {
      series: { seriesId: string; eventCount: number; documents: number; registerDigest: string }[];
      total: number;
    };
    let total = 0;
    for (const pin of documents.series) {
      const seriesEvents = await deps.store.loadStream("series", pin.seriesId);
      const prefixFold = replaySeries(seriesEvents.slice(0, pin.eventCount));
      if (!prefixFold.ok) {
        return { ok: false, reason: `series_prefix_unfoldable:${pin.seriesId}` };
      }
      const registerDigest = deps.digest(
        canonicalJson(projectSeries(prefixFold.projection).documentRows),
      );
      checks.push({
        name: `series:${pin.seriesId}`,
        matches:
          registerDigest === pin.registerDigest &&
          prefixFold.projection.documents.length === pin.documents,
      });
      total += prefixFold.projection.documents.length;
    }
    checks.push({ name: "documents.total", matches: total === documents.total });

    const exportsSealed = sealed["exports"] as {
      runs: { exportId: string; eventCount: number; status: string }[];
      registerDigest: string;
      completed: number;
    };
    const register = [];
    let completed = 0;
    for (const pin of exportsSealed.runs) {
      const exportEvents = await deps.store.loadStream("export", pin.exportId);
      const prefixFold = replayExport(exportEvents.slice(0, pin.eventCount));
      if (!prefixFold.ok) {
        return { ok: false, reason: `export_prefix_unfoldable:${pin.exportId}` };
      }
      checks.push({
        name: `export:${pin.exportId}`,
        matches: prefixFold.projection.status === pin.status,
      });
      register.push({
        exportId: pin.exportId,
        status: prefixFold.projection.status,
        artifactDigest: prefixFold.projection.artifactDigest,
        rowCount: prefixFold.projection.rowCount,
      });
      completed += prefixFold.projection.status === "completed" ? 1 : 0;
    }
    checks.push({
      name: "exports.registerDigest",
      matches:
        deps.digest(
          canonicalJson([...register].sort((a, b) => a.exportId.localeCompare(b.exportId))),
        ) === exportsSealed.registerDigest,
    });
    checks.push({ name: "exports.completed", matches: completed === exportsSealed.completed });
  }

  return {
    ok: true,
    checks,
    matches: checks.every((check) => check.matches),
    closedAtSeq: close.seq,
  };
}
