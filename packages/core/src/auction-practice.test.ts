import { describe, expect, it } from "vitest";

import {
  DEFAULT_AUCTION_CONFIG,
  maxAffordableBid,
  minPossiblePrice,
  practiceAuctionConfig,
  practiceLotCount,
  validateAuctionConfig,
} from "./auction";

describe("practice auction rules", () => {
  const real = { ...DEFAULT_AUCTION_CONFIG, timer: { initialSeconds: 20, extensionSeconds: 10 } };

  it("is a valid 100-point auction with an exact squad and the real night's pace", () => {
    for (const perTeam of [2, 3] as const) {
      const config = practiceAuctionConfig(real, perTeam);
      expect(validateAuctionConfig(config)).toEqual({ ok: true });
      expect(config.pursePerTeam).toBe(100 * 100);
      expect(config.squadMin).toBe(perTeam);
      expect(config.squadMax).toBe(perTeam);
      expect(config.basePriceDefault).toBe(10 * 100);
      expect(config.roleQuotas).toEqual({});
      expect(config.timer).toEqual(real.timer);
      expect(config.unsoldPolicy).toEqual(real.unsoldPolicy);
    }
  });

  it("bids in whole points: +1 to 20, +2 to 50, +5 above", () => {
    expect(practiceAuctionConfig(real, 2).slabs).toEqual([
      { upTo: 20 * 100, step: 1 * 100 },
      { upTo: 50 * 100, step: 2 * 100 },
      { upTo: null, step: 5 * 100 },
    ]);
  });

  it("teaches the reserve rule: a team needing two can spend at most 90 on the first", () => {
    const config = practiceAuctionConfig(real, 2);
    expect(
      maxAffordableBid({
        purseRemaining: config.pursePerTeam,
        squadSize: 0,
        squadMin: config.squadMin,
        minPossiblePrice: minPossiblePrice(config),
      }),
    ).toBe(90 * 100);
  });

  it("offers every team's places plus two players nobody can buy", () => {
    expect(practiceLotCount(8, 2)).toBe(18);
    expect(practiceLotCount(8, 3)).toBe(26);
    expect(practiceLotCount(5, 2)).toBe(12);
  });
});
