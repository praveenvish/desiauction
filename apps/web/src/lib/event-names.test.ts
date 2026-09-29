import { describe, expect, it } from "vitest";

import { foldMatchSaves } from "./event-names";

describe("foldMatchSaves", () => {
  it("folds a match's start and finish into its result", () => {
    const rows = [
      { action: "fixture.complete", subject: "f1" },
      { action: "fixture.result.recorded", subject: "f1" },
      { action: "fixture.start", subject: "f1" },
      { action: "fixture.start", subject: "f2" },
      { action: "registration.poster_generated", subject: "p1" },
    ];
    expect(foldMatchSaves(rows).map((row) => `${row.action}:${row.subject}`)).toEqual([
      "fixture.result.recorded:f1",
      "fixture.start:f2",
      "registration.poster_generated:p1",
    ]);
  });
});
