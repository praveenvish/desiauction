import { describe, expect, it } from "vitest";

import { REGISTRATION_ROLES, isRegistrationRole } from "../competition";
import {
  BATTING_STYLES,
  BOWLING_STYLES,
  PLAYER_ROLES,
  parseBattingStyle,
  parseRole,
  roleLabel,
  styleLabel,
} from "../player-profile";
import {
  CRICKET,
  DEFAULT_SPORT,
  DEFAULT_SPORT_KEY,
  SPORTS,
  attributeOptionKeys,
  attributeOptionLabel,
  isSportKey,
  normalizeVocabularyKey,
  parseAttributeIn,
  parseRoleIn,
  roleKeys,
  roleLabelIn,
  scoreWithinBounds,
  sportPack,
  sportPackFor,
} from ".";

describe("the registry", () => {
  it("resolves a pack by key and refuses one it does not have", () => {
    expect(sportPack("cricket")).toBe(CRICKET);
    expect(sportPack("kabaddi")).toBeNull();
    expect(isSportKey("cricket")).toBe(true);
    expect(isSportKey("kabaddi")).toBe(false);
  });

  it("resolves a stored key to its pack, and never to an outage", () => {
    // The read path's resolver: a page renders, so it cannot refuse.
    expect(sportPackFor("cricket")).toBe(CRICKET);
    expect(sportPackFor(null)).toBe(DEFAULT_SPORT);
    expect(sportPackFor(undefined)).toBe(DEFAULT_SPORT);
    // Unreachable while the FK on competitions.sport holds — kept because the
    // one case it cannot cover is a pack file deleted with its catalogue row
    // still enabled, which should look like stale labels, not a 500.
    expect(sportPackFor("kabaddi")).toBe(DEFAULT_SPORT);
  });

  it("still refuses an unknown key where a CALLER is validating input", () => {
    // The contrast with sportPackFor is the point: a write path must be able to
    // say no, a read path must be able to render.
    expect(sportPack("kabaddi")).toBeNull();
  });

  it("names the default rather than assuming it", () => {
    expect(DEFAULT_SPORT_KEY).toBe("cricket");
    expect(DEFAULT_SPORT).toBe(CRICKET);
    expect(SPORTS).toContain(CRICKET);
  });
});

/*
 * THE DRIFT GUARD.
 *
 * `PlayerRole` and `RegistrationRole` are literal-union types the whole product
 * is checked against, and they are declared from the pack's exported tuple so
 * the compiler keeps them exact. These assertions close the other direction:
 * the tuple and the pack's own term list are two expressions of one fact, and
 * nothing stops a future edit from adding a role to one and not the other.
 */
describe("the pack and the types cannot drift apart", () => {
  it("declares exactly the roles the product's types are built from", () => {
    expect(roleKeys(CRICKET)).toEqual([...PLAYER_ROLES]);
    expect(roleKeys(CRICKET)).toEqual([...REGISTRATION_ROLES]);
  });

  it("declares exactly the styles the product's types are built from", () => {
    expect(attributeOptionKeys(CRICKET, "batting_style")).toEqual([...BATTING_STYLES]);
    expect(attributeOptionKeys(CRICKET, "bowling_style")).toEqual([...BOWLING_STYLES]);
  });

  it("agrees with the competition module about what a role is", () => {
    for (const role of roleKeys(CRICKET)) {
      expect(isRegistrationRole(role)).toBe(true);
    }
    expect(isRegistrationRole("goalkeeper")).toBe(false);
  });
});

/*
 * The defect this registry was built to close: four copies of the role list
 * produced two spellings of one role, so a player read as "All-rounder" on
 * their share card and "All rounder" in the registrations table.
 */
describe("one role, one label", () => {
  it("gives every role a distinct label", () => {
    const labels = CRICKET.roles.values.map((role) => role.label);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it("spells all_rounder the way the public surfaces already did", () => {
    expect(roleLabel("all_rounder")).toBe("All-rounder");
    expect(roleLabel("wicket_keeper")).toBe("Wicket-keeper");
  });

  it("makes an unknown role readable rather than raw", () => {
    expect(roleLabel("left_wing")).toBe("left wing");
  });

  it("never lets one alias point at two roles", () => {
    const seen = new Map<string, string>();
    for (const role of CRICKET.roles.values) {
      for (const spelling of [role.key, role.label, ...role.aliases]) {
        const normalized = normalizeVocabularyKey(spelling);
        const owner = seen.get(normalized);
        expect(owner === undefined || owner === role.key, `"${spelling}" is ambiguous`).toBe(true);
        seen.set(normalized, role.key);
      }
    }
  });
});

describe("reading a value the way a person wrote it", () => {
  it("places a role however it is spelled on a registration form", () => {
    for (const spelling of ["All Rounder", "all-rounder", "ALLROUNDER", "batting all rounder"]) {
      expect(parseRoleIn(CRICKET, spelling)).toBe("all_rounder");
    }
    expect(parseRole("Wicket Keeper Batsman")).toBe("wicket_keeper");
    expect(parseRole("Batsman")).toBe("batter");
    expect(parseRole("leg spinner")).toBe("bowler");
  });

  it("reports what it cannot place instead of guessing", () => {
    expect(parseRoleIn(CRICKET, "sweeper keeper")).toBeNull();
    expect(parseRole("")).toBeNull();
  });

  it("places a style from its token or the label an organizer was shown", () => {
    expect(parseAttributeIn(CRICKET, "bowling_style", "Off-Break")).toBe("off_break");
    expect(parseAttributeIn(CRICKET, "bowling_style", "off break")).toBe("off_break");
    expect(parseBattingStyle("Right Hand Opener")).toBe("right_hand_opener");
  });

  it("keeps the two style sets apart", () => {
    expect(parseBattingStyle("Off-Break")).toBeNull();
    expect(parseAttributeIn(CRICKET, "batting_style", "off_break")).toBeNull();
  });

  it("labels a style from either set, and passes an unknown one through", () => {
    expect(attributeOptionLabel(CRICKET, "leg_break")).toBe("Leg-Break");
    expect(attributeOptionLabel(CRICKET, "right_hand")).toBe("Right Hand Batsman");
    expect(styleLabel("switch_hitter")).toBe("switch_hitter");
    expect(styleLabel(null)).toBeNull();
  });

  it("labels a role for a pack it is given, not the house default", () => {
    expect(roleLabelIn(CRICKET, "bowler")).toBe("Bowler");
  });
});

describe("the score typo net", () => {
  it("accepts a scoreline a match could produce", () => {
    expect(scoreWithinBounds(CRICKET, { runs: 187, wickets: 6, balls: 120 })).toBe(true);
  });

  it("refuses an eleventh wicket and a slipped digit", () => {
    expect(scoreWithinBounds(CRICKET, { runs: 187, wickets: 11, balls: 120 })).toBe(false);
    expect(scoreWithinBounds(CRICKET, { runs: 1870000, wickets: 6, balls: 120 })).toBe(false);
    expect(scoreWithinBounds(CRICKET, { runs: -1, wickets: 0, balls: 0 })).toBe(false);
  });

  /* "Did not say" is not "said something impossible" — a fixture may carry no
     score at all, and the check must not turn that into a refusal. */
  it("treats an absent component as absent, not as zero", () => {
    expect(scoreWithinBounds(CRICKET, {})).toBe(true);
    expect(scoreWithinBounds(CRICKET, { runs: null, wickets: undefined })).toBe(true);
  });
});
