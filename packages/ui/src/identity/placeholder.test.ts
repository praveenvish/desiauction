import { describe, expect, it } from "vitest";

import { initialsFor, placeholderIdentity } from "./placeholder";

describe("placeholderIdentity", () => {
  it("is deterministic: same seed, same identity, every time", () => {
    const a = placeholderIdentity("01J5KQ3V9XPLAYER01", "Rohit Sharma");
    const b = placeholderIdentity("01J5KQ3V9XPLAYER01", "Rohit Sharma");
    expect(a).toEqual(b);
  });

  it("different seeds diverge (spread check over the identity space)", () => {
    const marks = new Set(
      Array.from({ length: 64 }, (_, i) =>
        JSON.stringify(placeholderIdentity(`seed-${String(i)}`, `Player ${String(i)}`)),
      ),
    );
    expect(marks.size).toBe(64);
  });

  it("falls back to the name when no seed exists", () => {
    const a = placeholderIdentity("", "Virat Kohli");
    const b = placeholderIdentity("", "Virat Kohli");
    expect(a).toEqual(b);
  });
});

describe("initialsFor", () => {
  it("takes first and last word initials for Latin names", () => {
    expect(initialsFor("Rohit Sharma").initials).toBe("RS");
    expect(initialsFor("Yashasvi Bhupendra Kumar Jaiswal").initials).toBe("YJ");
  });

  it("handles single names", () => {
    expect(initialsFor("Jadeja")).toEqual({ initials: "J", script: "latin" });
  });

  it("segments Devanagari graphemes correctly (no broken matras)", () => {
    const result = initialsFor("रोहित शर्मा");
    expect(result.script).toBe("devanagari");
    expect(result.initials).toBe("रोश");
  });

  it("returns null initials for empty or whitespace names", () => {
    expect(initialsFor("").initials).toBeNull();
    expect(initialsFor("   ").initials).toBeNull();
  });

  it("survives adversarial input without throwing", () => {
    for (const name of ["🏏", "A", "अ", "x ".repeat(50), "​", "O'Brien-D'Souza Jr."]) {
      expect(() => placeholderIdentity(name, name)).not.toThrow();
    }
  });
});
