import { describe, expect, it } from "vitest";

import {
  applyMapping,
  detectMapping,
  mappingOf,
  normalizeHeader,
  sampleRow,
  signatureOf,
} from "./import-mapping";
import { parseRegistrationRecords } from "./registration-csv";
import { tokenizeCsv } from "./registration-csv";

/*
 * A Google Form response export, in the shape one actually arrives in: the
 * form's own bookkeeping columns first, questions as headers, and the answers
 * written the way people write them.
 *
 * SYNTHETIC. It is modelled on the documented export format, not taken from a
 * real club's sheet — so it proves the mapping handles this SHAPE, and a real
 * export is still the thing that proves it handles reality.
 */
const FORM_CSV = [
  "Timestamp,Email Address,Player Name,Mobile Number,Which role do you play?,Date of Birth,Batting Style,Bowling Style",
  "15/03/2026 14:32:11,rohit@example.com,Rohit Sharma,9876543210,Batsman,15/03/1998,Right Hand Batsman,Off-Break",
  "15/03/2026 14:35:02,jasprit@example.com,Jasprit Bumrah,9876543211,Fast Bowler,02/12/1995,Right Hand Batsman,Right Arm Fast",
  "15/03/2026 14:41:19,rishabh@example.com,Rishabh Pant,9876543212,Wicket Keeper Batsman,04/10/1997,Left Hand Batsman,",
].join("\n");

const NOW = new Date("2026-08-30T00:00:00Z");

describe("normalizeHeader — case, punctuation and question marks are noise", () => {
  it("reduces the ways a form asks for one thing to one key", () => {
    expect(normalizeHeader("Which role do you play?")).toBe("which role do you play");
    expect(normalizeHeader("  Mobile   Number  ")).toBe("mobile number");
    expect(normalizeHeader("Player Name (required)")).toBe("player name");
    expect(normalizeHeader("Date of Birth [dd/mm/yyyy]")).toBe("date of birth");
    expect(normalizeHeader("PHONE_NO")).toBe("phone no");
  });
});

describe("detectMapping — the common case needs no configuration", () => {
  const headers: string[] = tokenizeCsv(FORM_CSV)[0] ?? [];

  it("places every player column of a real-shaped Form export", () => {
    const detected = detectMapping(headers);
    const placed: Record<string, string> = {};
    for (const column of detected.columns) {
      if (column.field !== null) {
        placed[column.field] = column.header;
      }
    }
    expect(placed).toEqual({
      name: "Player Name",
      phone: "Mobile Number",
      role: "Which role do you play?",
      date_of_birth: "Date of Birth",
      batting_style: "Batting Style",
      bowling_style: "Bowling Style",
    });
    expect(detected.missing).toEqual([]);
    expect(detected.conflicts).toEqual([]);
  });

  it("marks the form's own bookkeeping as ignored, and says which", () => {
    const ignored = detectMapping(headers).columns.filter((c) => c.noise);
    expect(ignored.map((c) => c.header)).toEqual(["Timestamp", "Email Address"]);
  });

  it("names the required columns a file is missing rather than guessing", () => {
    const detected = detectMapping(["Timestamp", "Player Name", "Batting Style"]);
    expect(detected.missing).toEqual(["phone", "role"]);
  });

  /*
   * The case that must never be resolved silently: two columns both look like
   * a phone, and picking one would write the wrong number against a player.
   */
  it("reports a field claimed twice instead of picking a winner", () => {
    const detected = detectMapping(["Player Name", "Mobile Number", "WhatsApp Number", "Role"]);
    expect(detected.conflicts).toEqual([
      { field: "phone", headers: ["Mobile Number", "WhatsApp Number"] },
    ]);
    // The first claimant still works, so the screen has something to show.
    expect(mappingOf(detected).phone).toBe(1);
    // ...and the loser is left unmapped, not quietly dropped into another field.
    expect(detected.columns[2]).toEqual({
      index: 2,
      header: "WhatsApp Number",
      field: null,
      noise: false,
    });
  });

  it("leaves a column it cannot place unmapped, and not as noise", () => {
    const detected = detectMapping(["Player Name", "Mobile", "Role", "Favourite IPL team"]);
    const stray = detected.columns[3];
    expect(stray?.field).toBeNull();
    expect(stray?.noise).toBe(false);
  });
});

describe("applyMapping — the file becomes the shape the parser already reads", () => {
  const records = tokenizeCsv(FORM_CSV);

  /*
   * THE WHOLE POINT OF PHASE 1. This exact file was refused at line 1 with
   * "Missing required column(s): name, phone, role." before any mapping
   * existed. Through the mapping it goes to the SAME parser and validates.
   */
  it("carries a Google Form export all the way through the existing parser", () => {
    const mapped = applyMapping(records, mappingOf(detectMapping(records[0] ?? [])));
    const result = parseRegistrationRecords(mapped, undefined, { now: NOW });
    expect(result.errors).toEqual([]);
    expect(result.rows).toHaveLength(3);
    expect(result.rows.map((r) => r.name)).toEqual([
      "Rohit Sharma",
      "Jasprit Bumrah",
      "Rishabh Pant",
    ]);
    // Roles and dates arrive canonical, not as the file spelled them.
    expect(result.rows.map((r) => r.role)).toEqual(["batter", "bowler", "wicket_keeper"]);
    expect(result.rows.map((r) => r.dateOfBirth)).toEqual([
      "1998-03-15",
      "1995-12-02",
      "1997-10-04",
    ]);
    expect(result.rows[0]?.phone).toBe("+919876543210");
    expect(result.rows[0]?.bowlingStyle).toBe("off_break");
  });

  it("drops the columns nobody mapped", () => {
    const mapped = applyMapping(records, mappingOf(detectMapping(records[0] ?? [])));
    expect(mapped[0]).not.toContain("Timestamp");
    expect(mapped[0]).not.toContain("Email Address");
  });

  it("obeys a correction the organizer made to the guess", () => {
    // They decide the WhatsApp column is the number to use.
    const csv =
      "Player Name,Mobile Number,WhatsApp Number,Role\nA Player,9000000001,9876543210,Batsman";
    const rows = tokenizeCsv(csv);
    const corrected = applyMapping(rows, { name: 0, phone: 2, role: 3 });
    const result = parseRegistrationRecords(corrected, undefined, { now: NOW });
    expect(result.rows[0]?.phone).toBe("+919876543210");
  });

  it("translates values the organizer taught it", () => {
    const csv = "Player Name,Mobile,Role,Category\nA Player,9876543210,Batsman,Star Player";
    const rows = tokenizeCsv(csv);
    const mapped = applyMapping(
      rows,
      { name: 0, phone: 1, role: 2, base_price_band: 3 },
      { base_price_band: { "star player": "A" } },
    );
    const result = parseRegistrationRecords(mapped, ["A", "B"], { now: NOW });
    expect(result.errors).toEqual([]);
    expect(result.rows[0]?.basePriceBand).toBe("A");
  });

  /*
   * A spreadsheet drops trailing empty cells, so a row can be shorter than its
   * header. Reading positionally without normalizing would shift every later
   * column left by one and write a birthday into a bowling style.
   */
  it("keeps columns aligned when a row is short", () => {
    const csv = "Player Name,Mobile,Role,Bowling Style\nA Player,9876543210,Batsman";
    const mapped = applyMapping(tokenizeCsv(csv), {
      name: 0,
      phone: 1,
      role: 2,
      bowling_style: 3,
    });
    expect(mapped[1]).toEqual(["A Player", "9876543210", "Batsman", ""]);
    expect(parseRegistrationRecords(mapped, undefined, { now: NOW }).errors).toEqual([]);
  });
});

describe("signatureOf — recognising the same form next season", () => {
  it("is stable across case, spacing and column order", () => {
    const a = signatureOf(["Player Name", "Mobile Number", "Which role do you play?"]);
    const b = signatureOf(["  which ROLE do you play? ", "Player  Name", "Mobile Number"]);
    expect(a).toBe(b);
  });

  it("differs when the form actually changes", () => {
    const a = signatureOf(["Player Name", "Mobile Number"]);
    const b = signatureOf(["Player Name", "Mobile Number", "Jersey Size"]);
    expect(a).not.toBe(b);
  });
});

describe("sampleRow — what makes a mapping checkable at a glance", () => {
  it("returns the first row that carries any data", () => {
    const csv = "Player Name,Mobile\n,\nRohit Sharma,9876543210";
    expect(sampleRow(tokenizeCsv(csv))).toEqual(["Rohit Sharma", "9876543210"]);
  });

  it("returns blanks rather than throwing on a header-only file", () => {
    expect(sampleRow(tokenizeCsv("Player Name,Mobile"))).toEqual(["", ""]);
  });
});
