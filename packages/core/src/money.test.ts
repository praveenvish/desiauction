import { describe, expect, it } from "vitest";

import { addPaise, deductPaise, formatPaiseINR, paise } from "./money.js";

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
