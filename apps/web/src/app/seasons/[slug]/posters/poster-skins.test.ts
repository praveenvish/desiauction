import { POSTER_THEMES } from "@desiauction/core";
import { describe, expect, it } from "vitest";

import {
  AA,
  contrast,
  ensureContrast,
  groundFor,
  mix,
  normalize,
  readableOn,
} from "./poster-color";
import { skinFor, teamToneFor } from "./poster-skins";

/*
 * A team colour is whatever an organizer picked. These are the hostile ones:
 * a highlighter yellow and pure white (white text vanishes), pure black and a
 * navy (dark text vanishes), mid-tones that fail BOTH at 4.5 for some pairs,
 * and the brand gold itself.
 */
const TEAM_COLOURS = [
  null,
  "#1F6F43",
  "#1D4E89",
  "#8E2420",
  "#6B3FA0",
  "#FFEB3B",
  "#FFFFFF",
  "#000000",
  "#E6B24A",
  "#808080",
  "#00FFFF",
];

describe("poster colour arithmetic", () => {
  it("measures WCAG contrast the way the spec does", () => {
    expect(contrast("#FFFFFF", "#000000")).toBeCloseTo(21, 0);
    expect(contrast("#777777", "#FFFFFF")).toBeCloseTo(4.48, 1);
  });

  it("always finds a readable text colour, keeping the hue while it can", () => {
    for (const ground of TEAM_COLOURS.filter((c): c is string => c !== null)) {
      expect(contrast(readableOn(ground), ground)).toBeGreaterThanOrEqual(AA);
    }
    // Already legible: returned untouched.
    expect(ensureContrast("#FFFFFF", ["#0B1018"])).toBe("#FFFFFF");
    // A navy on navy is lightened, not replaced by a different hue.
    const lifted = ensureContrast("#1D4E89", ["#0B1018"]);
    expect(contrast(lifted, "#0B1018")).toBeGreaterThanOrEqual(AA);
    expect(lifted).not.toBe("#FFFFFF");
  });

  it("deepens a ground until white reads on it", () => {
    const ground = groundFor("#FFEB3B", "#FFFFFF", 9);
    expect(contrast(ground, "#FFFFFF")).toBeGreaterThanOrEqual(9);
    expect(mix("#000000", "#FFFFFF", 0.5)).toBe("#808080");
    expect(normalize("#abcdef")).toBe("#ABCDEF");
  });
});

describe("poster skins — AA is a property of the construction", () => {
  for (const theme of POSTER_THEMES) {
    for (const team of TEAM_COLOURS) {
      it(`${theme} × ${team ?? "no team"}`, () => {
        const { palette, team: tone } = skinFor(theme, team);
        const grounds = [palette.surface, palette.washInner, palette.panel];
        for (const text of [
          palette.heading,
          palette.body,
          palette.muted,
          palette.accent,
          palette.accentSoft,
          palette.money,
          palette.brandAccent,
          tone.text,
        ]) {
          for (const ground of grounds) {
            expect(contrast(text, ground)).toBeGreaterThanOrEqual(AA);
          }
        }
        expect(contrast(palette.onAccent, palette.accent)).toBeGreaterThanOrEqual(AA);
        expect(contrast(tone.onFill, tone.fill)).toBeGreaterThanOrEqual(AA);
        // A second team on a season-wide poster gets the same guarantee.
        const rival = teamToneFor(palette, "#FFEB3B");
        expect(contrast(rival.onFill, rival.fill)).toBeGreaterThanOrEqual(AA);
        expect(contrast(rival.text, palette.surface)).toBeGreaterThanOrEqual(AA);
      });
    }
  }

  it("lets the team colour drive the accent on minimal and the ground on matchday", () => {
    expect(skinFor("minimal", "#1D4E89").palette.accent).toBe("#1D4E89");
    expect(skinFor("matchday", "#1D4E89").palette.surface).not.toBe(
      skinFor("matchday", "#8E2420").palette.surface,
    );
    expect(skinFor("floodlight", "#8E2420").team.fill).toBe("#8E2420");
  });
});
