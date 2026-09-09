import { describe, expect, it } from "vitest";

import { evaluateRegistration } from "./eligibility";
import { parseRegistrationCsv } from "./registration-csv";
import { sportPackFor } from "./sports";
import type { SportPack } from "./sports/types";

/**
 * THE SPORT PACKS SHIPPED AND NO PLAYER COULD ENTER THREE OF THE FOUR SPORTS.
 *
 * Migration 0047 opened `registrations.role` — no enum, nullable — because "a
 * column-level list could only ever name one sport's" roles. The database was
 * right. Everything in front of it still asked cricket:
 *
 *   · `evaluateRegistration` called `parseRole`, which is `parseRoleIn(CRICKET)`
 *     — so "midfielder" was an invalid role in a football season;
 *   · `submitRegistration`'s own defence-in-depth check called
 *     `isRegistrationRole`, cricket again, so the writer refused it a second
 *     time;
 *   · `validateNewPlayer` called `parseRole` too, which is the one validation
 *     truth behind BOTH the CSV import and the organizer's add-by-hand dialog.
 *
 * Every route a player can arrive by, closed, for football, kabaddi and
 * volleyball. And the forms in front of those gates were cricket's too: the
 * public registration dropdown and the organizer's add-player dialog were both
 * built from `REGISTRATION_ROLES`, an alias for cricket's four — so a
 * footballer had no role to pick even before anything refused them one.
 */
const ROSTER = "name,phone,role\nRohit,9876543210,midfielder\nJas,9876543211,goalkeeper";

describe("a role means what the season's sport says it means", () => {
  it("admits a football role to a football season", () => {
    const verdict = evaluateRegistration({
      competitionStatus: "registration_open",
      entryCategory: "open",
      sport: "football",
      role: "midfielder",
      gender: null,
      dateOfBirth: null,
      guardianConsent: false,
      guardianName: "",
      channel: "self",
      now: new Date("2026-08-30T12:00:00Z"),
    });
    expect(verdict.reasons).not.toContain("invalid_role");
  });

  it("still refuses a role no pack has", () => {
    const verdict = evaluateRegistration({
      competitionStatus: "registration_open",
      entryCategory: "open",
      sport: "football",
      role: "wicket_keeper",
      gender: null,
      dateOfBirth: null,
      guardianConsent: false,
      guardianName: "",
      channel: "self",
      now: new Date("2026-08-30T12:00:00Z"),
    });
    // A cricket role in a football season is exactly as wrong as gibberish, and
    // the fix must not have widened the gate to "anything goes".
    expect(verdict.reasons).toContain("invalid_role");
  });

  it("imports a football roster that used to fail on every line", () => {
    const result = parseRegistrationCsv(ROSTER, undefined, { pack: sportPackFor("football") });
    expect(result.errors).toEqual([]);
    expect(result.rows.map((row) => row.role)).toEqual(["midfielder", "goalkeeper"]);
  });

  it("names the sport when it refuses a role, so the message is actionable", () => {
    // "invalid role" told an organizer nothing about WHY midfielder was wrong.
    const result = parseRegistrationCsv(ROSTER, undefined, { pack: sportPackFor("cricket") });
    expect(result.rows).toEqual([]);
    expect(result.errors[0]?.message).toBe('invalid cricket role "midfielder"');
  });

  it("reads each pack's own spellings, aliases and all", () => {
    for (const [sport, written, stored] of [
      ["football", "CB", "defender"],
      ["kabaddi", "left corner", "defender"],
      ["volleyball", "outside hitter", "attacker"],
      ["cricket", "All Rounder", "all_rounder"],
      // Hockey's own words for football's four lines.
      ["hockey", "drag flicker", "defender"],
      ["hockey", "half", "midfielder"],
      // Half of amateur basketball writes the position NUMBER, not its name.
      ["basketball", "PG", "guard"],
      ["basketball", "5", "center"],
      ["basketball", "power forward", "forward"],
      // Box cricket borrows cricket's vocabulary by reference, so cricket's
      // spellings must place in it — if they stopped, the borrow broke.
      ["box_cricket", "Wicket Keeper Batsman", "wicket_keeper"],
      ["box_cricket", "leg spinner", "bowler"],
      // "Support" is what this role is called everywhere; the LABEL is Anchor
      // because the product has a Support page and one word cannot be both.
      ["esports", "support", "anchor"],
      ["esports", "shotcaller", "igl"],
    ] as const) {
      const csv = `name,phone,role\nPlayer One,9876543210,${written}`;
      const result = parseRegistrationCsv(csv, undefined, { pack: sportPackFor(sport) });
      expect(result.errors, `${sport}: ${written}`).toEqual([]);
      expect(result.rows[0]?.role, `${sport}: ${written}`).toBe(stored);
    }
  });

  it("defaults to the default sport when nobody says, which is what every fixture relies on", () => {
    // Not a silent cricket bug: 58 call sites parse cricket files, and the four
    // production paths pass the season's own pack. Stated so the default is a
    // decision somebody made rather than one nobody noticed.
    const result = parseRegistrationCsv("name,phone,role\nRohit,9876543210,batter");
    expect(result.errors).toEqual([]);
    expect(result.rows[0]?.role).toBe("batter");
  });
});

/**
 * A SPORT MAY DECLARE THAT IT HAS NO ROLES, and ESPORTS now does.
 *
 * `RoleVocabulary.required` has been a per-pack fact since Phase 0 and nothing
 * shipped had ever set it false, so this branch was reachable only from the
 * synthetic pack below. Esports reaches it for real: Valorant has positions,
 * BGMI has different ones, a FIFA ladder has none, so the four it offers are
 * offered rather than demanded.
 *
 * The synthetic pack stays because it can be pointed at a vocabulary esports
 * does not have, which is how the "present and wrong" case is tested: `evaluateRegistration` and `submitRegistration` take a SPORT KEY and
 * resolve the pack themselves, while `validateNewPlayer` takes the pack, so a
 * synthetic one can be handed to it. All three say the rule the same way.
 */
const ROLELESS: SportPack = {
  ...sportPackFor("kabaddi"),
  key: "test_roleless",
  label: "Roleless",
  roles: { required: false, values: sportPackFor("kabaddi").roles.values },
};

describe("a sport whose players have no position", () => {
  it("accepts a blank role", () => {
    const result = parseRegistrationCsv("name,phone,role\nRohit,9876543210,", undefined, {
      pack: ROLELESS,
    });
    expect(result.errors).toEqual([]);
    expect(result.rows[0]?.role).toBe("");
  });

  it("still refuses a role that is present and wrong", () => {
    /*
     * The branch this exists for. Written as `required && invalid`, the check
     * stops entirely for an optional-role sport and waves through ANY string —
     * so "banana" would be stored as a playing role. Empty and wrong are
     * different answers, and only the first of them is optional.
     */
    const result = parseRegistrationCsv("name,phone,role\nRohit,9876543210,banana", undefined, {
      pack: ROLELESS,
    });
    expect(result.rows).toEqual([]);
    expect(result.errors[0]?.message).toContain('invalid roleless role "banana"');
  });

  it("accepts a blank role in ESPORTS, which is a shipped pack and not a fixture", () => {
    // The branch, reached through the registry rather than a hand-built pack.
    const result = parseRegistrationCsv("name,phone,role\nGhost,9876543210,", undefined, {
      pack: sportPackFor("esports"),
    });
    expect(result.errors).toEqual([]);
    expect(result.rows[0]?.role).toBe("");
  });

  it("still places an esports role when the file names one", () => {
    // Optional does not mean ignored: a roster that says "AWPer" gets a sniper.
    const result = parseRegistrationCsv("name,phone,role\nGhost,9876543210,AWPer", undefined, {
      pack: sportPackFor("esports"),
    });
    expect(result.errors).toEqual([]);
    expect(result.rows[0]?.role).toBe("sniper");
  });

  it("refuses a blank role where the sport DOES require one", () => {
    const result = parseRegistrationCsv("name,phone,role\nRohit,9876543210,", undefined, {
      pack: sportPackFor("football"),
    });
    expect(result.rows).toEqual([]);
    expect(result.errors[0]?.message).toContain("invalid football role");
  });
});
