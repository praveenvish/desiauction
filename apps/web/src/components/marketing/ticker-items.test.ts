import { describe, expect, it } from "vitest";

import { tickerItems } from "./ticker-items";

const SPORTS = ["Cricket", "Football", "Kabaddi", "Volleyball", "Hockey"];
const VPL = {
  name: "VPL-1",
  location: "Vishnunagar",
  orgName: "Vishnu Club",
  playerCount: 105,
  teamCount: 5,
};

describe("tickerItems", () => {
  it("leads real seasons with what they are, not a claim that they are live", () => {
    const { lead, items } = tickerItems([VPL], SPORTS);
    expect(lead).toBe("On DesiAuction");
    expect(items[0]).toBe("VPL-1 · Vishnunagar · 105 players · 5 teams");
    expect([lead, ...items].join(" ")).not.toMatch(/live/i);
  });

  it("has no lead when there is no real season to lead into", () => {
    expect(tickerItems([], SPORTS).lead).toBeNull();
  });

  it("names the sports once: a count, three names, and how many more", () => {
    const { items } = tickerItems([], SPORTS);
    expect(items).toEqual([
      "5 sports · Cricket, Football, Kabaddi and 2 more",
      "Free during beta",
      "No app to install",
    ]);
  });

  it("does not say 'and 0 more'", () => {
    expect(tickerItems([], ["Cricket", "Football"]).items[0]).toBe("2 sports · Cricket, Football");
  });

  it("agrees counts with their nouns, and falls back to the club for a place", () => {
    const { items } = tickerItems(
      [{ ...VPL, location: null, playerCount: 1, teamCount: 1 }],
      SPORTS,
    );
    expect(items[0]).toBe("VPL-1 · Vishnu Club · 1 player · 1 team");
  });

  it("writes every item in sentence case; the strip capitalises with CSS", () => {
    for (const item of tickerItems([VPL], SPORTS).items) {
      expect(item).not.toBe(item.toUpperCase());
    }
  });
});
