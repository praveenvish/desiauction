import { describe, expect, it } from "vitest";

import { applyMapping, detectMapping, type ColumnMapping, type ValueMaps } from "./import-mapping";
import { unplacedValues, type ImportVocabulary } from "./import-values";
import { tokenizeCsv } from "./registration-csv";
import { sportPackFor } from "./sports";

/**
 * COLUMN MAPPING TRANSLATES HEADERS. This is the other half.
 *
 * A club whose price bands are "Category 1/2/3" against a season configured for
 * A/B/C got `unknown base price band` on every row, and the product's only
 * answer was: leave, edit the spreadsheet, come back. The aliases cannot help —
 * bands and team names are invented per season, so no table shipped in this
 * repo could ever know them.
 */
const SEASON: ImportVocabulary = {
  pack: sportPackFor("cricket"),
  bands: ["A", "B", "C"],
  teams: ["Andheri Arrows", "Bandra Blasters"],
};

/** A file, read the way the import reads it: tokenized, then mapped canonical. */
function canonical(csv: string): string[][] {
  const records = tokenizeCsv(csv);
  const detected = detectMapping(records[0] ?? []);
  const mapping: ColumnMapping = {};
  for (const column of detected.columns) {
    if (column.field !== null) {
      mapping[column.field] = column.index;
    }
  }
  return applyMapping(records, mapping);
}

describe("the values a season cannot place", () => {
  it("reports a band vocabulary the season does not use, with its options", () => {
    const rows = canonical(
      "name,phone,role,base_price_band\n" +
        "Rohit,9876543210,batter,Category 1\n" +
        "Jasprit,9876543211,bowler,Category 1\n" +
        "Virat,9876543212,batter,Category 2",
    );
    const unplaced = unplacedValues(rows, SEASON);
    expect(unplaced.map((entry) => [entry.value, entry.rows])).toEqual([
      ["Category 1", 2],
      ["Category 2", 1],
    ]);
    // The season's own bands are the answer, because nothing else could be.
    expect(unplaced[0]?.options.map((option) => option.value)).toEqual(["A", "B", "C"]);
    expect(unplaced[0]?.fieldLabel).toBe("Base price band");
  });

  it("says nothing about a value the season already accepts", () => {
    // Aliases absorb what IS predictable — "Batsman" is a role, "done" is a fee
    // status — and a screen that listed those would be asking the organizer to
    // confirm what the parser had already got right.
    const rows = canonical(
      "name,phone,role,fee_status,base_price_band\nRohit,9876543210,Batsman,done,A",
    );
    expect(unplacedValues(rows, SEASON)).toEqual([]);
  });

  it("reports a team the season spells differently", () => {
    const rows = canonical("name,phone,role,team\nRohit,9876543210,batter,Arrows");
    const unplaced = unplacedValues(rows, SEASON);
    expect(unplaced.map((entry) => entry.value)).toEqual(["Arrows"]);
    expect(unplaced[0]?.options.map((option) => option.value)).toEqual([
      "Andheri Arrows",
      "Bandra Blasters",
    ]);
  });

  it("shrinks as the organizer fills it in", () => {
    /*
     * The property that makes the screen usable. A value already mapped is
     * applied before the check, so it stops being reported — otherwise the list
     * never moves and the organizer cannot tell whether anything they did took
     * effect.
     */
    const rows = canonical(
      "name,phone,role,base_price_band\nRohit,9876543210,batter,Category 1\nJas,9876543211,bowler,Category 2",
    );
    const maps: ValueMaps = { base_price_band: { "category 1": "A" } };
    expect(unplacedValues(rows, SEASON, maps).map((entry) => entry.value)).toEqual(["Category 2"]);
  });

  it("leaves free-text columns alone", () => {
    // A name, a note, a jersey number: any value is legal, so none can be
    // unplaceable. Offering a dropdown here would list every note ever written.
    const rows = canonical(
      "name,phone,role,note,jersey_number\nRohit,9876543210,batter,Pays on the day,77",
    );
    expect(unplacedValues(rows, SEASON)).toEqual([]);
  });

  it("does not judge an attribute the sport does not have", () => {
    /*
     * A football roster carrying a leftover batting-style column: the football
     * pack has no such attribute, so it cannot say whether "Right hand" is
     * legal. Reporting every row would bury the screen under something no
     * dropdown could fix — there would be no options to offer.
     */
    const rows = canonical("name,phone,role,batting_style\nRohit,9876543210,forward,Right hand");
    const football: ImportVocabulary = { ...SEASON, pack: sportPackFor("football") };
    expect(unplacedValues(rows, football)).toEqual([]);
  });

  it("reads a yes/no column that says neither", () => {
    const rows = canonical("name,phone,role,is_retained\nRohit,9876543210,batter,Keeping him");
    const unplaced = unplacedValues(rows, SEASON);
    expect(unplaced.map((entry) => entry.value)).toEqual(["Keeping him"]);
    expect(unplaced[0]?.options.map((option) => option.value)).toEqual(["yes", "no"]);
  });

  it("puts the costliest value first, and is stable between reads", () => {
    const rows = canonical(
      "name,phone,role,base_price_band\n" +
        "A,9876543210,batter,Zeta\n" +
        "B,9876543211,batter,Alpha\n" +
        "C,9876543212,batter,Alpha",
    );
    expect(unplacedValues(rows, SEASON).map((entry) => entry.value)).toEqual(["Alpha", "Zeta"]);
  });
});
