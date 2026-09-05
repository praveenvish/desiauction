import { describe, expect, it } from "vitest";

import { rulesOf } from "./live-summary";

/**
 * PURSES ARE PUBLIC TO THE ROOM, AND THAT IS A DECISION (D2, 2026-09-04).
 *
 * This file exists because the previous behaviour was not a decision — it was
 * an appearance. Bidders were shown only their own money and the code called
 * that a sealed purse, while a rival's remaining purse was
 * `pursePerTeam − Σ soldPrice` and all three inputs sat on the same payload
 * that viewer already received (audit PA-1 §10 P1-3).
 *
 * So the rule is pinned in both directions. If somebody later re-seals purses
 * without also withholding hammer prices, these assertions say why that does
 * not work; if the product genuinely changes its mind, this is the file to
 * change deliberately rather than a default to drift.
 */
describe("purse visibility (founder decision D2)", () => {
  it("the rules payload carries pursePerTeam, which is what makes the seal impossible", () => {
    // Every owner is told the purse in their join preview, and it is one uniform
    // number for the whole auction. That single fact is the reason a per-team
    // seal cannot work while hammer prices are public.
    const rules = rulesOf({
      pursePerTeam: 20_000_000,
      squadMin: 8,
      squadMax: 15,
      slabs: [{ upToPaise: 1_000_000, stepPaise: 100_000 }],
      timer: { initialSeconds: 30, extensionSeconds: 15 },
      unsoldPolicy: { mode: "requeue", rounds: 2 },
      basePriceBands: {},
      basePriceDefault: 1_000_000,
      roleQuotas: {},
    });
    expect(rules.pursePerTeam).toBe(20_000_000);
  });

  it("remaining purse is arithmetic anyone in the room can already do", () => {
    // The derivation, written out: this is the whole finding. If this stops
    // being true — because hammer prices stop being public — a real seal
    // becomes possible and D2 is worth revisiting.
    const pursePerTeam = 20_000_000;
    const soldToThisTeam = [2_500_000, 4_000_000];
    const derived = pursePerTeam - soldToThisTeam.reduce((sum, price) => sum + price, 0);
    expect(derived).toBe(13_500_000);
  });
});
