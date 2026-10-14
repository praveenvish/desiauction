import { describe, expect, it } from "vitest";
import {
  computeTrust,
  detectPace,
  detectRallyPace,
  LIVE_RECEIPT_WINDOW_MS,
  type TrustFacts,
  type PaceRecord,
} from "./trust";
function facts(overrides: Partial<TrustFacts> = {}): TrustFacts {
  return {
    authority: { a: false, b: false, c: false, d: true },
    kind: "club",
    confirmations: { organiserVerified: false, opposingManagerConfirmed: false, disputed: false },
    liveScored: true,
    viewerPeak: 0,
    finishedAt: "2026-10-01T00:00:00Z",
    now: "2026-10-03T00:00:00Z",
    signals: [],
    ...overrides,
  };
}
function batch(count: number, spacing = 1000, lag = 0): PaceRecord[] {
  const receipt = Date.parse("2026-10-09T00:00:00Z");
  return Array.from({ length: count }, (_, index) => ({
    legal: true,
    clientRecordedAt: new Date(receipt - lag - (count - 1 - index) * spacing).toISOString(),
    receivedAt: new Date(receipt).toISOString(),
  }));
}
describe("pace detection", () => {
  it("flags impossible live pace only at >=30 legal balls and strictly under 4 seconds", () => {
    expect(detectPace(batch(30))).toEqual({ signals: ["pace_impossible"], liveScored: true });
    expect(detectPace(batch(29))).toEqual({ signals: [], liveScored: true });
    expect(detectPace(batch(30, 4000))).toEqual({ signals: [], liveScored: true });
    expect(detectPace(batch(30, 3999)).signals).toEqual(["pace_impossible"]);
    expect(detectPace(batch(30).map((value, index) => ({ ...value, legal: index > 0 })))).toEqual({
      signals: [],
      liveScored: true,
    });
  });
  it("treats synced backfill as soft even when it contains a fresh final timestamp", () => {
    const records = batch(30);
    const first = records[0];
    if (!first) throw new Error("Missing fixture");
    first.clientRecordedAt = "2026-10-08T00:00:00Z";
    expect(detectPace(records)).toEqual({ signals: ["backfilled"], liveScored: false });
    expect(detectPace(batch(30, 1000, 300_000))).toEqual({
      signals: ["backfilled"],
      liveScored: false,
    });
  });
  it("includes the 120-second boundary, excludes future/invalid/non-monotonic times", () => {
    expect(detectPace(batch(1, 0, LIVE_RECEIPT_WINDOW_MS)).liveScored).toBe(true);
    for (const records of [
      batch(1, 0, LIVE_RECEIPT_WINDOW_MS + 1),
      batch(1, 0, -1),
      batch(30).reverse(),
      [{ legal: true, clientRecordedAt: "bad", receivedAt: "bad" }],
    ])
      expect(detectPace(records)).toEqual({ signals: ["backfilled"], liveScored: false });
  });
  it("groups receipt batches, deduplicates reasons, and never treats empty/nonlegal input as live proof", () => {
    expect(detectPace([])).toEqual({ signals: [], liveScored: false });
    expect(detectPace(batch(30).map((record) => ({ ...record, legal: false })))).toEqual({
      signals: [],
      liveScored: false,
    });
    const live = batch(30);
    const backfill = batch(30, 1000, 300_000).map((record) => ({
      ...record,
      receivedAt: "2026-10-09T00:00:01Z",
    }));
    expect(detectPace([...live, ...backfill])).toEqual({
      signals: ["pace_impossible", "backfilled"],
      liveScored: false,
    });
    expect(detectPace([...backfill, ...backfill])).toEqual({
      signals: ["backfilled"],
      liveScored: false,
    });
    expect(
      detectPace(
        batch(30).map((record, index) => ({
          ...record,
          receivedAt: new Date(Date.parse(record.clientRecordedAt) + index).toISOString(),
        })),
      ),
    ).toEqual({ signals: [], liveScored: true });
  });
});
describe("trust computation", () => {
  it("derives dispute as the first hard reason even for elevated scorer authority", () => {
    const input = facts({
      authority: { a: true, b: false, c: false, d: false },
      signals: ["backfilled"],
      confirmations: { organiserVerified: false, opposingManagerConfirmed: true, disputed: true },
    });
    expect(computeTrust(input)).toEqual({ level: "flagged", reasons: ["disputed", "backfilled"] });
    input.confirmations.organiserVerified = true;
    expect(computeTrust(input)).toEqual({ level: "verified", reasons: ["disputed", "backfilled"] });
    input.kind = "personal";
    expect(computeTrust(input).level).toBe("confirmed");
  });
  it.each(["pace_impossible", "same_person_both_sides", "overlapping_matches"] as const)(
    "hard signal %s overrides authority and manager confirmation",
    (reason) => {
      const input = facts({
        authority: { a: true, b: false, c: false, d: false },
        signals: [reason],
        confirmations: {
          organiserVerified: false,
          opposingManagerConfirmed: true,
          disputed: false,
        },
      });
      expect(computeTrust(input)).toEqual({ level: "flagged", reasons: [reason] });
      input.confirmations.organiserVerified = true;
      expect(computeTrust(input).level).toBe("verified");
    },
  );
  it.each(["a", "b", "c"] as const)(
    "verifies live club authority %s but never personal organisations",
    (authority) => {
      const input = facts();
      input.authority[authority] = true;
      expect(computeTrust(input).level).toBe("verified");
      input.kind = "personal";
      expect(computeTrust(input).level).toBe("self_scored");
      input.confirmations.organiserVerified = true;
      expect(computeTrust(input).level).toBe("confirmed");
    },
  );
  it("requires explicit confirmation for backfilled/non-live scoring even with appointed authority", () => {
    for (const override of [{ liveScored: false }, { signals: ["backfilled" as const] }]) {
      const input = facts({
        ...override,
        authority: { a: true, b: true, c: true, d: true },
        viewerPeak: 100,
      });
      expect(computeTrust(input).level).toBe("self_scored");
      input.confirmations.opposingManagerConfirmed = true;
      expect(computeTrust(input).level).toBe("confirmed");
      input.confirmations.disputed = true;
      expect(computeTrust(input).level).toBe("flagged");
    }
  });
  it("allows immediate manager confirmation, then requires all automatic-confirmation conditions", () => {
    expect(
      computeTrust(
        facts({
          confirmations: {
            organiserVerified: false,
            opposingManagerConfirmed: true,
            disputed: false,
          },
          finishedAt: null,
        }),
      ).level,
    ).toBe("confirmed");
    expect(computeTrust(facts({ viewerPeak: 15 })).level).toBe("confirmed");
    for (const override of [
      { viewerPeak: 14 },
      { now: "2026-10-02T23:59:59.999Z" },
      { finishedAt: null },
      { finishedAt: "invalid" },
      { now: "invalid" },
      { liveScored: false },
      {
        confirmations: {
          organiserVerified: false,
          opposingManagerConfirmed: false,
          disputed: true,
        },
      },
    ])
      expect(computeTrust(facts({ viewerPeak: 15, ...override })).level).toBe(
        "confirmations" in override ? "flagged" : "self_scored",
      );
  });
  it("keeps soft reasons, orders/deduplicates deterministically, and lets effective organiser evidence elevate a manager-scored club match", () => {
    const input = facts({
      signals: ["opponent_all_guests", "backfilled", "scorer_is_top_scorer", "backfilled"],
      confirmations: { organiserVerified: true, opposingManagerConfirmed: false, disputed: false },
    });
    expect(computeTrust(input)).toEqual({
      level: "verified",
      reasons: ["backfilled", "scorer_is_top_scorer", "opponent_all_guests"],
    });
    input.confirmations.organiserVerified = false;
    expect(computeTrust(input).level).toBe("self_scored");
  });
});

describe("rally receipt policy", () => {
  it("accepts fast valid rallies without a cricket physical-pace signal", () => {
    expect(detectRallyPace(batch(60, 10))).toEqual({ signals: [], liveScored: true });
    expect(detectPace(batch(60, 10)).signals).toEqual(["pace_impossible"]);
  });
  it("requires activity, valid receipt window and monotonic timing within each batch", () => {
    expect(detectRallyPace([])).toEqual({ signals: [], liveScored: false });
    expect(detectRallyPace(batch(1, 0, LIVE_RECEIPT_WINDOW_MS)).liveScored).toBe(true);
    for (const rows of [
      batch(1, 0, LIVE_RECEIPT_WINDOW_MS + 1),
      batch(1, 0, -1),
      batch(3).reverse(),
      [{ legal: true, clientRecordedAt: "bad", receivedAt: "bad" }],
    ])
      expect(detectRallyPace(rows)).toEqual({ signals: ["backfilled"], liveScored: false });
  });
});
