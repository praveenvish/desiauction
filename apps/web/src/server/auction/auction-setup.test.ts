import { DEFAULT_AUCTION_CONFIG, isValidSlabs, pointsSlabs, paise } from "@desiauction/core";
import { describe, expect, it } from "vitest";

import { parseAuctionSetup } from "./auction-setup";

// 0091: the organizer types whole rupees or whole points; both store ×100.

const form = (overrides: Record<string, string> = {}) => ({
  pursePerTeam: "1000",
  squadMin: "8",
  squadMax: "15",
  timerSeconds: "30",
  extensionSeconds: "15",
  basePriceDefault: "10",
  bands: { A: "50", B: "20", C: "10" },
  ...overrides,
});

describe("parseAuctionSetup — points", () => {
  it("stores points ×100 and ladders them from the purse", () => {
    const result = parseAuctionSetup(form(), "points");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.config.pursePerTeam).toBe(100_000);
    expect(result.config.basePriceDefault).toBe(1_000);
    expect(result.config.basePriceBands).toEqual({ A: 5_000, B: 2_000, C: 1_000 });
    expect(result.config.slabs).toEqual(pointsSlabs(paise(100_000)));
    expect(isValidSlabs(result.config.slabs)).toBe(true);
  });

  it("allows the small numbers a points league uses, and says so in points", () => {
    expect(
      parseAuctionSetup(form({ pursePerTeam: "100", basePriceDefault: "1" }), "points").ok,
    ).toBe(true);
    const refused = parseAuctionSetup(form({ pursePerTeam: "5" }), "points");
    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    expect(refused.fieldErrors["pursePerTeam"]).toBe("Purse per team must be at least 10 pts.");
    expect(JSON.stringify(refused.fieldErrors)).not.toContain("₹");
  });

  it("the same form is refused in rupees, where ₹1,000 is a typo — and keeps the rupee ladder", () => {
    const rupees = parseAuctionSetup(form({ pursePerTeam: "500" }), "inr");
    expect(rupees.ok).toBe(false);
    if (!rupees.ok) {
      expect(rupees.fieldErrors["pursePerTeam"]).toBe("Purse per team must be at least ₹1,000.");
    }
    const ok = parseAuctionSetup({
      ...form({ pursePerTeam: "20000000", basePriceDefault: "10000" }),
      bands: { A: "50000" },
    });
    expect(ok.ok && ok.config.slabs).toEqual(DEFAULT_AUCTION_CONFIG.slabs);
  });
});
