import { describe, expect, it } from "vitest";

import {
  DEFAULT_AUCTION_CONFIG,
  DEFAULT_POINTS_AUCTION_CONFIG,
  defaultAuctionConfigFor,
  isValidSlabs,
  ladderContains,
  ladderStep,
  nextMinimumBid,
  pointsSlabs,
  validateAuctionConfig,
} from "./auction";
import { formatAmount, formatPaiseINR, isMoneyUnit, paise } from "./money";

// 0091 — a season's auction counts in rupees or points. Both store ×100.

describe("formatAmount", () => {
  it("rupees read exactly as they always have", () => {
    for (const value of [0, 150, 110500000, 2_000_000_000]) {
      expect(formatAmount(paise(value), "inr")).toBe(formatPaiseINR(paise(value)));
    }
  });

  it("points read as whole points, grouped, with no rupee sign", () => {
    expect(formatAmount(paise(100_000), "points")).toBe("1,000 pts");
    expect(formatAmount(paise(125_000_00), "points")).toBe("1,25,000 pts");
    expect(formatAmount(paise(0), "points")).toBe("0 pts");
    expect(formatAmount(paise(100_000), "points")).not.toContain("₹");
  });

  it("a stray hundredth is shown, never dropped", () => {
    expect(formatAmount(paise(12_550), "points")).toBe("125.50 pts");
  });

  it("isMoneyUnit admits exactly the two units", () => {
    expect(isMoneyUnit("inr")).toBe(true);
    expect(isMoneyUnit("points")).toBe(true);
    for (const value of ["INR", "pts", "", null, 1]) expect(isMoneyUnit(value)).toBe(false);
  });
});

describe("pointsSlabs — the ladder follows the purse", () => {
  const stepsAt = (purse: number, prices: number[]) =>
    prices.map((price) => ladderStep(pointsSlabs(paise(purse * 100)), paise(price * 100)) / 100);

  it("a 1,000-point purse bids +5 / +10 / +25", () => {
    expect(stepsAt(1_000, [10, 199, 200, 499, 500, 900])).toEqual([5, 5, 10, 10, 25, 25]);
  });

  it("a 1,00,000-point purse bids +500 / +1,000 / +2,500", () => {
    expect(stepsAt(100_000, [1_000, 20_000, 50_000])).toEqual([500, 1_000, 2_500]);
  });

  it("every step is a whole point, and every purse gives valid slabs", () => {
    for (const purse of [10, 37, 100, 999, 1_000, 5_000, 12_345, 100_000, 100_000_000]) {
      const slabs = pointsSlabs(paise(purse * 100));
      expect(isValidSlabs(slabs), `purse ${String(purse)}`).toBe(true);
      for (const slab of slabs) expect(slab.step % 100).toBe(0);
    }
  });

  it("rungs are reachable from the default base", () => {
    const slabs = pointsSlabs(paise(100_000));
    const base = paise(1_000);
    let price = base;
    for (let i = 0; i < 80; i++) {
      expect(ladderContains(base, slabs, price)).toBe(true);
      price = nextMinimumBid(base, slabs, price);
    }
  });
});

describe("the points starting config", () => {
  it("validates, and is what a points season gets by default", () => {
    expect(validateAuctionConfig(DEFAULT_POINTS_AUCTION_CONFIG)).toEqual({ ok: true });
    expect(defaultAuctionConfigFor("points")).toBe(DEFAULT_POINTS_AUCTION_CONFIG);
    expect(defaultAuctionConfigFor("inr")).toBe(DEFAULT_AUCTION_CONFIG);
    expect(DEFAULT_POINTS_AUCTION_CONFIG.pursePerTeam).toBe(100_000);
  });
});
