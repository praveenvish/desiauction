import { describe, expect, it } from "vitest";

import { PROFILE_ITEMS, profileCompleteness } from "./profile-completeness";

const EMPTY = {
  name: null,
  photoUrl: null,
  emailVerified: false,
  dateOfBirth: null,
  location: null,
  defaultRole: null,
  defaultBattingStyle: null,
  defaultBowlingStyle: null,
  passkeyCount: 0,
};

describe("profileCompleteness (PI-1)", () => {
  it("a blank account is 0 of 8, with every item missing in list order", () => {
    const result = profileCompleteness(EMPTY);
    expect(result.done).toBe(0);
    expect(result.total).toBe(8);
    expect(result.score).toBe(0);
    expect(result.missing).toEqual([...PROFILE_ITEMS]);
  });

  it("a filled account is complete", () => {
    const result = profileCompleteness({
      name: "Asha",
      photoUrl: "org/x/player/y/z.jpg",
      emailVerified: true,
      dateOfBirth: "1998-03-11",
      location: "Kolkata",
      defaultRole: "bowler",
      defaultBattingStyle: null,
      defaultBowlingStyle: "left_arm_orthodox",
      passkeyCount: 2,
    });
    expect(result).toEqual({ done: 8, total: 8, score: 1, missing: [] });
  });

  it("either style satisfies the style item — a specialist owes nobody the other", () => {
    expect(
      profileCompleteness({ ...EMPTY, defaultBattingStyle: "right_hand" }).missing,
    ).not.toContain("style");
    expect(
      profileCompleteness({ ...EMPTY, defaultBowlingStyle: "off_break" }).missing,
    ).not.toContain("style");
  });

  it("whitespace is absence, not an answer", () => {
    const result = profileCompleteness({ ...EMPTY, name: "   ", location: " " });
    expect(result.missing).toContain("name");
    expect(result.missing).toContain("location");
  });

  it("gender never appears — optional-always must not be nagged into mandatory", () => {
    expect(PROFILE_ITEMS).not.toContain("gender" as never);
  });
});
