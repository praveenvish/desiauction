import { describe, expect, it } from "vitest";

import {
  IMPORT_FIELDS,
  applyMapping,
  detectMapping,
  importFieldLabel,
  importFieldsFor,
  mappingOf,
  type MappableField,
  normalizeHeader,
  sampleRow,
  signatureOf,
  photoColumnByValues,
  withDetectedPhoto,
} from "./import-mapping";
import { driveFileIdOf, editCsvRow, parseRegistrationRecords } from "./registration-csv";
import { tokenizeCsv } from "./registration-csv";
import { unplacedValues } from "./import-values";
import { CRICKET, FOOTBALL, splitAttributeWrite, sportPackFor } from "./sports";

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
  "15/03/2026 14:32:11,rohit@example.com,Rohit Sharma,9876543201,Batsman,15/03/1998,Right Hand Batsman,Off-Break",
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
    const detected = detectMapping(["Timestamp", "Batting Style"]);
    expect(detected.missing).toEqual(["name"]);
  });

  // Only the name is required: a master sheet of names imports, and the screen
  // says what a missing phone or role will mean instead of refusing the file.
  it("needs nothing but a name column", () => {
    const detected = detectMapping(["Timestamp", "Player Name", "Batting Style"]);
    expect(detected.missing).toEqual([]);
  });

  /*
   * A HINDI MASTER SHEET (BPL4). Every header was Devanagari, and the matcher
   * deleted the vowel signs before looking — "मोबाइल नंबर" became "म ब इल न बर"
   * — so not one column was recognised and the file stopped at step one.
   */
  it("reads a Hindi header row", () => {
    const detected = detectMapping([
      "\uFEFFक्रमांक",
      "खिलाड़ी का नाम (फाइनल हिंदी नाम)",
      "पिता का नाम",
      "मोबाइल नंबर",
      "गांव",
      "बल्लेबाजी स्टाइल",
      "फोटो",
      "Registration Row(s)",
    ]);
    expect(detected.columns.map((column) => column.field)).toEqual([
      null,
      "name",
      "father_name",
      "phone",
      null,
      "batting_style",
      "photo_link",
      null,
    ]);
    expect(detected.missing).toEqual([]);
    // The serial-number columns are a sheet's bookkeeping, said so on screen.
    expect(detected.columns[0]?.noise).toBe(true);
    expect(detected.columns[7]?.noise).toBe(true);
  });

  it("keeps Hindi vowel signs, so two different words stay two", () => {
    expect(normalizeHeader("मोबाइल नंबर")).toBe("मोबाइल नंबर");
    expect(normalizeHeader("बल्लेबाज")).not.toBe(normalizeHeader("बल्लेबाजी"));
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
    expect(result.rows[0]?.phone).toBe("+919876543201");
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
      "Player Name,Mobile Number,WhatsApp Number,Role\nA Player,9000000001,9876543201,Batsman";
    const rows = tokenizeCsv(csv);
    const corrected = applyMapping(rows, { name: 0, phone: 2, role: 3 });
    const result = parseRegistrationRecords(corrected, undefined, { now: NOW });
    expect(result.rows[0]?.phone).toBe("+919876543201");
  });

  it("translates values the organizer taught it", () => {
    const csv = "Player Name,Mobile,Role,Category\nA Player,9876543201,Batsman,Star Player";
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
    const csv = "Player Name,Mobile,Role,Bowling Style\nA Player,9876543201,Batsman";
    const mapped = applyMapping(tokenizeCsv(csv), {
      name: 0,
      phone: 1,
      role: 2,
      bowling_style: 3,
    });
    expect(mapped[1]).toEqual(["A Player", "9876543201", "Batsman", ""]);
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
    const csv = "Player Name,Mobile\n,\nRohit Sharma,9876543201";
    expect(sampleRow(tokenizeCsv(csv))).toEqual(["Rohit Sharma", "9876543201"]);
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
      "Rohit Sharma,9876543201,Batsman,Right,I don't bowl",
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
      "Name,Phone,Role,Bowling Style\nAnil Kumble,9876543201,Bowler,Left Arm Spin",
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
      '"2026/02/05 10:54:08 PM GMT+5:30","Rohit Sharma ","Gurunath Sharma","9876543201","⚔️ Allrounder"',
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
    '"Name","Mobile","Player Type"\n"Rohit, R","9876543201","🏏 Batsman"\n\n"Virat","9876543201","Bowler"';

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
      ["Rohit, R", "+919876543201"],
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

describe("the photo column, found by its answers", () => {
  const link = (n: number) => `https://drive.google.com/open?id=1PhotoFileId000${String(n)}`;
  /** A Form export: header row, then rows built per column. */
  const file = (
    headers: string[],
    cell: (header: string, row: number) => string,
    rows = 4,
  ): string[][] => [
    headers,
    ...Array.from({ length: rows }, (_, row) => headers.map((header) => cell(header, row))),
  ];
  const base = ["Timestamp", "Player Name", "Mobile Number", "Role"];
  const answer = (header: string, row: number): string => {
    if (header === "Player Name") return `Player ${String(row)}`;
    if (header === "Mobile Number") return `98765432${String(10 + row)}`;
    if (header === "Role") return "Batsman";
    if (header === "Timestamp") return "2026/09/24 10:00:00";
    return link(row);
  };
  const photoHeader = (headers: string[], records?: string[][]) =>
    detectMapping(headers, records).columns.find((column) => column.field === "photo_link")
      ?.header ?? null;

  it.each([
    "Upload your recent photo",
    "Please upload your photo",
    "Photo for auction",
    "Upload your passport size photo",
    "Recent Photograph",
    "Upload a clear photo of yourself",
    "Player Image",
    "Profile Picture",
    "File upload",
  ])("maps %s by its Drive links", (question) => {
    const headers = [...base, question];
    expect(photoHeader(headers, file(headers, answer))).toBe(question);
  });

  it("leaves the header-only guess unchanged without the records", () => {
    expect(photoHeader([...base, "Upload a clear photo of yourself"])).toBeNull();
  });

  it("never takes a payment screenshot or an ID card for the photo", () => {
    for (const question of [
      "Upload payment screenshot",
      "Upload Aadhaar card",
      "Aadhar / ID proof",
      "Birth certificate",
      "Transaction receipt",
    ]) {
      const headers = [...base, question];
      expect(photoHeader(headers, file(headers, answer)), question).toBeNull();
    }
  });

  it("prefers the photo-worded upload beside a document upload", () => {
    const headers = [...base, "Upload payment screenshot", "Upload your recent photo"];
    const detected = detectMapping(headers, file(headers, answer));
    expect(photoHeader(headers, file(headers, answer))).toBe("Upload your recent photo");
    expect(detected.conflicts).toEqual([]);
  });

  it("asks rather than guesses when two uploads both look like the photo", () => {
    const headers = [...base, "Front photo", "Side photo"];
    const detected = detectMapping(headers, file(headers, answer));
    expect(detected.columns.some((column) => column.field === "photo_link")).toBe(false);
    expect(detected.conflicts).toEqual([
      { field: "photo_link", headers: ["Front photo", "Side photo"] },
    ]);
  });

  it("does not claim a column that is mostly not Drive links", () => {
    const headers = [...base, "Anything else?"];
    const records = file(headers, (header, row) =>
      header === "Anything else?" ? (row === 0 ? link(0) : "no") : answer(header, row),
    );
    expect(photoHeaderOf(detectMapping(headers, records))).toBeNull();
  });

  it("counts a column where some players skipped the optional upload", () => {
    const headers = [...base, "Upload a clear photo of yourself"];
    const records = file(headers, (header, row) =>
      header.startsWith("Upload") ? (row < 2 ? link(row) : "") : answer(header, row),
    );
    expect(photoHeaderOf(detectMapping(headers, records))).toBe("Upload a clear photo of yourself");
  });

  it("keeps the header match when one exists", () => {
    const headers = [...base, "Player Photo", "Upload a clear photo of yourself"];
    const detected = detectMapping(headers, file(headers, answer));
    expect(photoHeaderOf(detected)).toBe("Player Photo");
    expect(detected.conflicts).toEqual([]);
  });

  it("returns every candidate from photoColumnByValues", () => {
    const headers = [...base, "File upload", "Another file"];
    const detected = detectMapping(headers);
    expect(photoColumnByValues(detected.columns, file(headers, answer))).toEqual([4, 5]);
  });

  function photoHeaderOf(detected: ReturnType<typeof detectMapping>): string | null {
    return detected.columns.find((column) => column.field === "photo_link")?.header ?? null;
  }
});

describe("withDetectedPhoto", () => {
  const headers = ["Player Name", "Mobile Number", "Role", "Upload your recent photo"];
  const records = [
    headers,
    ["Rohit", "9876543201", "Batsman", "https://drive.google.com/open?id=1PhotoFileId0001"],
  ];
  const detected = detectMapping(headers, records);

  it("adds the detected photo column to a mapping saved without one", () => {
    expect(withDetectedPhoto({ name: 0, phone: 1, role: 2 }, detected)).toEqual({
      name: 0,
      phone: 1,
      role: 2,
      photo_link: 3,
    });
  });

  it("never moves a column the saved mapping already uses", () => {
    const saved = { name: 0, phone: 1, role: 2, note: 3 };
    expect(withDetectedPhoto(saved, detected)).toBe(saved);
  });

  it("keeps a saved photo choice", () => {
    const saved = { name: 0, phone: 1, role: 2, photo_link: 2 };
    expect(withDetectedPhoto(saved, detected)).toBe(saved);
  });
});

/*
 * A FOOTBALL CLUB'S FORM.
 *
 * Before the mapping read the pack, "Preferred foot" came back unmapped on
 * every football import: the pack declared `headerAliases` for it and nothing
 * read them, so the column was dropped and the answers with it. SYNTHETIC, in
 * the same Form-export shape as `FORM_CSV`.
 */
const FOOTBALL_FORM_CSV = [
  "Timestamp,Email Address,Player Name,Mobile Number,Playing position,Preferred foot",
  "15/03/2026 14:32:11,sunil@example.com,Sunil Chhetri,9876543201,Forward,Right foot",
  "15/03/2026 14:35:02,gurpreet@example.com,Gurpreet Sandhu,9876543211,Goalkeeper,Righty",
  "15/03/2026 14:41:19,anirudh@example.com,Anirudh Thapa,9876543212,Midfielder,Both feet",
  "15/03/2026 14:44:40,sandesh@example.com,Sandesh Jhingan,9876543213,Defender,Left foot",
  "15/03/2026 14:47:05,sahal@example.com,Sahal Samad,9876543214,Midfielder,N/A",
].join("\n");

describe("a sport's own attributes — found by the pack's headerAliases", () => {
  const records = tokenizeCsv(FOOTBALL_FORM_CSV);
  const headers = records[0] ?? [];

  it("maps a football form's Preferred foot column to the pack's attribute", () => {
    const detected = detectMapping(headers, records, FOOTBALL);
    expect(detected.columns[5]?.field).toBe("attr:preferred_foot");
    expect(detected.missing).toEqual([]);
    expect(detected.conflicts).toEqual([]);
  });

  it("imports the attribute through the option aliases, canonical and 'not me' as blank", () => {
    const mapped = applyMapping(records, mappingOf(detectMapping(headers, records, FOOTBALL)));
    const result = parseRegistrationRecords(mapped, undefined, { now: NOW, pack: FOOTBALL });
    expect(result.errors).toEqual([]);
    expect(result.rows.map((row) => row.attributes)).toEqual([
      { preferred_foot: "right" },
      { preferred_foot: "right" },
      { preferred_foot: "both" },
      { preferred_foot: "left" },
      {},
    ]);
    // Cricket's columns are untouched by a football attribute.
    expect(result.rows.every((row) => row.battingStyle === null)).toBe(true);
  });

  it("writes the parsed answers the way the registration form does", () => {
    const mapped = applyMapping(records, mappingOf(detectMapping(headers, records, FOOTBALL)));
    const [row] = parseRegistrationRecords(mapped, undefined, { now: NOW, pack: FOOTBALL }).rows;
    expect(splitAttributeWrite(FOOTBALL, row?.attributes ?? {})).toEqual({
      columns: {},
      json: { preferred_foot: "right" },
    });
  });

  it("refuses a value it cannot place, by column, and offers the pack's options", () => {
    const odd = tokenizeCsv(
      [
        "Player Name,Mobile Number,Position,Strong foot",
        "Sunil Chhetri,9876543201,Forward,Rightish",
      ].join("\n"),
    );
    const mapping = mappingOf(detectMapping(odd[0] ?? [], odd, FOOTBALL));
    expect(mapping["attr:preferred_foot"]).toBe(3);
    const mapped = applyMapping(odd, mapping);
    const result = parseRegistrationRecords(mapped, undefined, { now: NOW, pack: FOOTBALL });
    expect(result.errors).toEqual([
      {
        line: 2,
        name: "Sunil Chhetri",
        message: 'unknown preferred foot "Rightish"',
        fields: ["attr:preferred_foot"],
      },
    ]);
    const unplaced = unplacedValues(mapped, { pack: FOOTBALL, bands: [], teams: [] });
    expect(unplaced).toEqual([
      {
        field: "attr:preferred_foot",
        fieldLabel: "Preferred foot",
        value: "Rightish",
        rows: 1,
        options: [
          { value: "right", label: "Right footed" },
          { value: "left", label: "Left footed" },
          { value: "both", label: "Both feet" },
        ],
      },
    ]);
    // The organizer's answer in the value mapper lets the row in.
    const fixed = applyMapping(odd, mapping, { "attr:preferred_foot": { rightish: "right" } });
    const retried = parseRegistrationRecords(fixed, undefined, { now: NOW, pack: FOOTBALL });
    expect(retried.errors).toEqual([]);
    expect(retried.rows[0]?.attributes).toEqual({ preferred_foot: "right" });
  });

  it("finds every racquet and court pack's attribute by its own wording", () => {
    const cases: [string, string, string, string][] = [
      ["volleyball", "Spiking hand", "Lefty", "attr:spiking_hand"],
      ["table_tennis", "Grip style", "Penhold", "attr:grip"],
      ["badminton", "Racket hand", "Left handed", "attr:playing_hand"],
      ["pickleball", "Paddle hand", "Right handed", "attr:playing_hand"],
    ];
    for (const [sport, header, answer, field] of cases) {
      const pack = sportPackFor(sport);
      expect(pack.key).toBe(sport);
      const role = pack.roles.values[0]?.label ?? "";
      const file = tokenizeCsv(
        `Player Name,Mobile Number,Position,${header}\nAsha Rao,9876543201,${role},${answer}`,
      );
      const mapping = mappingOf(detectMapping(file[0] ?? [], file, pack));
      expect(mapping[field as MappableField], `${sport}: ${header}`).toBe(3);
      const [row] = parseRegistrationRecords(applyMapping(file, mapping), undefined, { pack }).rows;
      expect(Object.values(row?.attributes ?? {}), `${sport}: ${answer}`).toHaveLength(1);
    }
  });

  it("offers the attribute on the mapping screen, labelled by the pack", () => {
    const football = importFieldsFor(FOOTBALL);
    expect(football.at(-1)).toEqual({
      field: "attr:preferred_foot",
      label: "Preferred foot",
      required: false,
    });
    expect(importFieldLabel("attr:preferred_foot", FOOTBALL)).toBe("Preferred foot");
  });

  it("ignores an attribute column the season's pack does not declare", () => {
    // A football season's saved mapping reused for a cricket one: nowhere to
    // store the answer, so it is dropped rather than failing every row.
    const mapped = applyMapping(records, mappingOf(detectMapping(headers, records, FOOTBALL)));
    const result = parseRegistrationRecords(
      mapped.map((record, index) =>
        index === 0 ? record : [...record.slice(0, 2), "batter", ...record.slice(3)],
      ),
      undefined,
      { now: NOW },
    );
    expect(result.errors).toEqual([]);
    expect(result.rows.every((row) => Object.keys(row.attributes).length === 0)).toBe(true);
  });
});

describe("cricket imports exactly as it did", () => {
  const records = tokenizeCsv(FORM_CSV);
  const headers = records[0] ?? [];

  it("detects the same mapping with the cricket pack as with none", () => {
    expect(detectMapping(headers, records, CRICKET)).toEqual(detectMapping(headers, records));
    expect(mappingOf(detectMapping(headers, records, CRICKET))).toEqual({
      name: 2,
      phone: 3,
      role: 4,
      date_of_birth: 5,
      batting_style: 6,
      bowling_style: 7,
    });
  });

  it("adds no attribute fields — its styles are the fixed columns", () => {
    expect(importFieldsFor(CRICKET).map((option) => option.field)).toEqual([...IMPORT_FIELDS]);
    expect(importFieldsFor(sportPackFor("box_cricket")).map((option) => option.field)).toEqual([
      ...IMPORT_FIELDS,
    ]);
  });

  it("still leaves a football column unmapped in a cricket season", () => {
    const file = tokenizeCsv(
      "Player Name,Mobile Number,Role,Preferred foot\nA B C,9876543201,Batsman,Left",
    );
    expect(detectMapping(file[0] ?? [], file, CRICKET).columns[3]?.field).toBeNull();
  });

  it("parses styles into their columns and leaves attributes empty", () => {
    const mapped = applyMapping(records, mappingOf(detectMapping(headers, records, CRICKET)));
    const result = parseRegistrationRecords(mapped, undefined, { now: NOW, pack: CRICKET });
    expect(result.rows.map((row) => [row.battingStyle, row.bowlingStyle, row.attributes])).toEqual([
      ["right_hand", "off_break", {}],
      ["right_hand", "right_arm_fast", {}],
      ["left_hand", null, {}],
    ]);
  });
});
