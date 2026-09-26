import { describe, expect, it } from "vitest";

import {
  dateTile,
  formatDate,
  formatDateRange,
  formatDateTime,
  formatDayDate,
  formatMonthYear,
  formatShortDate,
  istCalendarDate,
  relativeAge,
} from "./format-date";

// 2026-09-19 20:10 UTC = 20 Sep 2026, 1:40 am IST.
const LATE = Date.UTC(2026, 8, 19, 20, 10);

describe("the one date grammar", () => {
  it("prints September as three letters like every other month", () => {
    expect(formatDate("2026-09-19")).toBe("19 Sep 2026");
    expect(formatShortDate("2026-09-19")).toBe("19 Sep");
  });

  it("reads instants in IST and calendar dates as written", () => {
    expect(formatDate(LATE)).toBe("20 Sep 2026");
    expect(formatDateTime(LATE)).toBe("20 Sep 2026, 1:40 am");
    expect(istCalendarDate(LATE)).toBe("2026-09-20");
    expect(formatDate("2026-08-01")).toBe("1 Aug 2026");
  });

  it("says a range with the year once", () => {
    expect(formatDateRange("2026-08-01", "2026-10-31")).toBe("1 Aug – 31 Oct 2026");
    expect(formatDateRange("2026-12-15", "2027-01-10")).toBe("15 Dec 2026 – 10 Jan 2027");
    expect(formatDateRange("2026-08-01", null)).toBe("1 Aug 2026");
    expect(formatDateRange(null, null)).toBe("Dates to be announced");
  });

  it("has a weekday form, a month form and a tile", () => {
    expect(formatDayDate("2026-09-19")).toBe("Sat, 19 Sep");
    expect(formatDayDate("2026-09-19", true)).toBe("Sat, 19 Sep 2026");
    expect(formatMonthYear("2021-01-04")).toBe("Jan 2021");
    expect(dateTile("2026-10-04")).toEqual({ day: "4", month: "Oct" });
  });

  it("floors past ages and dates anything older than a month", () => {
    const now = Date.UTC(2026, 8, 26, 12);
    expect(relativeAge(now - (7 * 24 + 14) * 3_600_000, now)).toBe("7d ago");
    expect(relativeAge(Date.UTC(2026, 6, 1, 12), now)).toBe("1 Jul 2026");
  });
});
