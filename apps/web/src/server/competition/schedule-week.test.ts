import { describe, expect, it } from "vitest";

import { focusStart, isWallDate, weekStrip } from "./schedule-week";

describe("isWallDate", () => {
  it("accepts real calendar dates only", () => {
    expect(isWallDate("2026-09-27")).toBe(true);
    expect(isWallDate("2026-02-30")).toBe(false);
    expect(isWallDate("27-09-2026")).toBe(false);
    expect(isWallDate(undefined)).toBe(false);
  });
});

describe("focusStart", () => {
  const today = "2026-09-27"; // a Sunday — the case a Monday-to-Sunday week got wrong

  it("opens on the day asked for", () => {
    expect(focusStart({ requested: "2026-10-13", today, days: [] })).toBe("2026-10-13");
  });

  it("ignores a malformed request", () => {
    expect(focusStart({ requested: "soon", today, days: [{ date: "2026-09-28" }] })).toBe(
      "2026-09-25",
    );
  });

  it("opens two days back when the days around today have a match — tomorrow included", () => {
    expect(focusStart({ requested: undefined, today, days: [{ date: "2026-09-28" }] })).toBe(
      "2026-09-25",
    );
    expect(focusStart({ requested: undefined, today, days: [{ date: "2026-09-25" }] })).toBe(
      "2026-09-25",
    );
  });

  it("else on the next match to come", () => {
    expect(
      focusStart({
        requested: undefined,
        today,
        days: [{ date: "2026-09-20" }, { date: "2026-10-04" }],
      }),
    ).toBe("2026-10-04");
  });

  it("else closing on the last match, for a finished season", () => {
    expect(
      focusStart({
        requested: undefined,
        today,
        days: [{ date: "2026-08-01" }, { date: "2026-08-03" }],
      }),
    ).toBe("2026-07-28");
  });

  it("else around today", () => {
    expect(focusStart({ requested: undefined, today, days: [] })).toBe("2026-09-25");
  });
});

describe("weekStrip", () => {
  it("draws all seven days and steps to the match days either side", () => {
    const strip = weekStrip("2026-09-25", [
      { date: "2026-09-10", count: 2, live: 0 },
      { date: "2026-09-27", count: 2, live: 1 },
      { date: "2026-10-01", count: 1, live: 0 },
      { date: "2026-10-20", count: 1, live: 0 },
    ]);
    expect(strip.days).toHaveLength(7);
    expect(strip.days[2]).toEqual({ date: "2026-09-27", count: 2, live: 1 });
    expect(strip.days[0]).toEqual({ date: "2026-09-25", count: 0, live: 0 });
    // Earlier: the window that CLOSES on 10 Sep.
    expect(strip.earlier).toBe("2026-09-04");
    // Later: the window that OPENS on 20 Oct.
    expect(strip.later).toBe("2026-10-20");
  });

  it("has no step past either end", () => {
    const strip = weekStrip("2026-09-21", [{ date: "2026-09-23", count: 1, live: 0 }]);
    expect(strip.earlier).toBeNull();
    expect(strip.later).toBeNull();
  });
});
