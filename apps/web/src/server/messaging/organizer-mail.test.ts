import { describe, expect, it } from "vitest";

import { istClock } from "../competition/registration-digest";
import {
  clubWelcomeMail,
  organizerJourney,
  registrationDigestMail,
  seasonHeldMail,
  seasonReleasedMail,
} from "./organizer-mail";

const season = {
  season: "Malad Premier League 2026",
  orgName: "Malad Cricket Club",
  seasonSlug: "mpl-2026-x7k2",
  sport: "cricket",
};

describe("the club welcome", () => {
  it("opens with the club, shows the organizer's steps, and links the club", async () => {
    const mail = await clubWelcomeMail(
      { name: "Priya", orgName: "Malad Cricket Club", orgSlug: "malad-cc-9f2a" },
      "en",
    );
    expect(mail.subject).toBe("Malad Cricket Club is ready on DesiAuction");
    expect(mail.text.split("\n")[0]).toBe("Malad Cricket Club · A club on DesiAuction");
    expect(mail.text).toContain("✓ Club → ● Season → ○ Players → ○ Auction");
    expect(mail.text).toContain("  1 · Add a season: Name and dates");
    expect(mail.text).toContain("/org/malad-cc-9f2a");
  });

  it("says it in Hindi too", async () => {
    const mail = await clubWelcomeMail(
      { name: "प्रिया", orgName: "Malad Cricket Club", orgSlug: "malad-cc-9f2a" },
      "hi",
    );
    expect(mail.html).toContain(`<html lang="hi"`);
    expect(mail.text).toContain("✓ क्लब → ● सीज़न");
  });
});

describe("the 9 am digest", () => {
  const one = { ...season, waiting: 1, oldestDays: 0 };

  it("counts in the subject, singular and plural, and links a lone season's queue", async () => {
    const single = await registrationDigestMail({ name: "Priya", seasons: [one] }, "en");
    expect(single.subject).toBe("1 registration waiting for your review");
    expect(single.text).toContain("Malad Premier League 2026: 1 waiting · today");
    expect(single.text).toContain("/seasons/mpl-2026-x7k2/registrations?status=submitted");
    const many = await registrationDigestMail(
      {
        name: "Priya",
        seasons: [
          { ...one, waiting: 9, oldestDays: 3 },
          { ...one, season: "Under-19 Cup", seasonSlug: "u19", waiting: 3, oldestDays: 1 },
        ],
      },
      "en",
    );
    expect(many.subject).toBe("12 registrations waiting for your review");
    expect(many.text).toContain("9 waiting · 3 days");
    expect(many.text).toContain("3 waiting · 1 day");
    // Several seasons: home, which lists them all.
    expect(many.text).toMatch(/Review registrations: https?:\/\/[^/]+\/home/);
  });

  it("names the club when the seasons belong to more than one", async () => {
    const mail = await registrationDigestMail(
      {
        name: "Priya",
        seasons: [one, { ...one, season: "Thane Cup", orgName: "Thane XI", seasonSlug: "thane" }],
      },
      "en",
    );
    expect(mail.text).toContain("Thane Cup (Thane XI)");
  });

  it("runs from 9 to noon IST, and names the IST day", () => {
    expect(istClock(new Date("2026-09-28T03:29:00Z"))).toEqual({ date: "2026-09-28", hour: 8 });
    expect(istClock(new Date("2026-09-28T03:30:00Z")).hour).toBe(9);
    // 11:00 pm UTC is 4:30 am the next day in IST.
    expect(istClock(new Date("2026-09-28T23:00:00Z"))).toEqual({ date: "2026-09-29", hour: 4 });
  });
});

describe("a moderation hold", () => {
  it("gives the reason, boxes the way back, and offers no switch", async () => {
    const mail = await seasonHeldMail(
      { ...season, name: "Priya", reason: "the page used another club's logo" },
      "en",
    );
    expect(mail.subject).toBe("Malad Premier League 2026 has been taken off public view");
    expect(mail.text).toContain("The reason: the page used another club's logo");
    expect(mail.html).toContain('class="da-notice"');
    expect(mail.text).not.toContain("Manage emails");
  });

  it("says when the page is theirs again", async () => {
    const mail = await seasonReleasedMail({ ...season, name: "Priya" }, "en");
    expect(mail.subject).toBe("Malad Premier League 2026 can go public again");
    expect(mail.text).toContain("/seasons/mpl-2026-x7k2");
  });
});

describe("the organizer's tracker", () => {
  it("marks the steps behind as done", () => {
    expect(organizerJourney(2, "en").map((step) => step.state)).toEqual([
      "done",
      "done",
      "now",
      "next",
    ]);
  });
});
