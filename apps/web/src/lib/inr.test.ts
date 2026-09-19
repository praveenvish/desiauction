import { describe, expect, it } from "vitest";

import { compactINR, exactINR } from "./inr";

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
