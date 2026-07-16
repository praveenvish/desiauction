/**
 * The ExportRun aggregate (IP-6_ARCHITECTURE §7/§8.4): one per export
 * generation, one stream, one reducer. Pure.
 *
 * An export is an AUDITED ACT with provenance (invariant 33), not a query:
 * every completed run pins the artifact digest, the row count and the
 * settlement watermark it stood on. Artifacts are disposable (ADR-9) — the
 * digest in the event is the integrity truth. Generator adapters arrive with
 * M-IP6-3; the aggregate and its recovery are foundation.
 */

import { num, obj, str, type FinopsEventEnvelope, type FinopsReplayFailure } from "./events";
import { watermarkOf, type Watermark } from "./watermark";

export type ExportKind =
  "tally-xml" | "journal-csv" | "gstr1-json" | "audit-bundle" | "archive-bundle";

export const EXPORT_KINDS: readonly ExportKind[] = [
  "tally-xml",
  "journal-csv",
  "gstr1-json",
  "audit-bundle",
  "archive-bundle",
];

export function isExportKind(value: string): value is ExportKind {
  return (EXPORT_KINDS as readonly string[]).includes(value);
}

export type ExportStatus = "requested" | "completed" | "failed";

export interface ExportProjection {
  status: ExportStatus;
  exportId: string;
  orgId: string;
  kind: ExportKind;
  params: Readonly<Record<string, unknown>>;
  requestedBy: string;
  artifactRef: string | null;
  artifactDigest: string | null;
  rowCount: number | null;
  watermark: Watermark | null;
  failureCode: string | null;
  recoveries: number;
  lastSeq: number;
  eventCount: number;
}

export type ExportReplayResult = { ok: true; projection: ExportProjection } | FinopsReplayFailure;

export function replayExport(events: readonly FinopsEventEnvelope[]): ExportReplayResult {
  let projection: ExportProjection | null = null;

  for (const event of events) {
    const fail = (reason: FinopsReplayFailure["reason"]): ExportReplayResult => ({
      ok: false,
      atSeq: event.seq,
      reason,
    });

    if (projection === null) {
      if (event.seq !== 1) {
        return fail("sequence_gap");
      }
      if (event.type !== "ExportRequested") {
        return fail("unknown_export");
      }
      const exportId = str(event.payload, "exportId");
      const orgId = str(event.payload, "orgId");
      const kindRaw = str(event.payload, "kind");
      const params = obj(event.payload["params"]);
      if (
        exportId === null ||
        exportId !== event.streamId ||
        orgId === null ||
        kindRaw === null ||
        !isExportKind(kindRaw) ||
        params === null
      ) {
        return fail("malformed_export");
      }
      projection = {
        status: "requested",
        exportId,
        orgId,
        kind: kindRaw,
        params,
        requestedBy: event.actor,
        artifactRef: null,
        artifactDigest: null,
        rowCount: null,
        watermark: null,
        failureCode: null,
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
      case "ExportRequested":
        return fail("illegal_replayed_transition");

      case "ExportCompleted": {
        if (state.status !== "requested") {
          return fail("illegal_replayed_transition");
        }
        const artifactRef = str(event.payload, "artifactRef");
        const artifactDigest = str(event.payload, "artifactDigest");
        const rowCount = num(event.payload, "rowCount");
        const watermark = watermarkOf(event.payload["watermark"]);
        if (
          artifactRef === null ||
          artifactDigest === null ||
          rowCount === null ||
          !Number.isSafeInteger(rowCount) ||
          rowCount < 0 ||
          watermark === null
        ) {
          return fail("malformed_export");
        }
        state.status = "completed";
        state.artifactRef = artifactRef;
        state.artifactDigest = artifactDigest;
        state.rowCount = rowCount;
        state.watermark = watermark;
        break;
      }

      case "ExportFailed": {
        if (state.status !== "requested") {
          return fail("illegal_replayed_transition");
        }
        const code = str(event.payload, "code");
        if (code === null) {
          return fail("malformed_export");
        }
        state.status = "failed";
        state.failureCode = code;
        break;
      }

      case "ExportRecovered": {
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
    return { ok: false, atSeq: 0, reason: "unknown_export" };
  }
  return { ok: true, projection };
}
