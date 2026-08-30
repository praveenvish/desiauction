import { describe, expect, it } from "vitest";

import { planImport, planImportRow, type ExistingRegistration } from "./import-diff";
import { parseRegistrationCsv, type CsvRegistrationRow } from "./registration-csv";

const NOW = new Date("2026-08-30T00:00:00Z");

/** One parsed row from a file, so the tests exercise the real row shape. */
function fileRow(csvLine: string, header = "name,phone,role"): CsvRegistrationRow {
  const result = parseRegistrationCsv(`${header}\n${csvLine}`, undefined, { now: NOW });
  const row = result.rows[0];
  if (row === undefined) {
    throw new Error(`fixture did not parse: ${JSON.stringify(result.errors)}`);
  }
  return row;
}

/** A stored registration, with everything blank unless the test says otherwise. */
function stored(overrides: Partial<ExistingRegistration> = {}): ExistingRegistration {
  return {
    status: "submitted",
    role: "batter",
    basePriceBand: null,
    dateOfBirth: null,
    battingStyle: null,
    bowlingStyle: null,
    feeStatus: "pending",
    feeAmountPaise: null,
    feeReference: null,
    note: null,
    fatherName: null,
    jerseyName: null,
    jerseyNumber: null,
    tshirtSize: null,
    trouserSize: null,
    ...overrides,
  };
}

describe("planImportRow — what the second file would actually do", () => {
  it("calls a player nobody has registered new", () => {
    expect(planImportRow(fileRow("Rohit Sharma,9876543210,batter"), null, "fill-blanks")).toEqual({
      kind: "new",
    });
  });

  it("calls a row that changes nothing unchanged", () => {
    const plan = planImportRow(
      fileRow("Rohit Sharma,9876543210,batter"),
      stored({ role: "batter" }),
      "fill-blanks",
    );
    expect(plan).toEqual({ kind: "unchanged" });
  });

  it("fills a blank the record never had", () => {
    const row = fileRow("Rohit Sharma,9876543210,batter,L", "name,phone,role,tshirt_size");
    const plan = planImportRow(row, stored(), "fill-blanks");
    expect(plan).toEqual({
      kind: "changed",
      changes: [{ field: "tshirtSize", label: "T-shirt size", from: null, to: "L" }],
    });
  });

  /*
   * RULE 2, AND THE REASON IT IS THE DEFAULT. The organizer fixed the size in
   * the app; the club's sheet still holds the old one. Under the default the
   * hand correction stands.
   */
  it("does not overwrite a value somebody already set, by default", () => {
    const row = fileRow("Rohit Sharma,9876543210,batter,L", "name,phone,role,tshirt_size");
    expect(planImportRow(row, stored({ tshirtSize: "XL" }), "fill-blanks")).toEqual({
      kind: "unchanged",
    });
  });

  it("overwrites it when the organizer asked for the file to win", () => {
    const row = fileRow("Rohit Sharma,9876543210,batter,L", "name,phone,role,tshirt_size");
    expect(planImportRow(row, stored({ tshirtSize: "XL" }), "file-wins")).toEqual({
      kind: "changed",
      changes: [{ field: "tshirtSize", label: "T-shirt size", from: "XL", to: "L" }],
    });
  });

  /*
   * RULE 1. A form with no jersey question must not blank the sizes somebody
   * typed in — even under file-wins, because the file did not say "empty", it
   * said nothing at all.
   */
  it("never erases a field the file does not carry, under either policy", () => {
    const row = fileRow("Rohit Sharma,9876543210,batter");
    for (const policy of ["fill-blanks", "file-wins"] as const) {
      expect(planImportRow(row, stored({ tshirtSize: "XL", note: "paid cash" }), policy)).toEqual({
        kind: "unchanged",
      });
    }
  });

  it("treats a whitespace-only cell as not supplied", () => {
    const row = fileRow('Rohit Sharma,9876543210,batter,"   "', "name,phone,role,tshirt_size");
    expect(planImportRow(row, stored({ tshirtSize: "XL" }), "file-wins")).toEqual({
      kind: "unchanged",
    });
  });

  /* RULE 3. */
  it("leaves an approved player approved and a rejection standing", () => {
    const row = fileRow("Rohit Sharma,9876543210,bowler");
    for (const status of ["approved", "rejected", "waitlisted"]) {
      const plan = planImportRow(row, stored({ status, role: "batter" }), "file-wins");
      // The role may change; the STATUS is never part of the plan at all.
      expect(plan.kind).toBe("changed");
      expect(JSON.stringify(plan)).not.toContain("status");
    }
  });

  it("reinstates a withdrawn player — the one status a file may move", () => {
    const row = fileRow("Rohit Sharma,9876543210,batter");
    expect(planImportRow(row, stored({ status: "withdrawn" }), "fill-blanks")).toEqual({
      kind: "reinstate",
      changes: [],
    });
  });

  it("carries the file's updates through a reinstatement", () => {
    const row = fileRow("Rohit Sharma,9876543210,all_rounder");
    const plan = planImportRow(row, stored({ status: "withdrawn", role: "batter" }), "file-wins");
    expect(plan).toEqual({
      kind: "reinstate",
      changes: [{ field: "role", label: "Playing role", from: "batter", to: "all_rounder" }],
    });
  });

  it("compares a fee by its stored paise, not its written rupees", () => {
    const row = fileRow("Rohit Sharma,9876543210,batter,500", "name,phone,role,fee_amount");
    // Already 50000 paise = the ₹500 the file names: nothing to do.
    expect(planImportRow(row, stored({ feeAmountPaise: 50000 }), "file-wins")).toEqual({
      kind: "unchanged",
    });
    expect(planImportRow(row, stored({ feeAmountPaise: 25000 }), "file-wins")).toEqual({
      kind: "changed",
      changes: [{ field: "feeAmountPaise", label: "Fee amount", from: "25000", to: "50000" }],
    });
  });
});

describe("planImport — the whole file, counted", () => {
  it("counts what the organizer is about to do", () => {
    const csv = [
      "name,phone,role,tshirt_size",
      "New Player,9876543210,batter,L",
      "Same Player,9876543211,batter,",
      "Changed Player,9876543212,bowler,M",
      "Back Player,9876543213,batter,",
    ].join("\n");
    const rows = parseRegistrationCsv(csv, undefined, { now: NOW }).rows;
    const existing = new Map<string, ExistingRegistration>([
      ["+919876543211", stored({ role: "batter" })],
      ["+919876543212", stored({ role: "batter" })],
      ["+919876543213", stored({ status: "withdrawn" })],
    ]);
    const diff = planImport(rows, existing, "file-wins");
    expect(diff.counts).toEqual({ new: 1, changed: 1, unchanged: 1, reinstate: 1 });
    expect(diff.rows.map((r) => r.plan.kind)).toEqual(["new", "unchanged", "changed", "reinstate"]);
    // Every planned row still names its source line, so a preview can point at it.
    expect(diff.rows.map((r) => r.line)).toEqual([2, 3, 4, 5]);
  });
});
