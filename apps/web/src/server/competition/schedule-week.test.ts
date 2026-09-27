import { describe, expect, it } from "vitest";

import { focusWeek, isWallDate, mondayOf, weekStrip } from "./schedule-week";

describe("mondayOf", () => {
  it("returns the Monday on or before a date, Sunday belonging to the week before", () => {
    expect(mondayOf("2026-09-28")).toBe("2026-09-28"); // Monday
    expect(mondayOf("2026-09-27")).toBe("2026-09-21"); // Sunday
    expect(mondayOf("2026-10-01")).toBe("2026-09-28"); // Thursday
    expect(mondayOf("2026-08-01")).toBe("2026-07-27"); // Saturday, across a month
  });
});

describe("isWallDate", () => {
  it("accepts real calendar dates only", () => {
    expect(isWallDate("2026-09-27")).toBe(true);
    expect(isWallDate("2026-02-30")).toBe(false);
    expect(isWallDate("27-09-2026")).toBe(false);
    expect(isWallDate(undefined)).toBe(false);
  });
});

describe("focusWeek", () => {
  const today = "2026-09-27"; // a Sunday
  const days = [{ date: "2026-09-20" }, { date: "2026-10-04" }, { date: "2026-10-12" }];

  it("honours the week asked for", () => {
    expect(focusWeek({ requested: "2026-10-13", today, days })).toBe("2026-10-12");
  });

  it("ignores a malformed request", () => {
    expect(focusWeek({ requested: "soon", today, days: [{ date: "2026-09-24" }] })).toBe(
      "2026-09-21",
    );
  });

  it("opens on this week when it has a match", () => {
    expect(focusWeek({ requested: undefined, today, days: [{ date: "2026-09-22" }] })).toBe(
      "2026-09-21",
    );
  });

  it("else on the week of the next match", () => {
    expect(focusWeek({ requested: undefined, today, days })).toBe("2026-09-28");
  });

  it("else on the week of the last match, for a finished season", () => {
    expect(
      focusWeek({ requested: undefined, today, days: [{ date: "2026-08-01" }, { date: "2026-08-03" }] }),
    ).toBe("2026-08-03");
  });

  it("else on this week", () => {
    expect(focusWeek({ requested: undefined, today, days: [] })).toBe("2026-09-21");
  });
});

describe("weekStrip", () => {
  it("draws all seven days and the nearest match day either side", () => {
    const strip = weekStrip("2026-09-21", [
      { date: "2026-09-10", count: 2, live: 0 },
      { date: "2026-09-27", count: 2, live: 1 },
      { date: "2026-10-04", count: 1, live: 0 },
      { date: "2026-10-20", count: 1, live: 0 },
    ]);
    expect(strip.days).toHaveLength(7);
    expect(strip.days[6]).toEqual({ date: "2026-09-27", count: 2, live: 1 });
    expect(strip.days[0]).toEqual({ date: "2026-09-21", count: 0, live: 0 });
    expect(strip.earlier).toBe("2026-09-10");
    expect(strip.later).toBe("2026-10-04");
  });

  it("has no step past either end", () => {
    const strip = weekStrip("2026-09-21", [{ date: "2026-09-23", count: 1, live: 0 }]);
    expect(strip.earlier).toBeNull();
    expect(strip.later).toBeNull();
  });
});
