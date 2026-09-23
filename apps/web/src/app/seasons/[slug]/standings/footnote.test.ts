import { sportPackFor } from "@desiauction/core";
import { describe, expect, it } from "vitest";

import { standingsFootnote } from "./footnote";

describe("standingsFootnote — the rules under the table are the season's sport's", () => {
  it("keeps cricket's sentence word for word", () => {
    expect(standingsFootnote(sportPackFor("cricket"))).toBe(
      "Two points for a win, one for a tie or a no result. Net run rate is runs per over scored minus runs per over conceded, counted in balls — an abandoned match counts as nothing at all, a no result counts as played.",
    );
  });

  it("gives football three for a win and its own tiebreaks, and no run rate", () => {
    const note = standingsFootnote(sportPackFor("football"));
    expect(note).toBe(
      "Three points for a win, one for a tie or a no result. Teams level on points are separated by GD, then GF.",
    );
    expect(note).not.toContain("run rate");
  });

  it("says a loss earns a point where the pack says so (basketball)", () => {
    expect(standingsFootnote(sportPackFor("basketball"))).toContain("one for a loss");
  });

  it("describes a lobby by placement, not by wins", () => {
    expect(standingsFootnote(sportPackFor("battle_royale"))).toContain("lobby");
  });
});
