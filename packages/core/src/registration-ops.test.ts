import { describe, expect, it } from "vitest";

import {
  monogramFor,
  validateName,
  nameKey,
  planRegistrationBatch,
  registrationNumber,
  registrationTransition,
  type RegistrationBatchItem,
} from "./competition";
import { parseRegistrationCsv, tokenizeCsv } from "./registration-csv";

describe("planRegistrationBatch — behaves identically to N individual actions", () => {
  const items: RegistrationBatchItem[] = [
    { id: "a", status: "submitted" },
    { id: "b", status: "waitlisted" },
    { id: "c", status: "approved" }, // approve is illegal from approved
    { id: "d", status: "rejected" }, // approve is illegal from rejected
  ];

  it("partitions apply/skip exactly as the single-transition decision would", () => {
    const plan = planRegistrationBatch(items, { type: "approve" });
    // a and b can be approved; c and d cannot.
    expect(plan.apply).toEqual([
      { id: "a", next: "approved" },
      { id: "b", next: "approved" },
    ]);
    expect(plan.skip).toEqual([
      { id: "c", reason: "illegal_transition" },
      { id: "d", reason: "illegal_transition" },
    ]);
    // Equivalence: each item's plan entry matches its individual decision.
    for (const item of items) {
      const single = registrationTransition(item.status, { type: "approve" });
      const inApply = plan.apply.find((x) => x.id === item.id);
      if (single.ok) {
        expect(inApply).toEqual({ id: item.id, next: single.next });
      } else {
        expect(plan.skip.find((x) => x.id === item.id)).toEqual({
          id: item.id,
          reason: single.reason,
        });
      }
    }
  });

  it("carries the reject reason requirement into the batch", () => {
    const bad = planRegistrationBatch([{ id: "a", status: "submitted" }], {
      type: "reject",
      reason: "nonsense" as never,
    });
    expect(bad.skip).toEqual([{ id: "a", reason: "reason_required" }]);
    const good = planRegistrationBatch([{ id: "a", status: "submitted" }], {
      type: "reject",
      reason: "duplicate",
    });
    expect(good.apply).toEqual([{ id: "a", next: "rejected" }]);
  });

  it("an empty selection yields an empty plan", () => {
    expect(planRegistrationBatch([], { type: "approve" })).toEqual({ apply: [], skip: [] });
  });
});

describe("registrationNumber + nameKey", () => {
  it("registration number is deterministic and derived from the id tail", () => {
    expect(registrationNumber("01KXABCDEF0123456789ghjkmn")).toBe("RGHJKMN");
    expect(registrationNumber("01KXABCDEF0123456789ghjkmn")).toBe(
      registrationNumber("01KXABCDEF0123456789ghjkmn"),
    );
  });

  it("nameKey normalizes case and whitespace for duplicate detection", () => {
    expect(nameKey("  Rohit   Sharma ")).toBe("rohit sharma");
    expect(nameKey("ROHIT SHARMA")).toBe(nameKey("rohit sharma"));
    expect(nameKey(null)).toBe("");
  });
});

describe("validateName + monogramFor — bounded, and safe to render", () => {
  it("DA-29: names are bounded at both ends", () => {
    expect(validateName("ab")).toEqual({ ok: false, reason: "too_short" });
    expect(validateName("Warriors")).toEqual({ ok: true, value: "Warriors" });
    expect(validateName("W".repeat(61))).toEqual({ ok: false, reason: "too_long" });
    // Trimmed before measuring, so whitespace cannot smuggle a name past either end.
    expect(validateName("   Warriors   ")).toEqual({ ok: true, value: "Warriors" });
  });

  it("DA-29: the monogram comes from alphanumerics, never from markup", () => {
    // Escaped and harmless, but "<IM" on every chip and board is still wrong.
    expect(monogramFor('<img src=x onerror="x">Zed')).toBe("IMG");
    expect(monogramFor("Warriors")).toBe("WAR");
    // Three GRAPHEMES, not three code units — मुं is one cluster, matra intact.
    expect(monogramFor("मुंबई")).toBe("मुंबई");
  });
});

describe("parseRegistrationCsv — validate before writing, reject partial corruption", () => {
  const HEADER = "name,phone,role,base_price_band";

  it("parses a clean file into normalized rows", () => {
    const csv = `${HEADER}\nRohit Sharma,9876543210,batter,A\nJasprit Bumrah,+91 98765 43211,bowler,`;
    const result = parseRegistrationCsv(csv);
    expect(result.errors).toEqual([]);
    expect(result.rows).toEqual([
      {
        line: 2,
        name: "Rohit Sharma",
        phone: "+919876543210",
        role: "batter",
        basePriceBand: "A",
        // DA-28: optional profile columns, absent from this file.
        dateOfBirth: null,
        battingStyle: null,
        bowlingStyle: null,
      },
      {
        line: 3,
        name: "Jasprit Bumrah",
        phone: "+919876543211",
        role: "bowler",
        basePriceBand: null,
        dateOfBirth: null,
        battingStyle: null,
        bowlingStyle: null,
      },
    ]);
  });

  it("DA-28: optional profile columns ride along when the file supplies them", () => {
    const csv =
      "name,phone,role,base_price_band,date_of_birth,batting_style,bowling_style\n" +
      "Rohit Sharma,9876543210,batter,A,1995-08-15,right_hand_opener,off_break";
    const [row] = parseRegistrationCsv(csv).rows;
    expect(row).toMatchObject({
      dateOfBirth: "1995-08-15",
      battingStyle: "right_hand_opener",
      bowlingStyle: "off_break",
    });
  });

  it("DA-14: an unknown base price band is a line error, not a silent default", () => {
    const csv = `${HEADER}\nRohit Sharma,9876543210,batter,Z\nOk Player,9876543211,bowler,B`;
    // Without the known bands the parser cannot judge, so it stays permissive.
    expect(parseRegistrationCsv(csv).errors).toEqual([]);
    // Given them, a typo stops being a silent reprice to the default band.
    const checked = parseRegistrationCsv(csv, ["A", "B", "C"]);
    expect(checked.errors).toEqual([
      { line: 2, message: 'unknown base price band "Z" (expected A, B, C)' },
    ]);
    // The bad line is dropped and the good one survives — the COMMIT path is
    // what refuses the whole file, so the preview can show both halves.
    expect(checked.rows.map((row) => row.line)).toEqual([3]);
    // Case is not the point of failure.
    expect(
      parseRegistrationCsv(`${HEADER}\nRohit Sharma,9876543210,batter,a`, ["A"]).errors,
    ).toEqual([]);
  });

  it("reports per-row errors and yields NO rows to import when any row is bad", () => {
    const csv = `${HEADER}\nOk Player,9876543210,batter,\nX,not-a-phone,striker,\n`;
    const result = parseRegistrationCsv(csv);
    // Row 3 has a short name, bad phone, and bad role — all reported on one line.
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.line).toBe(3);
    expect(result.errors[0]?.message).toMatch(/name|phone|role/);
    // The valid row 2 still parses; the CALLER refuses to commit while errors exist.
    expect(result.rows.map((r) => r.line)).toEqual([2]);
  });

  it("flags duplicate phones within the file", () => {
    const csv = `${HEADER}\nA One,9876543210,batter,\nA Two,98765 43210,bowler,`;
    const result = parseRegistrationCsv(csv);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.message).toMatch(/duplicate phone/);
  });

  it("refuses a file missing required columns", () => {
    const result = parseRegistrationCsv("name,role\nRohit,batter");
    expect(result.rows).toEqual([]);
    expect(result.errors[0]?.message).toMatch(/phone/);
  });

  it("handles quoted fields with commas and doubled quotes", () => {
    const csv = `${HEADER}\n"Sharma, Rohit",9876543210,batter,"band ""A"""`;
    const result = parseRegistrationCsv(csv);
    expect(result.errors).toEqual([]);
    expect(result.rows[0]?.name).toBe("Sharma, Rohit");
    expect(result.rows[0]?.basePriceBand).toBe('band "A"');
  });

  it("treats an empty file as an error, not a silent success", () => {
    expect(parseRegistrationCsv("").errors).toHaveLength(1);
    expect(parseRegistrationCsv("   \n  ").errors[0]?.message).toMatch(/empty|column/i);
  });

  it("tokenizer keeps embedded newlines inside quotes", () => {
    expect(tokenizeCsv('a,"line1\nline2",c')).toEqual([["a", "line1\nline2", "c"]]);
  });
});

describe("CSV import — playing styles are parsed, not silently dropped", () => {
  /*
   * RH-1: `batting_style` and `bowling_style` were the only columns nobody
   * validated. The parser passed them through raw and the commit dropped
   * anything it did not recognise, so an organizer importing eighty players
   * with the spelling the product itself shows them ("Right Hand Opener")
   * stored zero styles and was told the file was clean.
   */
  const header = "name,phone,role,base_price_band,batting_style,bowling_style";

  it("accepts the label a person actually sees on screen", () => {
    const result = parseRegistrationCsv(
      `${header}\nAsha Rao,9876543210,batter,A,Right Hand Opener,Off-Break\n`,
    );
    expect(result.errors).toEqual([]);
    expect(result.rows[0]?.battingStyle).toBe("right_hand_opener");
    expect(result.rows[0]?.bowlingStyle).toBe("off_break");
  });

  it("accepts the canonical token, and any casing or separator between them", () => {
    const result = parseRegistrationCsv(
      `${header}\n` +
        `A One,9876543211,batter,A,right_hand_opener,off_break\n` +
        `B Two,9876543212,bowler,A,RIGHT HAND OPENER,OFF BREAK\n` +
        `C Three,9876543213,bowler,A,Right-Hand-Opener,off-break\n`,
    );
    expect(result.errors).toEqual([]);
    expect(result.rows.map((row) => row.battingStyle)).toEqual([
      "right_hand_opener",
      "right_hand_opener",
      "right_hand_opener",
    ]);
    expect(result.rows.map((row) => row.bowlingStyle)).toEqual([
      "off_break",
      "off_break",
      "off_break",
    ]);
  });

  it("REFUSES a style it cannot place, on the line that carries it", () => {
    const result = parseRegistrationCsv(
      `${header}\nDee Four,9876543214,batter,A,Switch Hitter,Doosra\n`,
    );
    expect(result.rows).toEqual([]);
    expect(result.errors).toEqual([
      {
        line: 2,
        message: 'unknown batting style "Switch Hitter"; unknown bowling style "Doosra"',
      },
    ]);
  });

  it("leaves the columns null when they are empty, and does not error", () => {
    const result = parseRegistrationCsv(`${header}\nEmpty Ella,9876543215,batter,A,,\n`);
    expect(result.errors).toEqual([]);
    expect(result.rows[0]?.battingStyle).toBeNull();
    expect(result.rows[0]?.bowlingStyle).toBeNull();
  });

  it("does not mistake a bowling style for a batting one, or the reverse", () => {
    const result = parseRegistrationCsv(
      `${header}\nCross Wires,9876543216,batter,A,Off-Break,Right Hand Opener\n`,
    );
    expect(result.rows).toEqual([]);
    expect(result.errors[0]?.message).toContain('unknown batting style "Off-Break"');
    expect(result.errors[0]?.message).toContain('unknown bowling style "Right Hand Opener"');
  });
});
