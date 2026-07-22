import { describe, expect, it } from "vitest";

import { normalizeShareSource } from "./attribution";

describe("normalizeShareSource", () => {
  it("passes recognized sources through", () => {
    expect(normalizeShareSource("whatsapp")).toBe("whatsapp");
    expect(normalizeShareSource("player")).toBe("player");
    expect(normalizeShareSource("recruit")).toBe("recruit");
  });

  it("trims and lowercases", () => {
    expect(normalizeShareSource("  WhatsApp ")).toBe("whatsapp");
    expect(normalizeShareSource("QR")).toBe("qr");
  });

  it("maps common aliases to canonical sources", () => {
    expect(normalizeShareSource("twitter")).toBe("x");
    expect(normalizeShareSource("fb")).toBe("facebook");
    expect(normalizeShareSource("wa")).toBe("whatsapp");
    expect(normalizeShareSource("ig")).toBe("instagram");
  });

  it("collapses absent sources to direct", () => {
    expect(normalizeShareSource(null)).toBe("direct");
    expect(normalizeShareSource(undefined)).toBe("direct");
    expect(normalizeShareSource("")).toBe("direct");
    expect(normalizeShareSource("   ")).toBe("direct");
  });

  it("bounds unknown / hostile input to 'other' (never stored raw)", () => {
    expect(normalizeShareSource("myspace")).toBe("other");
    expect(normalizeShareSource("<script>alert(1)</script>")).toBe("other");
    expect(normalizeShareSource("a".repeat(5000))).toBe("other");
  });
});
