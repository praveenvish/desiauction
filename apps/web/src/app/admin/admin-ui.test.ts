import { describe, expect, it } from "vitest";

import { foldRuns, humanAction } from "./admin-ui";

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
