import type { AuctionSnapshot } from "@desiauction/core";
import { describe, expect, it } from "vitest";

import { moneyFormat } from "../../../../lib/money";
import {
  advanceClockLadder,
  ceremonyLine,
  CLOCK_LADDER_START,
  type ClockLadder,
} from "./auction-announcer";

/** Feeds a lot's clock through the ladder, returning every call it makes. */
function run(ticks: [string | null, number | null][]): (string | null)[] {
  let ladder: ClockLadder = CLOCK_LADDER_START;
  const said: (string | null)[] = [];
  for (const [lotId, remainingMs] of ticks) {
    const next = advanceClockLadder(ladder, lotId, remainingMs);
    if (next.call !== ladder.call) {
      said.push(next.call?.text ?? null);
    }
    ladder = next;
  }
  return said;
}

describe("the clock announcer's ladder", () => {
  it("calls thirty, ten and time once each, in order", () => {
    expect(
      run([
        ["a", 45_000],
        ["a", 30_000],
        ["a", 29_900],
        ["a", 10_000],
        ["a", 9_000],
        ["a", 0],
        ["a", 0],
      ]),
    ).toEqual(["30 seconds left.", "10 seconds left.", "Time. The lot is with the auctioneer."]);
  });

  it("returns the same ladder when nothing changes, so render-time adjustment settles", () => {
    const first = advanceClockLadder(CLOCK_LADDER_START, "a", 20_000);
    expect(advanceClockLadder(first, "a", 20_000)).toBe(first);
    expect(advanceClockLadder(first, "a", 19_000)).toBe(first);
    const resolved = advanceClockLadder(first, null, null);
    expect(advanceClockLadder(resolved, null, null)).toBe(resolved);
  });

  it("says the more urgent call when one tick crosses both thresholds", () => {
    // A late join, or a background tab catching up: five seconds left is not
    // the moment to announce thirty.
    expect(run([["a", 5_000]])).toEqual(["10 seconds left."]);
  });

  it("clears the call when the lot resolves, and starts afresh for the next lot", () => {
    expect(
      run([
        ["a", 8_000],
        [null, null],
        ["b", 25_000],
      ]),
    ).toEqual(["10 seconds left.", null, "30 seconds left."]);
  });

  it("does not repeat a call when the same lot's clock pauses and resumes", () => {
    expect(
      run([
        ["a", 25_000],
        ["a", null],
        ["a", 24_000],
      ]),
    ).toEqual(["30 seconds left.", null]);
  });
});

describe("the ceremony announcer's sentence", () => {
  const sold = {
    lastOutcome: { playerName: "Asha", lotNumber: "1", teamName: "Falcons", amount: 125_000 },
    currentLot: null,
  } as unknown as AuctionSnapshot;

  it("speaks the sale price in rupees for a rupee season", () => {
    expect(ceremonyLine({ phase: "sold", key: "k" }, sold, moneyFormat("inr"))).toBe(
      "Sold. Asha to Falcons for ₹1,250.",
    );
  });

  it("speaks points, never rupees, for a points season", () => {
    const line = ceremonyLine({ phase: "sold", key: "k" }, sold, moneyFormat("points"));
    expect(line).toBe("Sold. Asha to Falcons for 1,250 pts.");
    expect(line).not.toContain("₹");
  });
});
