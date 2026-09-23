import { beforeAll, describe, expect, it } from "vitest";

import { emailChangedCopy, phoneChangedCopy } from "../auth/email-changed-notice";
import { applyWhatsAppNudge, hasWhatsAppNudge } from "./email-layout";
import type { NotificationMail } from "./notification-email";
import { DLT_VAR_MAX, smsPrice } from "./templates";

import {
  appointmentMail,
  lineupMail,
  bidStory,
  ownerSummaryMail,
  registrationDecisionMail,
  rolesTitle,
  smsRolePhrase,
  soldMail,
  squadSheetMail,
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

  it("names the team and the price in the subject, and the multiple of base in the body", async () => {
    const mail = await soldMail(sale);
    expect(mail.subject).toBe("Congratulations — Cup Kings bought you for ₹75,000");
    expect(mail.text).toContain("3 times your base");
    expect(mail.text).toContain("most expensive buy of the night");
    expect(mail.text).toContain("Vikram Patel");
    expect(mail.html).toContain("See your player card");
  });

  it("sends a player with no public card to their season instead", async () => {
    expect((await soldMail({ ...sale, cardUrl: null })).html).toContain("See your season");
  });
});

describe("not picked", () => {
  it("is kind: the subject does not say unsold, and the body says they are still registered", async () => {
    const mail = await unsoldMail({ name: "Rohit", season: "MPL 2026", orgName: "Malad CC" });
    expect(mail.subject.toLowerCase()).not.toContain("unsold");
    expect(mail.text).toContain("still registered");
  });
});

describe("appointments", () => {
  const base = {
    name: "Arjun",
    season: "MPL 2026",
    orgName: "Malad CC",
    teamName: "Cup Kings",
    bought: false,
  };

  it("names the role and the team for each of the four roles", async () => {
    for (const [role, title] of [
      ["captain", "captain"],
      ["vice_captain", "vice-captain"],
      ["icon", "icon player"],
      ["retained", "retained player"],
    ] as const) {
      expect((await appointmentMail({ ...base, roles: [role] })).subject).toBe(
        `You're the ${title} of Cup Kings`,
      );
    }
  });

  it("tells a captain, an icon and a retained player they skip the auction", async () => {
    for (const role of ["captain", "icon", "retained"] as const) {
      expect((await appointmentMail({ ...base, roles: [role] })).text).toContain(
        "without going through the auction",
      );
    }
  });

  it("never says so to a vice-captain, who still goes under the hammer", async () => {
    expect((await appointmentMail({ ...base, roles: ["vice_captain"] })).text).not.toContain(
      "without going through the auction",
    );
  });

  it("never says so to a captain the auction bought", async () => {
    const mail = await appointmentMail({ ...base, roles: ["captain"], bought: true });
    expect(mail.subject).toBe("You're the captain of Cup Kings");
    expect(mail.text).not.toContain("without going through the auction");
  });

  it("one email for a captain who is also the icon, captain first", async () => {
    const mail = await appointmentMail({ ...base, roles: ["icon", "captain"] });
    expect(mail.subject).toBe("You're the captain and icon player of Cup Kings");
    expect(mail.text).toContain("You'll lead the side");
    expect(mail.text).toContain("marquee names");
    expect(mail.text.match(/without going through the auction/g)).toHaveLength(1);
  });

  it("joins three roles the way a person would say them", () => {
    expect(rolesTitle(["retained", "icon", "captain"])).toBe(
      "captain, icon player and retained player",
    );
  });
});

describe("the owner's night", () => {
  it("lists the squad, the spend and the purse left, and names a shortfall", async () => {
    const mail = await ownerSummaryMail({
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

describe("the squad sheet", () => {
  const facts = {
    name: "Arjun",
    season: "MPL 2026",
    orgName: "Malad CC",
    teamName: "Cup Kings",
    squad: [
      { name: "Vikram Patel", note: "Captain" },
      { name: "Arjun Sharma (you)", note: "Player" },
    ],
    coach: "Ravi Shastri",
    firstMatch: "vs Tigers · Sun, 4 Oct 2026, 7:30 am · Malad Ground",
  };

  it("names the team, the whole squad with the reader marked, the coach and the first match", async () => {
    const mail = await squadSheetMail(facts);
    expect(mail.subject).toBe("Meet your Cup Kings squad");
    expect(mail.text).toContain("Arjun Sharma (you)");
    expect(mail.text).toContain("Vikram Patel");
    expect(mail.text).toContain("Ravi Shastri");
    expect(mail.text).toContain("Your first match: vs Tigers");
  });

  it("promises fixtures rather than inventing one, and leaves out a coach nobody named", async () => {
    const mail = await squadSheetMail({ ...facts, coach: null, firstMatch: null });
    expect(mail.text).toContain("will share the fixtures soon");
    expect(mail.text).not.toContain("Coach");
  });
});

describe("the SMS words", () => {
  it("fits every combination of roles into one DLT variable", () => {
    const all = ["captain", "vice_captain", "icon", "retained"] as const;
    for (let mask = 1; mask < 16; mask += 1) {
      const roles = all.filter((_, index) => (mask >> index) & 1);
      expect(smsRolePhrase(roles).length, roles.join("+")).toBeLessThanOrEqual(DLT_VAR_MAX);
    }
  });

  it("says the whole thing when it fits, and shortens only when it must", () => {
    expect(smsRolePhrase(["icon", "captain"])).toBe("captain and icon player");
    expect(smsRolePhrase(["icon", "retained"])).toBe("icon and retained");
    expect(smsRolePhrase(["retained"])).toBe("retained player");
  });

  it("writes a price without the rupee sign, which is not GSM-7", () => {
    expect(smsPrice("₹75,000")).toBe("Rs 75,000");
    expect(smsPrice("₹1,99,00,000")).toBe("Rs 1,99,00,000");
  });
});

describe("the lineup", () => {
  const facts = {
    name: "Arjun",
    season: "MPL 2026",
    teamName: "Cup Kings",
    opponent: "Tigers",
    when: "Sun, 4 Oct 2026, 7:30 am",
    where: "Malad Ground",
    lineup: [
      { name: "Vikram Patel", note: "Captain" },
      { name: "Arjun Sharma (you)", note: "Player" },
    ],
  };

  it("names the team, the opponent, when and where, and the whole lineup", async () => {
    const mail = await lineupMail(facts);
    expect(mail.subject).toBe("You're in the Cup Kings lineup vs Tigers");
    expect(mail.text).toContain("Sun, 4 Oct 2026, 7:30 am at Malad Ground");
    expect(mail.text).toContain("Arjun Sharma (you)");
  });

  it("says lineup, never XI — a kabaddi side is seven", async () => {
    expect((await lineupMail(facts)).text).not.toMatch(/\bXI\b/);
  });

  it("leaves the ground out when the fixture has none", async () => {
    expect((await lineupMail({ ...facts, where: null })).text).not.toContain(" at ");
  });
});

describe("the registration decisions, by email", () => {
  it("says the decision in the subject — most people read nothing else", async () => {
    const facts = { name: "Arjun", season: "Malad Premier League 2026" };
    expect((await registrationDecisionMail({ ...facts, decision: "approve" })).subject).toBe(
      "You're approved for Malad Premier League 2026",
    );
    expect((await registrationDecisionMail({ ...facts, decision: "waitlist" })).subject).toContain(
      "waitlist",
    );
    const rejected = await registrationDecisionMail({
      ...facts,
      decision: "reject",
      reason: "the season is full",
    });
    expect(rejected.subject).toContain("wasn't approved");
    expect(rejected.text).toContain("The reason given: the season is full.");
    expect(rejected.text).toContain('Switch off "Registration decisions"');
  });
});

/** Every layout mail has its HTML part; the nudge helpers take both parts. */
function parts(mail: NotificationMail): { text: string; html: string } {
  return { text: mail.text, html: mail.html ?? "" };
}

describe("THE WHATSAPP NUDGE — decided at send time", () => {
  let personal: { text: string; html: string }[] = [];
  beforeAll(async () => {
    personal = [
      await soldMail(sale),
      await appointmentMail({
        name: "Vikram",
        season: "MPL 2026",
        orgName: "Malad CC",
        teamName: "Cup Kings",
        roles: ["captain"],
        bought: false,
      }),
      await lineupMail({
        name: "Arjun",
        season: "MPL 2026",
        teamName: "Cup Kings",
        opponent: "Tigers",
        when: "Sun, 4 Oct 2026, 7:30 pm",
        where: null,
        lineup: [],
      }),
      await registrationDecisionMail({ name: "Arjun", season: "MPL 2026", decision: "approve" }),
    ].map(parts);
  });

  it("leaves room for it under every personal moment, and shows nothing until asked", () => {
    for (const mail of personal) {
      expect(hasWhatsAppNudge(mail.html)).toBe(true);
      expect(mail.text).not.toContain("WhatsApp");
      expect(applyWhatsAppNudge(mail, false)).toEqual({ text: mail.text, html: mail.html });
    }
  });

  it("fills it with one line linking to the switch on /account", () => {
    for (const mail of personal) {
      const nudged = applyWhatsAppNudge(mail, true);
      expect(nudged.html).toContain("Get these on WhatsApp");
      expect(nudged.html).toContain("/account#whatsapp");
      expect(nudged.text).toMatch(
        /Get these on WhatsApp — turn it on in your account: \S+\/account#whatsapp\n\n—\n/,
      );
    }
  });

  it("NEVER touches a security mail, whatever the drain asks", async () => {
    for (const mail of [
      parts(await emailChangedCopy("new@example.com")),
      parts(await phoneChangedCopy("4321")),
    ]) {
      expect(hasWhatsAppNudge(mail.html)).toBe(false);
      expect(applyWhatsAppNudge(mail, true)).toEqual({ text: mail.text, html: mail.html });
    }
  });
});
