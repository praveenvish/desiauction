import { describe, expect, it } from "vitest";

import { ageLabel, istTime, istWhen } from "./use-polled";

// 2026-09-18 13:23 UTC = 18:53 IST.
const TONIGHT = Date.UTC(2026, 8, 18, 13, 23);

describe("live-surface time labels", () => {
  it("names the zone, and the day only when it is not today", () => {
    expect(istTime(TONIGHT)).toBe("18:53 IST");
    expect(istWhen(TONIGHT, TONIGHT + 60_000)).toBe("18:53 IST");
    // ICU versions disagree on "Sep" vs "Sept"; the shape is what matters.
    expect(istWhen(TONIGHT - 5 * 86_400_000, TONIGHT)).toMatch(/^13 Sept?, 18:53 IST$/);
  });

  it("shortens an age to its largest honest unit", () => {
    expect(ageLabel(-5_000)).toBe("0s");
    expect(ageLabel(42_000)).toBe("42s");
    expect(ageLabel(4 * 60_000)).toBe("4m");
    expect(ageLabel(3 * 3_600_000)).toBe("3h");
    expect(ageLabel(5 * 86_400_000)).toBe("5d");
  });
});
