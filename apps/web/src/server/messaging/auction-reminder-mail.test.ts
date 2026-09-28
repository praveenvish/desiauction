import { describe, expect, it } from "vitest";

import { auctionReminderMail, readinessGap } from "./auction-reminder-mail";

const base = {
  name: "Rahul",
  season: "Malad Premier League 2026",
  orgName: "Malad Cricket Club",
  seasonSlug: "mpl-2026",
  sport: "cricket",
  at: new Date("2026-10-04T14:30:00Z"),
  url: "https://desiauction.in/seasons/mpl-2026/auction",
};

describe("the day before auction night", () => {
  it("tells an owner their team, and whether their paddle is ready", async () => {
    const ready = await auctionReminderMail(
      { ...base, role: "owner", teamName: "Cup Kings", hasPaddle: true },
      "en",
    );
    expect(ready.subject).toBe(
      "Tomorrow: the Malad Premier League 2026 auction, Sun 4 Oct, 8:00 pm IST",
    );
    expect(ready.text).toContain("You're bidding for Cup Kings");
    expect(ready.text).toContain("  Your paddle: Ready");
    const waiting = await auctionReminderMail(
      { ...base, role: "owner", teamName: "Cup Kings", hasPaddle: false },
      "en",
    );
    expect(waiting.text).toContain("  Your paddle: Not granted yet — ask the organizer");
  });

  it("tells a player when, and where to watch", async () => {
    const mail = await auctionReminderMail({ ...base, role: "player" }, "hi");
    expect(mail.html).toContain(`<html lang="hi"`);
    expect(mail.text).toContain("लाइव देखें");
    expect(mail.text).not.toContain("पैडल");
  });

  it("gives an organizer the room's readiness and the one thing to do", async () => {
    const mail = await auctionReminderMail(
      {
        ...base,
        role: "organizer",
        readiness: { auctionCreated: true, teams: 8, owned: 6, paddles: 5, pool: 43 },
      },
      "en",
    );
    expect(mail.subject).toBe("Tomorrow: is the Malad Premier League 2026 auction ready?");
    expect(mail.text).toContain("  Team owners in: 6 of 8");
    expect(mail.text).toContain("  Paddles granted: 5 of 8");
    expect(mail.text).toContain("2 owners haven't joined yet");
  });
});

describe("the readiness gap names the first thing missing", () => {
  const room = { auctionCreated: true, teams: 4, owned: 4, paddles: 4, pool: 20 };
  it("in order: the auction, then owners, then paddles", () => {
    expect(readinessGap({ ...room, auctionCreated: false }, "en")).toContain("isn't created yet");
    expect(readinessGap({ ...room, owned: 3 }, "en")).toBe(
      "1 owner hasn't joined yet — resend their links from the auction page.",
    );
    expect(readinessGap({ ...room, paddles: 2 }, "en")).toContain("2 paddles are still to grant");
    expect(readinessGap(room, "en")).toContain("you're ready for tomorrow");
  });
});
