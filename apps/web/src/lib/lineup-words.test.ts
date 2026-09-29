import { describe, expect, it } from "vitest";

import { lineupWords } from "./lineup-words";

describe("lineupWords", () => {
  it("says whether the side is picked and whether the players were told", () => {
    expect(lineupWords({ saved: 0, announced: false })).toBe("lineup not set yet");
    expect(lineupWords({ saved: 11, announced: false })).toBe(
      "lineup picked · 11 players, not announced yet",
    );
    expect(lineupWords({ saved: 11, announced: true })).toBe("lineup announced");
  });
});
