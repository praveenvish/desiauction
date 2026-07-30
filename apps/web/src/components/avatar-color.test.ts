import { describe, expect, it } from "vitest";

import { AVATAR_COLORS, avatarColor } from "./avatar-color";

/**
 * The guard the old hash never had: a generated avatar colour is a colour a
 * screen has to pass an accessibility scan with, so its contrast is asserted
 * here rather than discovered by axe on whichever member happened to sign up.
 */

const AA_NORMAL = 4.5;

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const sat = s / 100;
  const light = l / 100;
  const a = sat * Math.min(light, 1 - light);
  const f = (n: number): number => {
    const k = (n + h / 30) % 12;
    return light - a * Math.max(-1, Math.min(k - 3, Math.min(9 - k, 1)));
  };
  return [f(0) * 255, f(8) * 255, f(4) * 255];
}

function relativeLuminance([r, g, b]: [number, number, number]): number {
  const channel = (value: number): number => {
    const c = value / 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrastWithWhite(color: string): number {
  const match = /^hsl\(([\d.]+) ([\d.]+)% ([\d.]+)%\)$/.exec(color);
  if (match === null) {
    throw new Error(`not an hsl() triple: ${color}`);
  }
  const lum = relativeLuminance(hslToRgb(Number(match[1]), Number(match[2]), Number(match[3])));
  return 1.05 / (lum + 0.05);
}

describe("avatar colours", () => {
  it("every swatch carries white text at AA", () => {
    const failures = AVATAR_COLORS.filter((color) => contrastWithWhite(color) < AA_NORMAL).map(
      (color) => `${color} = ${contrastWithWhite(color).toFixed(2)}:1`,
    );
    expect(failures, `avatar swatches below ${String(AA_NORMAL)}:1 against #fff`).toEqual([]);
  });

  it("stays in one visual family — no swatch is twice as bright as another", () => {
    const ratios = AVATAR_COLORS.map(contrastWithWhite);
    expect(Math.max(...ratios) - Math.min(...ratios)).toBeLessThan(1);
  });

  it("is stable per person and always inside the validated set", () => {
    expect(avatarColor("01HQ8Z9F7ABCDEF")).toBe(avatarColor("01HQ8Z9F7ABCDEF"));
    for (const id of ["a", "01HQ", "", "01J0000000000000000000000Z"]) {
      expect(AVATAR_COLORS).toContain(avatarColor(id));
    }
  });

  it("spreads a realistic roster over several swatches", () => {
    const ids = Array.from({ length: 24 }, (_, index) => `01J00000000000000000000${String(index)}`);
    expect(new Set(ids.map(avatarColor)).size).toBeGreaterThan(3);
  });
});
