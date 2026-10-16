import { describe, expect, it } from "vitest";

import { looksLikePlaceholderPhone } from "./placeholder-phone";
import { parseRegistrationCsv } from "./registration-csv";

describe("looksLikePlaceholderPhone — numbers typed to fill a cell", () => {
  it("flags long runs of one digit", () => {
    expect(looksLikePlaceholderPhone("+919000000001")).toBe(true);
    expect(looksLikePlaceholderPhone("+919000000106")).toBe(true);
    expect(looksLikePlaceholderPhone("+919999999999")).toBe(true);
    expect(looksLikePlaceholderPhone("+918888888888")).toBe(true);
  });

  it("flags keyboard walks", () => {
    expect(looksLikePlaceholderPhone("+919876543210")).toBe(true);
    expect(looksLikePlaceholderPhone("+919123456789")).toBe(true);
  });

  it("leaves real-looking numbers alone", () => {
    expect(looksLikePlaceholderPhone("+918209534597")).toBe(false);
    expect(looksLikePlaceholderPhone("+919812345670")).toBe(false);
    // Five in a row is a number a real person can own.
    expect(looksLikePlaceholderPhone("+919800000123")).toBe(false);
  });
});

/*
 * BPL4's master sheet: 106 of 156 rows carried 9000000001…9000000106 so every
 * row had a number. Stored, each would have been a platform-wide identity that
 * whoever owns the real number could sign in as.
 */
describe("the import never stores a filler", () => {
  const csv = [
    "name,phone",
    "अरविंद बिश्नोई,9000000001",
    "दिनेश पंवार,9000000002",
    "रवि बिश्नोई,8209534597",
  ].join("\n");

  it("imports the row with no phone and lists the number it set aside", () => {
    const result = parseRegistrationCsv(csv);
    expect(result.errors).toEqual([]);
    expect(result.rows.map((row) => row.phone)).toEqual([null, null, "+918209534597"]);
    expect(result.placeholders).toEqual([
      { line: 2, name: "अरविंद बिश्नोई", phone: "+919000000001" },
      { line: 3, name: "दिनेश पंवार", phone: "+919000000002" },
    ]);
  });

  it("keeps a flagged number the organizer vouched for as real", () => {
    const result = parseRegistrationCsv(csv, undefined, { realPhones: ["+919000000002"] });
    expect(result.rows.map((row) => row.phone)).toEqual([null, "+919000000002", "+918209534597"]);
    expect(result.placeholders.map((entry) => entry.line)).toEqual([2]);
  });

  it("does not call two players with one filler a duplicate", () => {
    const result = parseRegistrationCsv(
      "name,phone\nAmit Kumar,9999999999\nSunil Kumar,9999999999",
    );
    expect(result.errors).toEqual([]);
    expect(result.rows.every((row) => row.phone === null)).toBe(true);
  });
});
