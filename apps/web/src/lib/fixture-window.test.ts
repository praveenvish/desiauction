import { describe, expect, it } from "vitest";

import { outsideWindowMessage } from "./fixture-window";

describe("outsideWindowMessage", () => {
  it("says how many match days are needed and how to fit them", () => {
    const text = outsideWindowMessage({
      startsOn: "2026-09-19",
      endsOn: "2026-09-21",
      firstDate: "2026-09-19",
      lastDate: "2026-09-24",
      daysNeeded: 6,
      perDay: 1,
    });
    expect(text).toContain("6 match days (1 match a day)");
    expect(text).toContain("19 Sept – 21 Sept");
    expect(text).toContain("Add more kickoff times");
  });

  it("points at the start date when the plan begins before the season", () => {
    const text = outsideWindowMessage({
      startsOn: "2026-09-19",
      endsOn: "2026-09-30",
      firstDate: "2026-09-10",
      lastDate: "2026-09-15",
      daysNeeded: 6,
      perDay: 1,
    });
    expect(text).toContain("before the season begins");
    expect(text).toContain("on or after 19 Sept");
  });

  it("says the start is after the season when the whole plan misses it", () => {
    const text = outsideWindowMessage({
      startsOn: "2026-08-01",
      endsOn: "2026-09-15",
      firstDate: "2026-10-01",
      lastDate: "2026-10-01",
      daysNeeded: 1,
      perDay: 1,
    });
    expect(text).toContain("after the season ends");
    expect(text).toContain("inside the season");
  });
});
