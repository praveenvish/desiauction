import { describe, expect, it } from "vitest";

import { thumbInitials } from "./tournament-card";

describe("thumbInitials", () => {
  it("takes the first letters of the first two words", () => {
    expect(thumbInitials("Monsoon Cup 54609268")).toBe("MC");
  });

  it("skips words that start with a number", () => {
    expect(thumbInitials("2026 Thane Premier League")).toBe("TP");
  });

  it("gives a single word its first two letters", () => {
    expect(thumbInitials("TPL 2026")).toBe("TP");
  });

  it("falls back to the raw name when no word starts with a letter", () => {
    expect(thumbInitials("2026")).toBe("20");
  });
});
