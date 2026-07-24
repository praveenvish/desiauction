import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { paintOnFill, relativeLuminance, textOnFill, type FillTextToken } from "./fill-contrast";

// The two candidate tokens resolve to the same value in Daylight and
// Floodlight, which is the whole reason they are the pair — so every contrast
// assertion below holds under either console theme.
const RESOLVED: Record<FillTextToken, string> = {
  "var(--text-on-accent)": "#070A0F",
  "var(--text-on-dark)": "#F6F9FF",
};

function contrast(a: string, b: string): number {
  const la = relativeLuminance(a) ?? 0;
  const lb = relativeLuminance(b) ?? 0;
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

function tokenValue(theme: string, name: string): string {
  const css = readFileSync(join(__dirname, "..", "generated", `${theme}.css`), "utf8");
  const match = new RegExp(`${name}:\\s*(#[0-9A-Fa-f]{6})`).exec(css);
  return match?.[1] ?? "";
}

describe("the label pair", () => {
  it("is the same colour in both themes, and the module's constants match it", () => {
    for (const [token, expected] of Object.entries(RESOLVED)) {
      const name = token.slice("var(".length, -1);
      expect(tokenValue("daylight", name), `${name} in daylight`).toBe(expected);
      expect(tokenValue("floodlight", name), `${name} in floodlight`).toBe(expected);
    }
    // The luminances the module hardcodes, pinned to the tokens themselves.
    expect(relativeLuminance(RESOLVED["var(--text-on-accent)"])).toBeCloseTo(0.002967429885, 9);
    expect(relativeLuminance(RESOLVED["var(--text-on-dark)"])).toBeCloseTo(0.9456419377, 9);
  });
});

describe("relativeLuminance", () => {
  it("puts black at 0 and white at 1", () => {
    expect(relativeLuminance("#000000")).toBeCloseTo(0, 5);
    expect(relativeLuminance("#FFFFFF")).toBeCloseTo(1, 5);
  });

  it("reads shorthand and bare hex the same as the long form", () => {
    expect(relativeLuminance("#fff")).toBeCloseTo(relativeLuminance("#FFFFFF") ?? 0, 9);
    expect(relativeLuminance("1f6f43")).toBeCloseTo(relativeLuminance("#1f6f43") ?? 0, 9);
  });

  it("returns null for anything that is not a hex colour", () => {
    expect(relativeLuminance("var(--accent)")).toBeNull();
    expect(relativeLuminance("")).toBeNull();
    expect(relativeLuminance("rebeccapurple")).toBeNull();
  });
});

describe("textOnFill", () => {
  it("puts ink on pale fills and paper on dark ones", () => {
    // The reported failure: a pale gold crest wearing light text.
    expect(textOnFill("#F3D078")).toBe("var(--text-on-accent)");
    // The colour field's own default — a deep green.
    expect(textOnFill("#1f6f43")).toBe("var(--text-on-dark)");
  });

  it("falls back to the ink the accent itself wears", () => {
    expect(textOnFill(null)).toBe("var(--text-on-accent)");
    expect(textOnFill(undefined)).toBe("var(--text-on-accent)");
    expect(textOnFill("var(--accent)")).toBe("var(--text-on-accent)");
  });

  it("always picks the more legible of the two candidates", () => {
    for (let step = 0; step <= 255; step += 1) {
      const hex = `#${step.toString(16).padStart(2, "0").repeat(3)}`;
      const chosen = contrast(hex, RESOLVED[textOnFill(hex)]);
      const other = contrast(
        hex,
        RESOLVED[
          textOnFill(hex) === "var(--text-on-accent)"
            ? "var(--text-on-dark)"
            : "var(--text-on-accent)"
        ],
      );
      expect(chosen, `${hex}: chose the worse candidate`).toBeGreaterThanOrEqual(other);
    }
  });
});

describe("paintOnFill", () => {
  it("leaves the organizer's colour alone when it is already legible", () => {
    for (const fill of ["#F3D078", "#1f6f43", "#0B1018", "#FFFFFF", "#B57F14", "#5CA8FF"]) {
      expect(paintOnFill(fill).background, fill).toBe(fill);
    }
  });

  it("keeps the accent fallback when a team has picked no colour", () => {
    expect(paintOnFill(null)).toEqual({
      background: "var(--accent)",
      color: "var(--text-on-accent)",
    });
    expect(paintOnFill("var(--accent)")).toEqual({
      background: "var(--accent)",
      color: "var(--text-on-accent)",
    });
  });

  it("nudges the fills no label can rescue — the system's own red and blue among them", () => {
    for (const fill of ["#D93843", "#2673D6"]) {
      const painted = paintOnFill(fill);
      expect(painted.background, fill).not.toBe(fill);
      expect(contrast(painted.background, RESOLVED[painted.color]), fill).toBeGreaterThanOrEqual(
        4.5,
      );
    }
  });

  it("clears 4.5:1 for every colour a picker can emit", () => {
    // A coarse sweep of the whole cube, plus the grey axis where the two
    // candidates cross over and the nudge has to do the work.
    const values = [0, 31, 63, 95, 119, 127, 135, 159, 191, 223, 255];
    for (const r of values) {
      for (const g of values) {
        for (const b of values) {
          const hex = `#${[r, g, b].map((c) => c.toString(16).padStart(2, "0")).join("")}`;
          const painted = paintOnFill(hex);
          const seen = contrast(painted.background, RESOLVED[painted.color]);
          expect(
            seen,
            `${hex} -> ${painted.background} on ${painted.color}`,
          ).toBeGreaterThanOrEqual(4.5);
        }
      }
    }
  });

  it("moves a nudged fill only slightly — the hue has to survive", () => {
    const painted = paintOnFill("#D93843");
    const before = relativeLuminance("#D93843") ?? 0;
    const after = relativeLuminance(painted.background) ?? 0;
    expect(Math.abs(after - before)).toBeLessThan(0.06);
  });
});
