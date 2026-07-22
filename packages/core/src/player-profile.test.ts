import { describe, expect, it } from "vitest";

import {
  BATTING_STYLES,
  BOWLING_STYLES,
  deriveAge,
  isBattingStyle,
  isBowlingStyle,
} from "./player-profile";

describe("player-profile styles", () => {
  it("recognizes known batting/bowling styles and rejects others", () => {
    expect(isBattingStyle("right_hand")).toBe(true);
    expect(isBattingStyle("switch_hit")).toBe(false);
    expect(isBowlingStyle("leg_break")).toBe(true);
    expect(isBowlingStyle("underarm")).toBe(false);
  });

  it("has no overlapping keys between batting and bowling", () => {
    const overlap = BATTING_STYLES.filter((s) => (BOWLING_STYLES as readonly string[]).includes(s));
    expect(overlap).toEqual([]);
  });
});

describe("deriveAge", () => {
  const now = new Date(Date.UTC(2026, 6, 22)); // 2026-07-22

  it("returns completed years", () => {
    expect(deriveAge("2000-07-22", now)).toBe(26);
    expect(deriveAge("2000-01-01", now)).toBe(26);
  });

  it("subtracts a year when the birthday hasn't occurred yet this year", () => {
    expect(deriveAge("2000-07-23", now)).toBe(25);
    expect(deriveAge("2000-12-31", now)).toBe(25);
  });

  it("returns null for absent, malformed, impossible, or future dates", () => {
    expect(deriveAge(null, now)).toBeNull();
    expect(deriveAge("22-07-2000", now)).toBeNull();
    expect(deriveAge("2020-13-40", now)).toBeNull();
    expect(deriveAge("2027-01-01", now)).toBeNull();
  });
});
