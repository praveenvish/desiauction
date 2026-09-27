import { describe, expect, it } from "vitest";

import { identityCardOf } from "./identity-card";
import { placeholderIdentity } from "./placeholder";

describe("identityCardOf", () => {
  it("is the SAME identity as the small mark, drawn large", () => {
    const seed = "01J5KQ3V9XPLAYER01";
    const card = identityCardOf(seed, "Deepak Kadam");
    const mark = placeholderIdentity(seed, "Deepak Kadam");
    expect(card.pattern).toBe(mark.pattern);
    expect(card.accent).toBe(mark.accent);
    expect(card.angle).toBe(mark.angle);
    expect(card.initials).toBe("DK");
  });

  it("is deterministic", () => {
    expect(identityCardOf("seed-a", "Rohan Kulkarni")).toEqual(
      identityCardOf("seed-a", "Rohan Kulkarni"),
    );
  });

  it("keeps every pattern's turn bounded so no seed rotates it off the card", () => {
    for (let i = 0; i < 200; i += 1) {
      const card = identityCardOf(`seed-${String(i)}`, "Player Name");
      const turn = /rotate\((-?\d+) /.exec(card.transform);
      if (turn === null) {
        // beams: a mirror, not a rotation
        expect(card.pattern).toBe("beams");
        continue;
      }
      const degrees = Number(turn[1]);
      if (card.pattern === "arcs") expect(degrees).toBeLessThan(90);
      if (card.pattern === "crease") expect(Math.abs(degrees)).toBeLessThanOrEqual(30);
      if (card.pattern === "contour") expect(Math.abs(degrees)).toBeLessThanOrEqual(20);
    }
  });

  it("sets a lone initial larger than a pair", () => {
    expect(identityCardOf("x", "Jadeja").fontSize).toBeGreaterThan(
      identityCardOf("x", "Ravindra Jadeja").fontSize,
    );
  });

  it("counts Devanagari initials by grapheme, not code unit", () => {
    const card = identityCardOf("x", "रोहित शर्मा");
    expect(card.script).toBe("devanagari");
    expect(card.fontSize).toBe(identityCardOf("x", "Rohit Sharma").fontSize);
  });

  it("has no glyph size when the name yields no initials", () => {
    expect(identityCardOf("x", "   ").fontSize).toBe(0);
  });
});
