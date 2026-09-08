import { describe, expect, it } from "vitest";

import { parseCsvFlag, parseRegistrationCsv } from "./registration-csv";

/**
 * THE SQUAD A FILE ALREADY KNOWS.
 *
 * A club's roster sheet says which team each player belongs to, which of them
 * were kept from last season, and who wears the armband. None of it could be
 * imported: `IMPORT_FIELDS` had eighteen columns and not one of them was team,
 * icon, captain or retained. So an organizer imported forty players and then
 * re-entered every affiliation by hand on the dashboard, one toggle at a time,
 * restating facts the file in front of them contained.
 *
 * These columns move auction pool membership, which is why they were deferred
 * until the roster lock existed to hold them.
 */
const HEAD = "name,phone,role,team,is_icon,is_captain,is_retained";
const TEAMS = ["Andheri Arrows", "Bandra Blasters"];

function parse(...lines: string[]) {
  return parseRegistrationCsv([HEAD, ...lines].join("\n"), undefined, { knownTeams: TEAMS });
}

describe("reading a yes the way a spreadsheet writes one", () => {
  it("takes every spelling of yes and no a roster sheet uses", () => {
    for (const yes of ["yes", "Y", "TRUE", "t", "1", "✓", "x"]) {
      expect(parseCsvFlag(yes), yes).toBe(true);
    }
    for (const no of ["no", "N", "false", "0", "-"]) {
      expect(parseCsvFlag(no), no).toBe(false);
    }
  });

  it("refuses a value it cannot place rather than calling it no", () => {
    // The expensive silence: a misread "maybe" would drop a player out of the
    // auction, and the file would be reported clean.
    expect(parseCsvFlag("maybe")).toBeNull();
    expect(parseCsvFlag("TBC")).toBeNull();
    const result = parse("Rohit,9876543210,batter,Andheri Arrows,maybe,,");
    expect(result.rows).toEqual([]);
    expect(result.errors[0]?.message).toContain('unreadable is_icon "maybe"');
  });
});

describe("the squad columns", () => {
  it("carries team, icon, captain and retained off the file", () => {
    const result = parse("Rohit,9876543210,batter,Andheri Arrows,no,yes,yes");
    expect(result.errors).toEqual([]);
    expect(result.rows[0]).toMatchObject({
      teamName: "Andheri Arrows",
      isIcon: false,
      isCaptain: true,
      isRetained: true,
    });
  });

  it("reads a blank cell as SAID NOTHING, not as no", () => {
    /*
     * The distinction the whole design rests on. A club listing four retentions
     * leaves fifty-six cells empty; reading those as `false` would clear every
     * Icon and Captain an organizer had set by hand, and call it an update.
     */
    const result = parse("Rohit,9876543210,batter,,,,");
    expect(result.rows[0]).toMatchObject({
      teamName: null,
      isIcon: null,
      isCaptain: null,
      isRetained: null,
    });
  });

  it("refuses a team the season does not have", () => {
    // Without this a misspelt team imports as NO team — the player silently
    // unaffiliated, the file reported clean.
    const result = parse("Rohit,9876543210,batter,Andheri Arrow,,,");
    expect(result.rows).toEqual([]);
    expect(result.errors[0]?.message).toContain('unknown team "Andheri Arrow"');
  });

  it("matches a team however the sheet spells it", () => {
    // Case, spacing and punctuation are noise — the same rule the header
    // matcher already applies to column names.
    for (const spelling of ["andheri arrows", "ANDHERI  ARROWS", "Andheri-Arrows"]) {
      const result = parse(`Rohit,9876543210,batter,${spelling},,,`);
      expect(result.errors, spelling).toEqual([]);
      expect(result.rows[0]?.teamName).toBe(spelling);
    }
  });

  it("checks nothing when it was not told the teams", () => {
    // A caller that has no season yet must still be able to parse — the same
    // contract `knownBands` and `now` have.
    const result = parseRegistrationCsv([HEAD, "Rohit,9876543210,batter,Whoever,,,"].join("\n"));
    expect(result.errors).toEqual([]);
    expect(result.rows[0]?.teamName).toBe("Whoever");
  });
});

describe("the invariants, refused in bulk instead of one row at a time", () => {
  it("refuses a player who is both an Icon and a Captain", () => {
    // An Icon is pre-signed and never goes under the hammer; a Captain leads a
    // squad that plays. The dashboard refuses the combination one row at a
    // time, and a file asserting both has a mistake in it rather than a
    // preference the import could honour.
    const result = parse("Rohit,9876543210,batter,Andheri Arrows,yes,yes,");
    expect(result.rows).toEqual([]);
    expect(result.errors[0]?.message).toContain("cannot be both an Icon and a Captain");
  });

  it("refuses a second captain for one team, naming the line that claimed it", () => {
    /*
     * `registrations_team_captain_uq` makes two unrepresentable, and the
     * single-row writer resolves a collision by demoting the incumbent —
     * "this player instead". A file naming two at once means no such thing, and
     * letting row order decide would hand the armband to whoever the
     * spreadsheet happened to sort first.
     */
    const result = parse(
      "Rohit,9876543210,batter,Andheri Arrows,,yes,",
      "Jasprit,9876543211,bowler,Andheri Arrows,,yes,",
    );
    expect(result.rows.length).toBe(1);
    expect(result.errors[0]?.message).toContain(
      'a second captain for "Andheri Arrows" (also line 2)',
    );
  });

  it("allows one captain per team across different teams", () => {
    const result = parse(
      "Rohit,9876543210,batter,Andheri Arrows,,yes,",
      "Jasprit,9876543211,bowler,Bandra Blasters,,yes,",
    );
    expect(result.errors).toEqual([]);
    expect(result.rows.length).toBe(2);
  });

  it("lets a retained player wear the armband", () => {
    // Retention says where a player came FROM; the armband says what they are
    // to the team. You retain last season's captain.
    const result = parse("Rohit,9876543210,batter,Andheri Arrows,,yes,yes");
    expect(result.errors).toEqual([]);
    expect(result.rows[0]).toMatchObject({ isCaptain: true, isRetained: true });
  });
});
