import { buildPlayerPoster, type PlayerPosterInput } from "@desiauction/core";
import { describe, expect, it } from "vitest";

import { playerShareMessage, whatsappHref, withRef } from "./share-message";

const SOLD: PlayerPosterInput = {
  playerName: "Rohit Yadav",
  number: "R67X349",
  role: "batter",
  photoUrl: null,
  outcome: "sold",
  pricePaise: 1_250_000,
  teamName: "Jaipur Jaguars",
  teamCrestUrl: null,
  competitionName: "Vishnoi Premier League",
  competitionLogoUrl: null,
  unit: "inr",
};

describe("playerShareMessage", () => {
  it("says the sale the way the card does: who, to whom, for how much, where", () => {
    const model = buildPlayerPoster(SOLD);
    expect(playerShareMessage(model, "en")).toBe(
      "Sold! Rohit Yadav goes to Jaipur Jaguars for ₹12,500. Vishnoi Premier League",
    );
    expect(playerShareMessage(model, "hi")).toBe(
      "बिक गया! Rohit Yadav — Jaipur Jaguars, ₹12,500 में। Vishnoi Premier League",
    );
  });

  it("asks for bids from the pool, with the base price when there is one", () => {
    const pool = buildPlayerPoster({
      ...SOLD,
      outcome: "pool",
      pricePaise: null,
      teamName: null,
      basePricePaise: 200_000,
    });
    expect(playerShareMessage(pool, "en")).toContain("Base price ₹2,000. Bid for me!");
    expect(playerShareMessage(pool, "hi")).toContain("बेस प्राइस ₹2,000");
    const noBase = buildPlayerPoster({
      ...SOLD,
      outcome: "pool",
      pricePaise: null,
      teamName: null,
    });
    expect(playerShareMessage(noBase, "en")).not.toContain("Base price");
  });

  it("names a pre-signed player's role and team, and never a price", () => {
    const icon = buildPlayerPoster({ ...SOLD, outcome: "icon", pricePaise: 900_000 });
    expect(playerShareMessage(icon, "en")).toBe(
      "Rohit Yadav — Icon player, Jaipur Jaguars. Vishnoi Premier League",
    );
    expect(playerShareMessage(icon, "en")).not.toContain("₹");
    expect(playerShareMessage(icon, "hi")).toContain("आइकन खिलाड़ी");
  });

  it("never claims more than it knows about an unsold player", () => {
    const unsold = buildPlayerPoster({ ...SOLD, outcome: "unsold", teamName: null });
    expect(playerShareMessage(unsold, "en")).toBe("Rohit Yadav — Vishnoi Premier League");
  });
});

describe("playerShareMessage — a points season", () => {
  it("says the price in points, in both languages", () => {
    const model = buildPlayerPoster({ ...SOLD, unit: "points", pricePaise: 125_000 });
    expect(playerShareMessage(model, "en")).toBe(
      "Sold! Rohit Yadav goes to Jaipur Jaguars for 1,250 pts. Vishnoi Premier League",
    );
    expect(playerShareMessage(model, "hi")).toContain("1,250 pts");
    expect(playerShareMessage(model, "en")).not.toContain("₹");
  });
});

describe("share links", () => {
  it("stamps the source on the link, respecting an existing query", () => {
    expect(withRef("https://x.in/c/a/p/1", "whatsapp")).toBe("https://x.in/c/a/p/1?ref=whatsapp");
    expect(withRef("https://x.in/c/a?v=2", "qr")).toBe("https://x.in/c/a?v=2&ref=qr");
    // Before hydration the page address is unknown; no half-built link.
    expect(withRef("", "link")).toBe("");
  });

  it("builds a wa.me link carrying the message and the URL", () => {
    const href = whatsappHref("Sold! ₹12,500", "https://x.in/c/a/p/1?ref=whatsapp");
    expect(href.startsWith("https://wa.me/?text=")).toBe(true);
    expect(decodeURIComponent(href.slice("https://wa.me/?text=".length))).toBe(
      "Sold! ₹12,500\nhttps://x.in/c/a/p/1?ref=whatsapp",
    );
  });
});
