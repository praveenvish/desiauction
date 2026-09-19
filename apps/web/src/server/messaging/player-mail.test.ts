import { describe, expect, it } from "vitest";

import {
  appointmentMail,
  bidStory,
  ownerSummaryMail,
  soldMail,
  unsoldMail,
  type SoldFacts,
} from "./player-mail";

const sale: SoldFacts = {
  name: "Arjun",
  season: "Malad Premier League 2026",
  orgName: "Malad Cricket Club",
  teamName: "Cup Kings",
  price: "₹75,000",
  basePrice: "₹25,000",
  multiple: 3,
  bidders: ["Tigers", "Cup Kings", "Falcons"],
  bidCount: 7,
  highlight: "You were the most expensive buy of the night",
  squad: [
    { name: "Arjun Sharma", note: "₹75,000" },
    { name: "Vikram Patel", note: "Captain · ₹25,000" },
  ],
  cardUrl: "https://desiauction.in/c/mpl/p/R8KQ2X1",
};

describe("the sale", () => {
  it("tells the story of the bidding — who bid, how many times, from base to hammer", () => {
    expect(bidStory(sale)).toBe(
      "Tigers, Cup Kings and Falcons all bid for you — 7 bids in all, from ₹25,000 to ₹75,000. Cup Kings won.",
    );
  });

  it("says it plainly when only the winning team bid", () => {
    expect(bidStory({ ...sale, bidders: ["Cup Kings"], bidCount: 1 })).toBe(
      "Cup Kings bid for you at your base price of ₹25,000.",
    );
  });

  it("names the team and the price in the subject, and the multiple of base in the body", () => {
    const mail = soldMail(sale);
    expect(mail.subject).toBe("Congratulations — Cup Kings bought you for ₹75,000");
    expect(mail.text).toContain("3 times your base");
    expect(mail.text).toContain("most expensive buy of the night");
    expect(mail.text).toContain("Vikram Patel");
    expect(mail.html).toContain("See your player card");
  });

  it("sends a player with no public card to their season instead", () => {
    expect(soldMail({ ...sale, cardUrl: null }).html).toContain("See your season");
  });
});

describe("not picked", () => {
  it("is kind: the subject does not say unsold, and the body says they are still registered", () => {
    const mail = unsoldMail({ name: "Rohit", season: "MPL 2026", orgName: "Malad CC" });
    expect(mail.subject.toLowerCase()).not.toContain("unsold");
    expect(mail.text).toContain("still registered");
  });
});

describe("appointments", () => {
  it("names the role and the team for each of the four roles", () => {
    for (const [role, title] of [
      ["captain", "captain"],
      ["vice_captain", "vice-captain"],
      ["icon", "icon player"],
      ["retained", "retained player"],
    ] as const) {
      const mail = appointmentMail({
        name: "Arjun",
        season: "MPL 2026",
        orgName: "Malad CC",
        teamName: "Cup Kings",
        role,
      });
      expect(mail.subject).toBe(`You're the ${title} of Cup Kings`);
    }
  });

  it("tells an icon they will not go under the hammer", () => {
    const mail = appointmentMail({
      name: "Arjun",
      season: "MPL 2026",
      orgName: "Malad CC",
      teamName: "Cup Kings",
      role: "icon",
    });
    expect(mail.text).toContain("won't go under the hammer");
  });
});

describe("the owner's night", () => {
  it("lists the squad, the spend and the purse left, and names a shortfall", () => {
    const mail = ownerSummaryMail({
      name: "Priya",
      season: "MPL 2026",
      teamName: "Cup Kings",
      squad: sale.squad,
      spent: "₹1,00,000",
      purseLeft: "₹1,99,00,000",
      squadSize: 2,
      squadMin: 8,
      squadMax: 15,
      teamUrl: "https://desiauction.in/seasons/mpl/teams",
    });
    expect(mail.text).toContain("Purse left: ₹1,99,00,000");
    expect(mail.text).toContain("6 short of the minimum of 8");
  });
});
