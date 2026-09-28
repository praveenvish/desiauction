import { describe, expect, it } from "vitest";

import { auctionResultsMail } from "./organizer-mail";
import { soldStageLine, type SoldFacts } from "./player-mail";

const sale: SoldFacts = {
  name: "Arjun",
  season: "MPL 2026",
  orgName: "Malad CC",
  teamName: "Cup Kings",
  price: "₹75,000",
  basePrice: "₹25,000",
  multiple: 3,
  bidders: ["Tigers", "Cup Kings", "Falcons"],
  bidCount: 7,
  highlight: null,
  squad: [],
  cardUrl: null,
};

describe("the sale's stage line", () => {
  it("tells the night in one line, and leaves out what is not a story", () => {
    expect(soldStageLine(sale, "en")).toBe("3× your base · 7 bids · 3 teams");
    expect(soldStageLine(sale, "hi")).toBe("बेस प्राइस का 3 गुना · 7 बोलियाँ · 3 टीमें");
    // Bought once, at base, by the only bidder: nothing to boast of.
    expect(soldStageLine({ ...sale, multiple: 1, bidCount: 1, bidders: ["Cup Kings"] }, "en")).toBe(
      "",
    );
  });
});

describe("the organizer's results pack", () => {
  it("counts, totals, lists the top buys and each team's spend", async () => {
    const mail = await auctionResultsMail(
      {
        name: "Priya",
        season: "MPL 2026",
        orgName: "Malad CC",
        seasonSlug: "mpl-2026",
        sport: "cricket",
        sold: 38,
        pool: 43,
        spent: "₹12,40,000",
        topBuys: ["Arjun Sharma — Cup Kings, ₹75,000", "Rohit Nair — Tigers, ₹60,000"],
        teams: [
          { team: "Cup Kings", spent: "₹2,10,000", players: 9 },
          { team: "Tigers", spent: "₹1,90,000", players: 1 },
        ],
      },
      "en",
    );
    expect(mail.subject).toBe("MPL 2026 auction: 38 players sold, ₹12,40,000 spent");
    expect(mail.text).toContain("38 of 43 players were sold");
    expect(mail.text).toContain("Arjun Sharma — Cup Kings, ₹75,000");
    expect(mail.text).toContain("  Cup Kings: ₹2,10,000 · 9 players");
    expect(mail.text).toContain("  Tigers: ₹1,90,000 · 1 player");
    expect(mail.text).toContain("✓ Club → ✓ Season → ✓ Players → ✓ Auction");
    expect(mail.text).toContain("/seasons/mpl-2026/auction");
  });
});
