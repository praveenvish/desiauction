import { describe, expect, it } from "vitest";

import { ownerInviteMail, ownersReadyMail } from "./owner-mail";

const season = {
  season: "Malad Premier League 2026",
  orgName: "Malad Cricket Club",
  seasonSlug: "mpl-2026",
  sport: "cricket",
};
const AT = new Date("2026-10-04T14:30:00Z");

describe("the owner's invitation", () => {
  it("names the team and the club, carries the link, and boxes the warning", async () => {
    const mail = await ownerInviteMail(
      {
        ...season,
        teamName: "Cup Kings",
        inviterName: "Priya Shah",
        acceptUrl: "https://desiauction.in/owner-join/abcdefghijklmnopqrstuvwx",
        auctionAt: AT,
      },
      "en",
    );
    expect(mail.subject).toBe("Malad Cricket Club invites you to own Cup Kings");
    expect(mail.text).toContain("Priya Shah from Malad Cricket Club has invited you");
    expect(mail.text).toContain(
      "Accept the invitation: https://desiauction.in/owner-join/abcdefghijklmnopqrstuvwx",
    );
    expect(mail.text).toContain("SUN 4 OCT");
    expect(mail.html).toContain('class="da-notice"');
    // No switch: the reader may have no account yet.
    expect(mail.text).not.toContain("Manage emails");
  });

  it("leaves the date out when the auction has no time yet", async () => {
    const mail = await ownerInviteMail(
      {
        ...season,
        teamName: "Cup Kings",
        inviterName: "Priya Shah",
        acceptUrl: "https://desiauction.in/owner-join/abcdefghijklmnopqrstuvwx",
        auctionAt: null,
      },
      "hi",
    );
    expect(mail.html).not.toContain('class="da-leaf"');
    expect(mail.html).toContain(`<html lang="hi"`);
  });
});

describe("every team has its owner", () => {
  const owners = [
    ["Cup Kings", "Rahul Mehta"],
    ["Tigers", "Sana Iqbal"],
  ] as const;

  it("lists who bids for whom and nudges for a time when none is set", async () => {
    const mail = await ownersReadyMail(
      { ...season, name: "Priya", owners, roomUrl: "https://desiauction.in/x", auctionAt: null },
      "en",
    );
    expect(mail.subject).toBe("All 2 owners are in for Malad Premier League 2026");
    expect(mail.text).toContain("  Cup Kings: Rahul Mehta");
    expect(mail.text).toContain("Auction night doesn't have a time yet.");
    expect(mail.text).toContain("✓ Club → ✓ Season → ✓ Players → ● Auction");
  });

  it("shows the date instead, once there is one", async () => {
    const mail = await ownersReadyMail(
      { ...season, name: "Priya", owners, roomUrl: "https://desiauction.in/x", auctionAt: AT },
      "en",
    );
    expect(mail.text).not.toContain("doesn't have a time yet");
    expect(mail.text).toContain("SUN 4 OCT");
  });
});
