import { describe, expect, it } from "vitest";

import {
  BATTING_STYLES,
  BOWLING_STYLES,
  PLAYER_ROLES,
  deriveAge,
  genderLabel,
  isBattingStyle,
  isBowlingStyle,
  isGender,
  isMinor,
  parseRole,
  roleLabel,
  validateDateOfBirth,
  validateJerseyNumber,
  validateProfileLocation,
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

describe("isMinor (PRR P0-2 / DPDP §9)", () => {
  const now = new Date(Date.UTC(2026, 6, 22)); // 2026-07-22

  it("is true below 18 and false at or above 18", () => {
    expect(isMinor("2009-07-21", now)).toBe(true); // just turned 17
    expect(isMinor("2008-07-23", now)).toBe(true); // turns 18 tomorrow
    expect(isMinor("2008-07-22", now)).toBe(false); // 18 exactly today
    expect(isMinor("2000-01-01", now)).toBe(false);
  });

  it("does NOT treat an unknown or unparseable date of birth as a minor", () => {
    // The gate cannot assert an age it does not have; a registrant with no DOB
    // has no age published anyway, so there is nothing to suppress.
    expect(isMinor(null, now)).toBe(false);
    expect(isMinor("", now)).toBe(false);
    expect(isMinor("not-a-date", now)).toBe(false);
  });
});

describe("parseRole — the vocabulary a registration form is actually filled in with", () => {
  it("round-trips every canonical role and its own label", () => {
    for (const role of PLAYER_ROLES) {
      expect(parseRole(role)).toBe(role);
      expect(parseRole(roleLabel(role))).toBe(role);
    }
  });

  /*
   * The measured failure: a Google Form export carries these spellings, every
   * row errored on a bare enum match, and the import refuses any file with
   * errors — so an ordinary sheet imported nobody at all.
   */
  it("reads the spellings a Google Form produces", () => {
    expect(parseRole("All Rounder")).toBe("all_rounder");
    expect(parseRole("all-rounder")).toBe("all_rounder");
    expect(parseRole("ALLROUNDER")).toBe("all_rounder");
    expect(parseRole("Batsman")).toBe("batter");
    expect(parseRole("Wicket Keeper")).toBe("wicket_keeper");
    expect(parseRole("Wicket-Keeper Batsman")).toBe("wicket_keeper");
    expect(parseRole("WK")).toBe("wicket_keeper");
    expect(parseRole("Bowler ")).toBe("bowler");
  });

  it("collapses a speciality to the role it is a kind of", () => {
    expect(parseRole("Leg Spinner")).toBe("bowler");
    expect(parseRole("Fast Bowler")).toBe("bowler");
    expect(parseRole("Opening Batsman")).toBe("batter");
    expect(parseRole("Middle Order")).toBe("batter");
  });

  it("returns null rather than guessing, so the caller can report the value", () => {
    for (const input of ["", "   ", "captain", "coach", "umpire", "player", "12", "all"]) {
      expect(parseRole(input)).toBeNull();
    }
  });

  /*
   * Punctuation and case are noise in a hand-filled cell; if they were not
   * fully normalized the alias table would silently need an entry per spelling
   * and would rot the first time somebody typed an underscore.
   */
  it("treats case, spacing and punctuation as noise", () => {
    for (const spelling of [
      "wicket keeper",
      "Wicket-Keeper",
      "WICKET_KEEPER",
      "  wicket   keeper  ",
      "Wicket Keeper",
    ]) {
      expect(parseRole(spelling)).toBe("wicket_keeper");
    }
  });

  it("is the same answer whichever surface asks", () => {
    // The dialog and the file share one truth (`validateNewPlayer`); a spelling
    // one accepts is a spelling the other accepts.
    for (const spelling of ["All Rounder", "Batsman", "WK", "Fast Bowler"]) {
      expect(parseRole(spelling)).toBe(parseRole(spelling.toUpperCase()));
    }
  });
});

describe("gender model (PI-1)", () => {
  it("accepts exactly the five declared values", () => {
    for (const value of ["male", "female", "non_binary", "self_described", "unspecified"]) {
      expect(isGender(value)).toBe(true);
    }
    for (const value of ["", "m", "MALE", "other", "prefer_not_to_say", "nonbinary"]) {
      expect(isGender(value)).toBe(false);
    }
  });

  it("labels a self-described answer with the person's own words", () => {
    expect(genderLabel("self_described", "Hijra")).toBe("Hijra");
    expect(genderLabel("self_described", "  ")).toBe("Self-described");
    expect(genderLabel("self_described", null)).toBe("Self-described");
  });

  it("labels the declined answer as a preference, not a value", () => {
    expect(genderLabel("unspecified")).toBe("Prefer not to say");
    expect(genderLabel("female")).toBe("Female");
  });
});

describe("validateDateOfBirth (PI-1)", () => {
  const now = new Date("2026-08-30T12:00:00Z");

  it("treats absence as valid — the field is optional everywhere", () => {
    expect(validateDateOfBirth(null, now)).toEqual({ ok: true });
    expect(validateDateOfBirth("  ", now)).toEqual({ ok: true });
  });

  it("accepts a plausible date", () => {
    expect(validateDateOfBirth("1994-02-14", now)).toEqual({ ok: true });
    expect(validateDateOfBirth("2010-12-31", now)).toEqual({ ok: true });
  });

  it("refuses the malformed and the impossible as format errors", () => {
    for (const value of ["14-02-1994", "1994/02/14", "1994-13-01", "1994-02-30", "yesterday"]) {
      expect(validateDateOfBirth(value, now)).toEqual({ ok: false, reason: "format" });
    }
  });

  it("names a future date as future, not as a format mistake", () => {
    expect(validateDateOfBirth("2027-01-01", now)).toEqual({ ok: false, reason: "future" });
  });

  it("refuses a pre-1900 date", () => {
    expect(validateDateOfBirth("1899-12-31", now)).toEqual({ ok: false, reason: "too_old" });
  });
});

describe("profile field validators (PI-1)", () => {
  it("normalizes location whitespace and refuses control characters", () => {
    expect(validateProfileLocation("  Kolkata,   West Bengal ")).toEqual({
      ok: true,
      location: "Kolkata, West Bengal",
    });
    expect(validateProfileLocation("a\u0007b")).toEqual({ ok: false });
    expect(validateProfileLocation("x".repeat(81))).toEqual({ ok: false });
  });

  it("accepts 1-3 digit jersey numbers, leading zero included", () => {
    expect(validateJerseyNumber(" 07 ")).toEqual({ ok: true, number: "07" });
    expect(validateJerseyNumber("100")).toEqual({ ok: true, number: "100" });
    for (const value of ["", "0007", "7a", "-1", "seven"]) {
      expect(validateJerseyNumber(value)).toEqual({ ok: false });
    }
  });
});
