import { describe, expect, it } from "vitest";

import { nightDate } from "./auctioneer-home";

// 25 Sep 2026, midday in India.
const NOW = new Date("2026-09-25T06:30:00Z");

describe("nightDate — an auctioneer's queue says which night, and whether it has gone", () => {
  it("a coming night this year is just the day and month", () => {
    expect(nightDate("2026-10-03", false, NOW)).toBe("3 Oct");
  });

  it("a night in another year carries its year", () => {
    expect(nightDate("2027-01-12T18:30", false, NOW)).toBe("12 Jan 2027");
  });

  it("a past date on a night that has not happened is said plainly, with the year", () => {
    expect(nightDate("2026-08-01", false, NOW)).toBe(
      "Date passed · 1 Aug 2026 — check with the organizer",
    );
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
