import { describe, expect, it } from "vitest";

import {
  canonicalSourceBytes,
  committedByTeam,
  computeObligations,
  foldSource,
  verifySource,
} from "./intake";
import { auctionSourceLog, testDigest, withAuctionRecovered } from "./testing";

const TEAM_A = "01TEAMA000000000000000000A";
const TEAM_B = "01TEAMB000000000000000000B";
const TEAM_C = "01TEAMC000000000000000000C";

const NIGHT = auctionSourceLog({
  teams: [
    { teamId: TEAM_A, paddleId: "01PADDLEA0000000000000000" },
    { teamId: TEAM_B, paddleId: "01PADDLEB0000000000000000" },
    { teamId: TEAM_C, paddleId: "01PADDLEC0000000000000000" },
  ],
  sales: [
    { lotId: "01LOT10000000000000000000", paddleId: "01PADDLEA0000000000000000", amount: 500_000 },
    { lotId: "01LOT20000000000000000000", paddleId: "01PADDLEB0000000000000000", amount: 350_000 },
    { lotId: "01LOT30000000000000000000", paddleId: "01PADDLEA0000000000000000", amount: 150_000 },
  ],
});

describe("Intake — the frozen auction is folded, never re-implemented", () => {
  it("folds the real auction log with the FROZEN reducer and pins what it saw", () => {
    const folded = foldSource(NIGHT, testDigest);
    expect(folded.ok).toBe(true);
    if (!folded.ok) {
      return;
    }
    expect(folded.source.pin.sourceEventCount).toBe(NIGHT.length);
    expect(folded.source.pin.sourceDigest).toBe(testDigest(canonicalSourceBytes(NIGHT)));
    expect(folded.source.fold.status).toBe("completed");
    // Team A bought two players across one paddle; team C bought nobody.
    expect(folded.source.totalCommitted).toBe(1_000_000);
    expect(folded.source.teamCount).toBe(3);
  });

  it("is reproducible: the same log pins to the same digest, forever", () => {
    const first = foldSource(NIGHT, testDigest);
    const second = foldSource([...NIGHT], testDigest);
    expect(first).toEqual(second);
  });

  it("refuses a log that will not fold — a corrupt source is never intake", () => {
    const corrupt = [...NIGHT.slice(0, 3), ...NIGHT.slice(4)]; // a hole in the seq
    const folded = foldSource(corrupt, testDigest);
    expect(folded.ok).toBe(false);
    if (!folded.ok) {
      expect(folded.reason).toBe("sequence_gap");
    }
    const outcome = verifySource(corrupt, { sourceEventCount: 0, sourceDigest: "x" }, testDigest);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.reasonCode).toBe("fold_failed");
    }
  });
});

describe("Intake — verification against the pin", () => {
  const pinned = (() => {
    const folded = foldSource(NIGHT, testDigest);
    if (!folded.ok) {
      throw new Error("fixture");
    }
    return folded.source.pin;
  })();

  it("verifies an unchanged source", () => {
    const outcome = verifySource(NIGHT, pinned, testDigest);
    expect(outcome.ok).toBe(true);
  });

  it("declares a discrepancy when the source GREW — the AuctionRecovered case", () => {
    const grown = withAuctionRecovered(NIGHT);
    const outcome = verifySource(grown, pinned, testDigest);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.reasonCode).toBe("count_mismatch");
      expect(outcome.detail).toContain(String(NIGHT.length));
    }

    // The money did not move — which is precisely why the override exit re-pins
    // instead of stranding the case: re-folding the GROWN log yields the same
    // obligations, to the paisa.
    const before = foldSource(NIGHT, testDigest);
    const after = foldSource(grown, testDigest);
    expect(before.ok && after.ok).toBe(true);
    if (before.ok && after.ok) {
      expect(committedByTeam(after.source.fold)).toEqual(committedByTeam(before.source.fold));
      expect(after.source.totalCommitted).toBe(before.source.totalCommitted);
      expect(computeObligations(after.source.fold, "committed", {})).toEqual(
        computeObligations(before.source.fold, "committed", {}),
      );
      // …and the new pin is genuinely different, so adopting it is a recorded act.
      expect(after.source.pin.sourceDigest).not.toBe(before.source.pin.sourceDigest);
    }
  });

  it("declares a discrepancy when the source was TAMPERED at the same length", () => {
    const tampered = NIGHT.map((event) =>
      event.type === "LotSold"
        ? { ...event, payload: { ...event.payload, amount: 999_999 } }
        : event,
    );
    const outcome = verifySource(tampered, pinned, testDigest);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.reasonCode).toBe("digest_mismatch");
    }
  });
});

describe("Intake — obligations are a pure function of (fold, basis)", () => {
  const fold = (() => {
    const folded = foldSource(NIGHT, testDigest);
    if (!folded.ok) {
      throw new Error("fixture");
    }
    return folded.source.fold;
  })();

  it("committed: what a team spent is what a team owes — and a team that bought nobody owes nothing", () => {
    const result = computeObligations(fold, "committed", {});
    expect(result).toEqual({
      ok: true,
      items: [
        { teamId: TEAM_A, amount: 650_000 },
        { teamId: TEAM_B, amount: 350_000 },
      ],
    });
  });

  it("fixed: only the organizer's declared amounts, and only for teams that exist", () => {
    expect(computeObligations(fold, "fixed", { [TEAM_C]: 100_000 })).toEqual({
      ok: true,
      items: [{ teamId: TEAM_C, amount: 100_000 }],
    });
    expect(computeObligations(fold, "fixed", { "01NOSUCHTEAM00000000000000": 1 })).toEqual({
      ok: false,
      reason: "unknown_team",
    });
    expect(computeObligations(fold, "fixed", { [TEAM_A]: -5 })).toEqual({
      ok: false,
      reason: "invalid_amount",
    });
  });

  it("none: verification and publication without a single rupee of dues", () => {
    expect(computeObligations(fold, "none", {})).toEqual({ ok: true, items: [] });
  });

  it("orders items deterministically, so the same night always posts the same bytes", () => {
    const once = computeObligations(fold, "committed", {});
    const again = computeObligations(fold, "committed", {});
    expect(JSON.stringify(once)).toBe(JSON.stringify(again));
  });
});
