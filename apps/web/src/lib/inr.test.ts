import { describe, expect, it } from "vitest";

import { compactFloorINR, compactINR, exactINR, ledgerINR } from "./inr";

describe("inr", () => {
  it("groups the exact figure the Indian way", () => {
    expect(exactINR(1_20_00_000_00)).toBe("₹1,20,00,000");
    expect(exactINR(0)).toBe("₹0");
  });

  it("shortens to crore and lakh at their thresholds, and not below", () => {
    expect(compactINR(1_20_00_000_00)).toBe("₹1.2 Cr");
    expect(compactINR(52_00_000_00)).toBe("₹52 L");
    expect(compactINR(99_999_00)).toBe("₹99,999");
    expect(compactINR(1_00_000_00)).toBe("₹1 L");
  });
});

describe("compactFloorINR — money that is left never rounds up", () => {
  it("shows a spent purse as less than full", () => {
    expect(compactFloorINR(1_999_800_000)).toBe("₹1.99 Cr");
    expect(compactFloorINR(2_000_000_000)).toBe("₹2 Cr");
    expect(compactFloorINR(4_999_999)).toBe("₹49,999");
  });
});

describe("ledgerINR — books show the recorded figure", () => {
  it("keeps every paisa, grouped the Indian way", () => {
    expect(ledgerINR(7_431_250_50)).toBe("₹74,31,250.50");
    expect(ledgerINR(5_000_000)).toBe("₹50,000");
    expect(ledgerINR(1)).toBe("₹0.01");
  });
});
