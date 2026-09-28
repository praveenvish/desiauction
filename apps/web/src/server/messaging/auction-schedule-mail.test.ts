import { describe, expect, it } from "vitest";

import { auctionDateLeaf, auctionScheduleMail } from "./auction-schedule-mail";

const AT = new Date("2026-10-04T14:30:00Z"); // Sun 4 Oct 2026, 8:00 pm IST
const base = {
  name: "Arjun",
  season: "Malad Premier League 2026",
  orgName: "Malad Cricket Club",
  seasonSlug: "mpl-2026",
  sport: "cricket",
  url: "https://desiauction.in/seasons/mpl-2026/register",
};

describe("the date tile", () => {
  it("names the day in IST, in the reader's language", () => {
    expect(auctionDateLeaf(AT, "MPL 2026", "en")).toEqual({
      month: "OCT",
      day: "4",
      weekday: "SUN",
      title: "MPL 2026 auction",
      detail: "8:00 pm IST",
    });
    expect(auctionDateLeaf(AT, "MPL 2026", "hi")).toMatchObject({
      month: "अक्टू॰",
      weekday: "रवि",
      title: "MPL 2026 की नीलामी",
    });
  });
});

describe("auction night set, moved, cleared", () => {
  it("puts the time in the subject and shows the tile", async () => {
    const mail = await auctionScheduleMail(
      { ...base, change: "set", at: AT, previous: null, teamName: null },
      "en",
    );
    expect(mail.subject).toBe("Malad Premier League 2026 auction: Sun 4 Oct, 8:00 pm IST");
    expect(mail.text).toContain("SUN 4 OCT — Malad Premier League 2026 auction, 8:00 pm IST");
    expect(mail.text).toContain("You're in the player pool.");
    expect(mail.text).not.toContain("You're bidding for");
  });

  it("tells an owner their team, and says what it moved from", async () => {
    const mail = await auctionScheduleMail(
      {
        ...base,
        change: "moved",
        at: AT,
        previous: new Date("2026-10-03T13:30:00Z"),
        teamName: "Cup Kings",
      },
      "en",
    );
    expect(mail.subject).toBe(
      "New time: the Malad Premier League 2026 auction is now Sun 4 Oct, 8:00 pm IST",
    );
    expect(mail.text).toContain("It was Sat 3 Oct, 7:00 pm IST; it's now Sun 4 Oct, 8:00 pm IST.");
    expect(mail.text).toContain("You're bidding for Cup Kings.");
    expect(mail.text).not.toContain("player pool");
  });

  it("says a cleared time plainly, with no tile", async () => {
    const mail = await auctionScheduleMail(
      { ...base, change: "cleared", at: null, previous: AT, teamName: null },
      "en",
    );
    expect(mail.subject).toBe("Malad Premier League 2026 auction: new time to follow");
    // The dark-mode rule names the class; the tile itself is absent.
    expect(mail.html).not.toContain('class="da-leaf"');
  });
});
