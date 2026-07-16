import { describe, expect, it } from "vitest";

import { decideCloseSeries, decideOpenSeries } from "./commands";
import { replaySeries, type SeriesProjection } from "./series";
import { envelope } from "./testing";
import type { FinopsEventEnvelope } from "./events";

const SERIES = "01SER00000000000000000000A";
const ORG = "01ORG00000000000000000000A";

function opened(kind = "receipt"): FinopsEventEnvelope[] {
  return [
    envelope("series", SERIES, 1, "SeriesOpened", {
      seriesId: SERIES,
      orgId: ORG,
      kind,
      fy: "2026-27",
      prefix: "RCT",
    }),
  ];
}

function issue(
  seq: number,
  number: number,
  overrides: Record<string, unknown> = {},
): FinopsEventEnvelope {
  return envelope("series", SERIES, seq, "DocumentIssued", {
    docId: `01DOC0000000000000000000${String(number).padStart(2, "0")}`,
    number,
    party: { type: "team", id: "01TEAM0000000000000000000A", label: "Tigers" },
    lines: [
      {
        description: "Auction dues collection",
        amount: 5_000_00,
        provenance: { stream: "journal:01ORG00000000000000000000A", seq: 4 },
      },
    ],
    amount: 5_000_00,
    sourceRef: `payment:01PAY0000000000000000000${String(number).padStart(2, "0")}:3`,
    profileSeq: 1,
    watermark: { "journal:01ORG00000000000000000000A": 4 + number },
    contentDigest: `digest-${String(number)}`,
    ...overrides,
  });
}

function foldOk(events: readonly FinopsEventEnvelope[]): SeriesProjection {
  const result = replaySeries(events);
  if (!result.ok) {
    throw new Error(`${result.reason}@${String(result.atSeq)}`);
  }
  return result.projection;
}

describe("DocumentSeries aggregate", () => {
  it("issues densely and deterministically (double fold, identical bytes)", () => {
    const events = [...opened(), issue(2, 1), issue(3, 2)];
    const first = foldOk(events);
    const second = foldOk(events);
    expect(first.documents.map((doc) => doc.number)).toEqual([1, 2]);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });

  it("NUMBER_GAP: a skipped, repeated or premature number cannot fold", () => {
    expect(replaySeries([...opened(), issue(2, 2)])).toEqual({
      ok: false,
      atSeq: 2,
      reason: "number_gap",
    });
    expect(
      replaySeries([
        ...opened(),
        issue(2, 1),
        issue(3, 1, { docId: "01DOC000000000000000000099" }),
      ]),
    ).toEqual({ ok: false, atSeq: 3, reason: "number_gap" });
    expect(replaySeries([...opened(), issue(2, 1), issue(3, 3)])).toEqual({
      ok: false,
      atSeq: 3,
      reason: "number_gap",
    });
  });

  it("ONE CAUSE, ONE DOCUMENT: a duplicated settlement source cannot fold twice", () => {
    const dup = issue(3, 2, {
      docId: "01DOC000000000000000000099",
      sourceRef: "payment:01PAY00000000000000000001:3",
    });
    const first = issue(2, 1, { sourceRef: "payment:01PAY00000000000000000001:3" });
    expect(replaySeries([...opened(), first, dup])).toEqual({
      ok: false,
      atSeq: 3,
      reason: "duplicate_document_source",
    });
  });

  it("WATERMARK_REGRESSION: a later document may not stand on less history", () => {
    const events = [
      ...opened(),
      issue(2, 1, { watermark: { "journal:x": 10 } }),
      issue(3, 2, { docId: "01DOC000000000000000000099", watermark: { "journal:x": 9 } }),
    ];
    expect(replaySeries(events)).toEqual({ ok: false, atSeq: 3, reason: "watermark_regression" });
  });

  it("QUOTATION CONSISTENCY: total must equal the kernel sum of lines", () => {
    expect(replaySeries([...opened(), issue(2, 1, { amount: 5_000_01 })])).toEqual({
      ok: false,
      atSeq: 2,
      reason: "malformed_document",
    });
    // Float, negative and unsafe money cannot fold (kernel discipline).
    expect(
      replaySeries([
        ...opened(),
        issue(2, 1, {
          amount: 50.5,
          lines: [{ description: "x", amount: 50.5, provenance: { stream: "s", seq: 1 } }],
        }),
      ]),
    ).toEqual({ ok: false, atSeq: 2, reason: "malformed_document" });
  });

  it("DECOMPOSITION: a tax block that does not recompose exactly cannot fold", () => {
    const bad = issue(2, 1, {
      tax: { taxableValue: 4_237_29, ratePermille: 180, cgst: 38_135, sgst: 38_135 },
    });
    expect(replaySeries([...opened(), bad])).toEqual({
      ok: false,
      atSeq: 2,
      reason: "decomposition_mismatch",
    });
    const good = issue(2, 1, {
      tax: { taxableValue: 4_237_30, ratePermille: 180, cgst: 38_135, sgst: 38_135 },
    });
    expect(foldOk([...opened(), good]).documents).toHaveLength(1);
  });

  it("statutory lanes never interleave: corrections only in correction series", () => {
    const correctionInReceiptSeries = envelope("series", SERIES, 2, "CorrectionIssued", {
      ...issue(2, 1).payload,
      corrects: "01DOCX000000000000000000AA",
      reason: "refund",
    });
    expect(replaySeries([...opened("receipt"), correctionInReceiptSeries])).toEqual({
      ok: false,
      atSeq: 2,
      reason: "illegal_replayed_transition",
    });
    const documentInCorrectionSeries = issue(2, 1);
    expect(replaySeries([...opened("correction"), documentInCorrectionSeries])).toEqual({
      ok: false,
      atSeq: 2,
      reason: "illegal_replayed_transition",
    });
  });

  it("closes with the exact count; a closed series refuses further issues", () => {
    const events = [...opened(), issue(2, 1)];
    const wrongCount = envelope("series", SERIES, 3, "SeriesClosed", {
      count: 2,
      registerDigest: "d",
    });
    expect(replaySeries([...events, wrongCount])).toEqual({
      ok: false,
      atSeq: 3,
      reason: "malformed_series",
    });
    const closed = [
      ...events,
      envelope("series", SERIES, 3, "SeriesClosed", { count: 1, registerDigest: "d" }),
    ];
    expect(foldOk(closed).status).toBe("closed");
    expect(replaySeries([...closed, issue(4, 2, { docId: "01DOC000000000000000000098" })])).toEqual(
      { ok: false, atSeq: 4, reason: "illegal_replayed_transition" },
    );
  });

  it("command guards: one numbering lane per org·kind·fy, forever", () => {
    const input = {
      seriesId: SERIES,
      orgId: ORG,
      kind: "receipt" as const,
      fy: "2026-27",
      prefix: "RCT",
    };
    expect(decideOpenSeries(null, true, input)).toEqual({ ok: false, reason: "series_key_taken" });
    expect(decideOpenSeries(null, false, { ...input, fy: "2026-28" })).toEqual({
      ok: false,
      reason: "fy_invalid",
    });
    const fold = foldOk([...opened(), issue(2, 1)]);
    const close = decideCloseSeries(fold, { registerDigest: "sealed" });
    if (!close.ok) {
      throw new Error(close.reason);
    }
    expect(close.events[0]?.payload["count"]).toBe(1);
  });

  it("fails closed on gaps, unknown types and wrong genesis", () => {
    expect(replaySeries([issue(1, 1)])).toEqual({ ok: false, atSeq: 1, reason: "unknown_series" });
    expect(replaySeries([...opened(), envelope("series", SERIES, 2, "SeriesForged", {})])).toEqual({
      ok: false,
      atSeq: 2,
      reason: "unknown_event_type",
    });
    expect(replaySeries([...opened(), issue(3, 1)])).toEqual({
      ok: false,
      atSeq: 3,
      reason: "sequence_gap",
    });
  });
});
