import { describe, expect, it } from "vitest";

import {
  addPaise,
  deductPaise,
  formatPaiseINR,
  paise,
  parseFeeStatus,
  parsePaise,
  parseRupeesToPaise,
} from "./money.js";

describe("paise", () => {
  it("accepts non-negative safe integers", () => {
    expect(paise(0)).toBe(0);
    expect(paise(110500000)).toBe(110500000);
  });

  it("rejects negatives, fractions and unsafe integers", () => {
    expect(() => paise(-1)).toThrow(TypeError);
    expect(() => paise(1.5)).toThrow(TypeError);
    expect(() => paise(Number.MAX_SAFE_INTEGER + 1)).toThrow(TypeError);
  });
});

describe("addPaise", () => {
  it("adds", () => {
    expect(addPaise(paise(100), paise(50))).toBe(150);
  });
});

describe("deductPaise", () => {
  it("deducts within balance", () => {
    expect(deductPaise(paise(500), paise(200))).toEqual({ ok: true, value: 300 });
  });

  it("returns insufficiency as a value, never a negative purse", () => {
    expect(deductPaise(paise(100), paise(200))).toEqual({ ok: false, reason: "insufficient" });
  });
});

describe("formatPaiseINR", () => {
  it("groups rupees in Indian notation", () => {
    expect(formatPaiseINR(paise(0))).toBe("₹0");
    expect(formatPaiseINR(paise(99900))).toBe("₹999");
    expect(formatPaiseINR(paise(100000))).toBe("₹1,000");
    expect(formatPaiseINR(paise(110500000))).toBe("₹11,05,000");
    expect(formatPaiseINR(paise(11050000000))).toBe("₹11,05,00,000");
  });

  it("preserves exact paise remainders", () => {
    expect(formatPaiseINR(paise(150))).toBe("₹1.50");
    expect(formatPaiseINR(paise(100005))).toBe("₹1,000.05");
  });
});

describe("parseRupeesToPaise — an entry fee as a club writes it", () => {
  it("reads rupees into paise", () => {
    expect(parseRupeesToPaise("500")).toEqual({ ok: true, value: 50000 });
    expect(parseRupeesToPaise("1500.50")).toEqual({ ok: true, value: 150050 });
    expect(parseRupeesToPaise("0")).toEqual({ ok: true, value: 0 });
  });

  it("tolerates the decoration a spreadsheet cell carries", () => {
    for (const input of ["₹500", "Rs 500", "Rs. 500", "INR 500", "1,500", "500 /-", "  500  "]) {
      const result = parseRupeesToPaise(input);
      expect(result.ok).toBe(true);
    }
    expect(parseRupeesToPaise("1,500")).toEqual({ ok: true, value: 150000 });
  });

  it("pads a single decimal place rather than misreading it", () => {
    // "500.5" is five hundred rupees fifty paise, not five paise.
    expect(parseRupeesToPaise("500.5")).toEqual({ ok: true, value: 50050 });
  });

  /*
   * A third decimal is a typo, and rounding money silently is the one failure
   * nobody forgives — so it is refused and reported on its line.
   */
  it("refuses more precision than money has", () => {
    expect(parseRupeesToPaise("500.123")).toEqual({ ok: false, reason: "invalid" });
  });

  it("refuses negatives and junk", () => {
    for (const input of ["-500", "abc", "", "500rs", "5 0 0", "₹"]) {
      expect(parseRupeesToPaise(input)).toEqual({ ok: false, reason: "invalid" });
    }
  });

  it("stays separate from parsePaise, which reads OUR stored value", () => {
    // The same string means different amounts through the two doors, which is
    // exactly why they are two doors: "500" stored is 500 paise; "500" typed
    // into a fee column is 500 rupees.
    expect(parsePaise("500")).toEqual({ ok: true, value: 500 });
    expect(parseRupeesToPaise("500")).toEqual({ ok: true, value: 50000 });
  });
});

describe("parseFeeStatus — a 'Paid?' column answered by a human", () => {
  it("reads the four states and the words people use for them", () => {
    expect(parseFeeStatus("Paid")).toBe("paid");
    expect(parseFeeStatus("YES")).toBe("paid");
    expect(parseFeeStatus("Not Paid")).toBe("pending");
    expect(parseFeeStatus("no")).toBe("pending");
    expect(parseFeeStatus("Waived")).toBe("waived");
    expect(parseFeeStatus("Refund")).toBe("refunded");
  });

  it("returns null rather than defaulting somebody to paid", () => {
    for (const input of ["", "maybe", "partial", "half"]) {
      expect(parseFeeStatus(input)).toBeNull();
    }
  });
});
