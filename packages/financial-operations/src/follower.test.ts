import { describe, expect, it } from "vitest";

import { streamLags, totalLag, verifyBatch, watermarkFromCursors } from "./follower";
import {
  canonicalWatermark,
  fiscalYearBounds,
  fiscalYearOf,
  isFiscalYear,
  istDateOf,
  previousDate,
  watermarkAdvances,
  watermarkOf,
} from "./watermark";

describe("follower decisions", () => {
  it("verifyBatch accepts only DENSE continuations from the cursor", () => {
    expect(verifyBatch(3, [4, 5, 6])).toEqual({ ok: true, nextSeq: 6 });
    expect(verifyBatch(0, [1])).toEqual({ ok: true, nextSeq: 1 });
    expect(verifyBatch(3, [])).toEqual({ ok: true, nextSeq: 3 });
    // A gap (raced an in-flight append) → wait, never skip.
    expect(verifyBatch(3, [5, 6])).toEqual({ ok: false, reason: "sequence_gap", atSeq: 5 });
    expect(verifyBatch(3, [4, 6])).toEqual({ ok: false, reason: "sequence_gap", atSeq: 6 });
    // Re-served history → consume nothing (idempotency holds at the batch edge).
    expect(verifyBatch(3, [3, 4])).toEqual({ ok: false, reason: "regression", atSeq: 3 });
  });

  it("streamLags and totalLag report exactly how far behind each cursor is", () => {
    const heads = [
      { streamType: "case", streamId: "A", headSeq: 7 },
      { streamType: "journal", streamId: "O", headSeq: 4 },
    ];
    const cursors = [{ streamType: "case", streamId: "A", lastSeq: 5 }];
    const lags = streamLags(heads, cursors);
    expect(lags).toEqual([
      { streamType: "case", streamId: "A", cursorSeq: 5, headSeq: 7, behind: 2 },
      { streamType: "journal", streamId: "O", cursorSeq: 0, headSeq: 4, behind: 4 },
    ]);
    expect(totalLag(lags)).toBe(6);
  });

  it("watermarkFromCursors is canonical (sorted keys, deterministic bytes)", () => {
    const forward = watermarkFromCursors([
      { streamType: "journal", streamId: "O", lastSeq: 4 },
      { streamType: "case", streamId: "A", lastSeq: 5 },
    ]);
    const reversed = watermarkFromCursors([
      { streamType: "case", streamId: "A", lastSeq: 5 },
      { streamType: "journal", streamId: "O", lastSeq: 4 },
    ]);
    expect(JSON.stringify(forward)).toBe(JSON.stringify(reversed));
    expect(forward).toEqual({ "case:A": 5, "journal:O": 4 });
  });
});

describe("watermarks and the fiscal calendar", () => {
  it("watermarkAdvances: hold or advance, never regress; new streams may appear", () => {
    expect(watermarkAdvances({ "a:1": 3 }, { "a:1": 3 })).toBe(true);
    expect(watermarkAdvances({ "a:1": 3 }, { "a:1": 4, "b:2": 1 })).toBe(true);
    expect(watermarkAdvances({ "a:1": 3 }, { "a:1": 2 })).toBe(false);
    expect(watermarkAdvances({ "a:1": 3 }, {})).toBe(false);
    expect(watermarkAdvances({}, { "a:1": 1 })).toBe(true);
  });

  it("watermarkOf fails closed on non-seq values; canonicalWatermark sorts keys", () => {
    expect(watermarkOf({ "a:1": 3 })).toEqual({ "a:1": 3 });
    expect(watermarkOf({ "a:1": -1 })).toBeNull();
    expect(watermarkOf({ "a:1": 1.5 })).toBeNull();
    expect(watermarkOf({ "a:1": "3" })).toBeNull();
    expect(watermarkOf("nope")).toBeNull();
    expect(JSON.stringify(canonicalWatermark({ b: 2, a: 1 }))).toBe('{"a":1,"b":2}');
  });

  it("the Indian fiscal calendar: April–March, IST dates", () => {
    expect(fiscalYearOf("2026-03-31")).toBe("2025-26");
    expect(fiscalYearOf("2026-04-01")).toBe("2026-27");
    expect(isFiscalYear("2026-27")).toBe(true);
    expect(isFiscalYear("2026-28")).toBe(false);
    expect(isFiscalYear("2026")).toBe(false);
    expect(fiscalYearBounds("2025-26")).toEqual({ start: "2025-04-01", end: "2026-03-31" });
    expect(previousDate("2026-04-01")).toBe("2026-03-31");
    expect(previousDate("2026-01-01")).toBe("2025-12-31");
    // 2023-11-14T18:30:00Z is exactly 2023-11-15 00:00 IST.
    expect(istDateOf(Date.parse("2023-11-14T18:30:00.000Z"))).toBe("2023-11-15");
    expect(istDateOf(Date.parse("2023-11-14T18:29:59.999Z"))).toBe("2023-11-14");
  });
});
