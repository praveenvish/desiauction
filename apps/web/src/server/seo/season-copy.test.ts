import { describe, expect, it } from "vitest";

import { seasonDescription, seasonTitle, type SeasonCopyInput } from "./season-copy";

const season: SeasonCopyInput = {
  name: "Vishnoi Premier League",
  orgName: "Vishnoi CC",
  sport: "Cricket",
  location: "Mumbai",
  startsOn: "2026-10-01",
  dates: "1 – 30 Oct 2026",
  open: true,
  auctionDone: false,
  teamCount: 0,
  topBuy: null,
};

describe("seasonTitle", () => {
  it("answers registration before the auction, squads and results after", () => {
    expect(seasonTitle(season)).toBe("Vishnoi Premier League 2026 — player registration & auction");
    expect(seasonTitle({ ...season, open: false, auctionDone: true })).toBe(
      "Vishnoi Premier League 2026 auction — teams, squads & results",
    );
  });

  it("adds the year and 'auction' only when the name does not already say them", () => {
    expect(
      seasonTitle({ ...season, name: "VPL 2026 Auction", open: false, auctionDone: true }),
    ).toBe("VPL 2026 Auction — teams, squads & results");
    expect(seasonTitle({ ...season, startsOn: null })).toBe(
      "Vishnoi Premier League — player registration & auction",
    );
  });
});

describe("seasonDescription", () => {
  it("states the facts the page shows, and never a player's name", () => {
    const done = seasonDescription({
      ...season,
      open: false,
      auctionDone: true,
      teamCount: 8,
      topBuy: { teamName: "Falcons", price: "₹85,000" },
    });
    expect(done).toContain("Vishnoi CC's cricket tournament in Mumbai, 1 – 30 Oct 2026.");
    expect(done).toContain("Falcons paid the top price, ₹85,000.");
    expect(done.length).toBeLessThanOrEqual(160);
    expect(done.length).toBeGreaterThanOrEqual(50);
  });

  it("stops at a whole sentence within 160 characters, however long the names", () => {
    const long = seasonDescription({
      ...season,
      orgName: "The Extremely Long Name Of A Society Sports And Cultural Association",
      location: "Sector 57, Gurugram, Haryana",
      teamCount: 12,
    });
    expect(long.length).toBeLessThanOrEqual(160);
    expect(long.endsWith(".")).toBe(true);
  });
});
