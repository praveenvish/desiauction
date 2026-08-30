import { describe, expect, it } from "vitest";

import {
  BATTING_STYLES,
  BOWLING_STYLES,
  PLAYER_ROLES,
  deriveAge,
  isBattingStyle,
  isBowlingStyle,
  parseRole,
  roleLabel,
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
