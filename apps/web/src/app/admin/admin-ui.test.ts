import { describe, expect, it } from "vitest";

import { foldRuns, humanAction, relativeAge } from "./admin-ui";

describe("humanAction", () => {
  it("reads a known code as the sentence an operator would say", () => {
    expect(humanAction("auth.login.otp")).toBe("Signed in with a code");
  });

  it("spells an unknown code out, splitting dots and camel case", () => {
    expect(humanAction("finops.CertificationDerived")).toBe("Finops certification derived");
    expect(humanAction("auction:stuck-live")).toBe("Auction stuck live");
  });
});

describe("foldRuns", () => {
  it("folds consecutive equal rows, keeps order and every count", () => {
    const rows = ["a", "a", "b", "a", "a", "a"];
    expect(foldRuns(rows, (x, y) => x === y)).toEqual([
      { row: "a", count: 2 },
      { row: "b", count: 1 },
      { row: "a", count: 3 },
    ]);
  });
});

describe("relativeAge", () => {
  const now = Date.parse("2026-09-26T12:00:00Z");
  const HOUR = 3_600_000;

  it("floors a past age, so /admin and the erasure desk count the same days", () => {
    // Asked 2026-09-18 22:00 UTC: 7 days and 14 hours ago. Rounding said 8d.
    expect(relativeAge(now - (7 * 24 + 14) * HOUR, now)).toBe("7d ago");
    expect(relativeAge(now - 90 * 60_000, now)).toBe("1h ago");
    expect(relativeAge(now - 23.9 * HOUR, now)).toBe("23h ago");
  });

  it("keeps the short and the future forms", () => {
    expect(relativeAge(now - 20_000, now)).toBe("just now");
    expect(relativeAge(now + 3 * 24 * HOUR, now)).toBe("in 3d");
  });
});
