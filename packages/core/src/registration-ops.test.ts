import { describe, expect, it } from "vitest";

import {
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

describe("parseRegistrationCsv — validate before writing, reject partial corruption", () => {
  const HEADER = "name,phone,role,base_price_band";

  it("parses a clean file into normalized rows", () => {
    const csv = `${HEADER}\nRohit Sharma,9876543210,batter,A\nJasprit Bumrah,+91 98765 43211,bowler,`;
    const result = parseRegistrationCsv(csv);
    expect(result.errors).toEqual([]);
    expect(result.rows).toEqual([
      { line: 2, name: "Rohit Sharma", phone: "+919876543210", role: "batter", basePriceBand: "A" },
      {
        line: 3,
        name: "Jasprit Bumrah",
        phone: "+919876543211",
        role: "bowler",
        basePriceBand: null,
      },
    ]);
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
