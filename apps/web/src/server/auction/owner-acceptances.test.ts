import { describe, expect, it } from "vitest";

import { formatPhone } from "../../lib/format-phone";
import { maskEmail, maskPhone } from "./owner-acceptances";

// An appointed auctioneer sees owners' contacts masked (go-live gate P3):
// enough to tell two accepted rows apart, not enough to ring anyone.
describe("owner contact masking", () => {
  it("keeps the last four digits of a phone and nothing else", () => {
    expect(maskPhone("+919876543210")).toBe("••••••3210");
    expect(maskPhone("+919876543210")).not.toContain("98765");
    expect(maskPhone(null)).toBeNull();
    expect(maskPhone("12")).toBe("••••");
  });

  it("renders through formatPhone unchanged — the panel formats what it is given", () => {
    expect(formatPhone(maskPhone("+919876543210") ?? "")).toBe("••••••3210");
  });

  it("keeps an email's domain only", () => {
    expect(maskEmail("owner.name@example.com")).toBe("…@example.com");
    expect(maskEmail("no-at-sign")).toBe("…");
    expect(maskEmail(null)).toBeNull();
  });
});
