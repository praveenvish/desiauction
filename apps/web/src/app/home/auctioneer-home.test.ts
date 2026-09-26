import { describe, expect, it } from "vitest";

import { nightDate } from "./auctioneer-home";

// 25 Sep 2026, midday in India.
const NOW = new Date("2026-09-25T06:30:00Z");

describe("nightDate — the queue says the season's dates, as /auctions does", () => {
  it("a season still to come says when it starts", () => {
    expect(nightDate("2026-10-03", false, NOW)).toBe("Season starts 3 Oct");
  });

  it("a date in another year carries its year", () => {
    expect(nightDate("2027-01-12T18:30", false, NOW)).toBe("Season starts 12 Jan 2027");
  });

  it("a season under way says it began — not that a night's date passed", () => {
    // /auctions prints this season as "1 Aug – 31 Oct 2026": both must agree.
    expect(nightDate("2026-08-01", false, NOW)).toBe("Season began 1 Aug");
  });

  it("a finished night keeps its plain date — the past is where it belongs", () => {
    expect(nightDate("2026-08-01", true, NOW)).toBe("1 Aug");
    expect(nightDate("2025-08-01", true, NOW)).toBe("1 Aug 2025");
  });

  it("no date, or a garbled one, is null", () => {
    expect(nightDate(null, false, NOW)).toBeNull();
    expect(nightDate("not-a-date", false, NOW)).toBeNull();
  });
});
