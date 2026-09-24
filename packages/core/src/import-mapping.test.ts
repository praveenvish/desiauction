import { describe, expect, it } from "vitest";

import {
  applyMapping,
  detectMapping,
  mappingOf,
  normalizeHeader,
  sampleRow,
  signatureOf,
} from "./import-mapping";
import { driveFileIdOf, editCsvRow, parseRegistrationRecords } from "./registration-csv";
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

/*
 * The wording of real cricket registration Forms. Each of these stopped an
 * import before 2026-09-24: "Player's Name" matched nothing (the apostrophe
 * normalises to "player s name"), so the file had no name column at all, and
 * the style answers a Form offers ("Right", "Off Spin", "I don't bowl") were
 * each refused row by row.
 */
describe("real cricket Form wording", () => {
  it("maps a possessive name question, straight or curly apostrophe", () => {
    for (const header of ["Player's Name", "Player’s Name"]) {
      const detected = detectMapping(["Timestamp", header, "Mobile No", "Playing Role"]);
      expect(detected.missing).toEqual([]);
      expect(detected.columns[1]?.field).toBe("name");
    }
  });

  it("maps the common question titles without a hand edit", () => {
    const detected = detectMapping([
      "Your Full Name",
      "WhatsApp No",
      "Specialization",
      "Batsman Type",
      "Bowler Type",
      "Size of T-shirt",
      "Preferred Jersey No.",
      "Name to be printed on Jersey",
      "Transaction ID / UTR",
      "Entry Fee Paid?",
    ]);
    expect(detected.columns.map((column) => column.field)).toEqual([
      "name",
      "phone",
      "role",
      "batting_style",
      "bowling_style",
      "tshirt_size",
      "jersey_number",
      "jersey_name",
      "fee_reference",
      "fee_status",
    ]);
  });

  it("imports Form-style style answers and reads 'not me' as blank", () => {
    const csv = [
      "Player's Name,Mobile Number,Playing Role,Batting Style,Bowling Style",
      "Rohit Sharma,9876543210,Batsman,Right,I don't bowl",
      "Axar Patel,9876543211,All Rounder,Left Handed,Slow Left Arm Orthodox",
      "Kuldeep Yadav,9876543212,Bowler,RHB,Chinaman",
      "Ravi Bishnoi,9876543213,Bowler,Right Hand,Leg Spin",
      "Rishabh Pant,9876543214,Wicket Keeper,LHB,None",
    ].join("\n");
    const records = tokenizeCsv(csv);
    const canonical = applyMapping(records, mappingOf(detectMapping(records[0] ?? [])));
    const result = parseRegistrationRecords(canonical, undefined, { now: NOW });
    expect(result.errors).toEqual([]);
    expect(result.rows.map((row) => [row.battingStyle, row.bowlingStyle])).toEqual([
      ["right_hand", null],
      ["left_hand", "left_arm_orthodox"],
      ["right_hand", "left_arm_chinaman"],
      ["right_hand", "leg_break"],
      ["left_hand", null],
    ]);
  });

  it("still asks rather than guesses when a style has two meanings", () => {
    const records = tokenizeCsv(
      "Name,Phone,Role,Bowling Style\nAnil Kumble,9876543210,Bowler,Left Arm Spin",
    );
    const canonical = applyMapping(records, mappingOf(detectMapping(records[0] ?? [])));
    const result = parseRegistrationRecords(canonical, undefined, { now: NOW });
    expect(result.errors[0]?.message).toContain('unknown bowling style "Left Arm Spin"');
  });

  it("says why an Excel-mangled phone is unreadable", () => {
    const result = parseRegistrationRecords(
      tokenizeCsv("name,phone,role\nRohit Sharma,9.87654E+09,batter"),
      undefined,
      { now: NOW },
    );
    expect(result.errors[0]?.message).toContain("download the CSV again from Google Sheets");
  });
});

/*
 * From a real club's export (2026-09-24): the Form decorated its role choices
 * with emoji, and all 110 rows were refused as "invalid cricket role".
 */
describe("emoji-decorated Form choices", () => {
  it("reads the choice under the emoji", () => {
    const csv = [
      '"Timestamp","Name","Father’s Name","Mobile","Player Type"',
      '"2026/02/05 10:54:08 PM GMT+5:30","Rohit Sharma ","Gurunath Sharma","9876543210","⚔️ Allrounder"',
      '"2026/02/05 10:55:08 PM GMT+5:30","Virat Kohli","Prem Kohli","9876543211","🏏 Batsman"',
      '"2026/02/05 10:56:08 PM GMT+5:30","Jasprit Bumrah","Jasbir Bumrah","9876543212","🎯 Bowler"',
      '"2026/02/05 10:57:08 PM GMT+5:30","Rishabh Pant","Rajendra Pant","9876543213","🧤 Wicketkeeper"',
    ].join("\n");
    const records = tokenizeCsv(csv);
    const detected = detectMapping(records[0] ?? []);
    expect(detected.missing).toEqual([]);
    const canonical = applyMapping(records, mappingOf(detected));
    const result = parseRegistrationRecords(canonical, undefined, { now: NOW });
    expect(result.errors).toEqual([]);
    expect(result.rows.map((row) => row.role)).toEqual([
      "all_rounder",
      "batter",
      "bowler",
      "wicket_keeper",
    ]);
    expect(result.rows[0]?.fatherName).toBe("Gurunath Sharma");
  });
});

describe("errors an organizer can act on", () => {
  it("names the player and the other player on a shared phone", () => {
    const result = parseRegistrationRecords(
      tokenizeCsv(
        "name,phone,role\nDalpat Singh,9326997891,batter\nMahipal Singh,9326997891,bowler",
      ),
      undefined,
      { now: NOW },
    );
    expect(result.errors).toEqual([
      {
        line: 3,
        name: "Mahipal Singh",
        fields: ["phone"],
        message: "duplicate phone in file — same number as Dalpat Singh (row 2)",
      },
    ]);
  });

  it("tells a double submission from two players sharing a phone", () => {
    const result = parseRegistrationRecords(
      tokenizeCsv(
        "name,phone,role\nJitendra singh ,9326997891,batter\nJitendra  Singh,9326997891,batter",
      ),
      undefined,
      { now: NOW },
    );
    expect(result.errors[0]?.message).toContain("submitted the form twice");
    // Nothing to edit: the fix is to skip the copy, not change a number.
    expect(result.errors[0]?.fields).toEqual([]);
  });

  it("says which columns failed so the screen can offer those cells", () => {
    const result = parseRegistrationRecords(
      tokenizeCsv("name,phone,role,bowling_style\nRavi Kumar,12345,Batsman (Opener),Fast"),
      undefined,
      { now: NOW },
    );
    expect(result.errors[0]?.fields).toEqual(["phone", "role", "bowling_style"]);
  });
});

describe("editCsvRow — fixing a row in place", () => {
  const FILE =
    '"Name","Mobile","Player Type"\n"Rohit, R","9876543210","🏏 Batsman"\n\n"Virat","9876543210","Bowler"';

  it("changes only the addressed cells, counting lines the way the parser does", () => {
    // The blank line is dropped by the parser, so Virat is line 3, not 4.
    const next = editCsvRow(FILE, 3, new Map([[1, "+91 98765 43211"]]));
    expect(next).not.toBeNull();
    const result = parseRegistrationRecords(
      applyMapping(tokenizeCsv(next ?? ""), { name: 0, phone: 1, role: 2 }),
      undefined,
      { now: NOW },
    );
    expect(result.errors).toEqual([]);
    expect(result.rows.map((row) => [row.name, row.phone])).toEqual([
      ["Rohit, R", "+919876543210"],
      ["Virat", "+919876543211"],
    ]);
  });

  it("refuses the header and lines past the end", () => {
    expect(editCsvRow(FILE, 1, new Map([[0, "x"]]))).toBeNull();
    expect(editCsvRow(FILE, 9, new Map([[0, "x"]]))).toBeNull();
  });
});

describe("photo_link — the Drive id a Form wrote for an upload", () => {
  it("maps the Photo column and keeps the file id, not the URL", () => {
    const csv = [
      '"Name","Mobile","Player Type","Photo"',
      '"Chen Singh","7506698281","Allrounder","https://drive.google.com/u/0/open?usp=forms_web&id=1ESy6C82DCx_MpjwLITsY2CyU6ssjXK3Z"',
      '"Two Links","7506698282","Bowler","https://drive.google.com/open?id=1AAAAAAAAAAAA, https://drive.google.com/open?id=1BBBBBBBBBBBB"',
      '"Shared","7506698283","Batsman","https://drive.google.com/file/d/1CCCCCCCCCCCCC/view?usp=sharing"',
      '"No Link","7506698284","Batsman","will send on WhatsApp"',
    ].join("\n");
    const records = tokenizeCsv(csv);
    const detected = detectMapping(records[0] ?? []);
    expect(detected.columns[3]?.field).toBe("photo_link");
    const result = parseRegistrationRecords(applyMapping(records, mappingOf(detected)), undefined, {
      now: NOW,
    });
    expect(result.errors).toEqual([]);
    expect(result.rows.map((row) => row.photoDriveId)).toEqual([
      "1ESy6C82DCx_MpjwLITsY2CyU6ssjXK3Z",
      "1AAAAAAAAAAAA",
      "1CCCCCCCCCCCCC",
      null,
    ]);
  });

  it("never reads a non-Google link as a Drive file", () => {
    expect(driveFileIdOf("https://evil.example/open?id=1ESy6C82DCx_Mpjw")).toBeNull();
    expect(driveFileIdOf("")).toBeNull();
  });
});
