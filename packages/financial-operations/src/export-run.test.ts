import { describe, expect, it } from "vitest";

import { decideCompleteExport, decideRequestExport } from "./commands";
import { replayExport } from "./export-run";
import { envelope } from "./testing";
import type { FinopsEventEnvelope } from "./events";

const EXPORT = "01EXP00000000000000000000A";
const ORG = "01ORG00000000000000000000A";

function requested(): FinopsEventEnvelope[] {
  return [
    envelope("export", EXPORT, 1, "ExportRequested", {
      exportId: EXPORT,
      orgId: ORG,
      kind: "journal-csv",
      params: { fy: "2026-27" },
    }),
  ];
}

const completed = envelope("export", EXPORT, 2, "ExportCompleted", {
  artifactRef: "exports/01EXP.csv",
  artifactDigest: "abc123",
  rowCount: 42,
  watermark: { "journal:org": 9 },
});

describe("ExportRun aggregate", () => {
  it("requested → completed with digest, row count and watermark pinned", () => {
    const result = replayExport([...requested(), completed]);
    if (!result.ok) {
      throw new Error(result.reason);
    }
    expect(result.projection.status).toBe("completed");
    expect(result.projection.artifactDigest).toBe("abc123");
    expect(result.projection.rowCount).toBe(42);
    expect(result.projection.watermark).toEqual({ "journal:org": 9 });
  });

  it("terminal means terminal; a completion without provenance cannot fold", () => {
    expect(
      replayExport([
        ...requested(),
        completed,
        envelope("export", EXPORT, 3, "ExportFailed", { code: "late" }),
      ]),
    ).toEqual({ ok: false, atSeq: 3, reason: "illegal_replayed_transition" });
    expect(
      replayExport([
        ...requested(),
        envelope("export", EXPORT, 2, "ExportCompleted", { artifactRef: "x" }),
      ]),
    ).toEqual({ ok: false, atSeq: 2, reason: "malformed_export" });
  });

  it("fails closed: unknown kind, unknown type, wrong genesis, gap", () => {
    const badKind = envelope("export", EXPORT, 1, "ExportRequested", {
      exportId: EXPORT,
      orgId: ORG,
      kind: "pdf-fancy",
      params: {},
    });
    expect(replayExport([badKind])).toEqual({ ok: false, atSeq: 1, reason: "malformed_export" });
    expect(replayExport([completed])).toEqual({ ok: false, atSeq: 2, reason: "sequence_gap" });
    expect(
      replayExport([...requested(), envelope("export", EXPORT, 2, "ExportForged", {})]),
    ).toEqual({ ok: false, atSeq: 2, reason: "unknown_event_type" });
  });

  it("command guards", () => {
    expect(
      decideRequestExport(null, { exportId: EXPORT, orgId: ORG, kind: "journal-csv", params: {} })
        .ok,
    ).toBe(true);
    expect(
      decideCompleteExport(null, {
        artifactRef: "x",
        artifactDigest: "y",
        rowCount: 1,
        watermark: {},
      }),
    ).toEqual({ ok: false, reason: "export_missing" });
    const fold = replayExport(requested());
    if (!fold.ok) {
      throw new Error(fold.reason);
    }
    expect(
      decideCompleteExport(fold.projection, {
        artifactRef: "",
        artifactDigest: "y",
        rowCount: 1,
        watermark: {},
      }),
    ).toEqual({ ok: false, reason: "export_result_invalid" });
  });
});
