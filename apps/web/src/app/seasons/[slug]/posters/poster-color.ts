/**
 * COLOUR ARITHMETIC FOR GENERATED ART.
 *
 * A team colour is whatever an organizer picked in a colour input — a navy, a
 * maroon, a highlighter yellow — and on a poster it has to carry TEXT. The
 * product's CSS gets WCAG AA from tuned token pairs; a raster has no tokens, so
 * the pairs are computed here instead: every text colour a skin derives from a
 * team colour is pushed toward white or black until the WCAG contrast ratio
 * against the ground it sits on clears the bar.
 *
 * Pure and dependency-free so the skins' contrast can be asserted in a unit
 * test for every theme × a spread of team colours, rather than eyeballed on the
 * two teams a demo season happens to have.
 */

export interface Rgb {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

export const WHITE = "#FFFFFF";
/** The floodlight ink — the darkest text any skin prints. */
export const INK = "#0B1018";

/** WCAG AA for body text. Every poster label is held to it, large or not. */
export const AA = 4.5;

export function parseHex(hex: string): Rgb {
  const value = /^#([0-9a-f]{6})$/i.exec(hex.trim())?.[1] ?? "000000";
  return {
    r: Number.parseInt(value.slice(0, 2), 16),
    g: Number.parseInt(value.slice(2, 4), 16),
    b: Number.parseInt(value.slice(4, 6), 16),
  };
}

function channel(value: number): string {
  return Math.max(0, Math.min(255, Math.round(value)))
    .toString(16)
    .padStart(2, "0");
}

/** Uppercase `#RRGGBB` — the one spelling every comparison in here uses. */
export function normalize(hex: string): string {
  return toHex(parseHex(hex));
}

export function toHex(rgb: Rgb): string {
  return `#${channel(rgb.r)}${channel(rgb.g)}${channel(rgb.b)}`.toUpperCase();
}

/** `t` of the way from `a` to `b`. */
export function mix(a: string, b: string, t: number): string {
  const from = parseHex(a);
  const to = parseHex(b);
  return toHex({
    r: from.r + (to.r - from.r) * t,
    g: from.g + (to.g - from.g) * t,
    b: from.b + (to.b - from.b) * t,
  });
}

function linear(value: number): number {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** WCAG relative luminance. */
export function luminance(hex: string): number {
  const { r, g, b } = parseHex(hex);
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

export function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** White or ink, whichever reads better on `ground`. One of them always clears AA. */
export function readableOn(ground: string): string {
  return contrast(WHITE, ground) >= contrast(INK, ground) ? WHITE : INK;
}

/**
 * Move `fg` toward white (on a dark ground) or toward black (on a light one)
 * until it clears `ratio` against EVERY ground it will be drawn on. Keeps the
 * hue for as long as it can — the point is a team's own green, legible, not a
 * generic white.
 */
export function ensureContrast(fg: string, grounds: readonly string[], ratio = AA): string {
  const worst = (colour: string) => Math.min(...grounds.map((ground) => contrast(colour, ground)));
  if (worst(fg) >= ratio) {
    return normalize(fg);
  }
  const darkGrounds = grounds.every((ground) => luminance(ground) < 0.18);
  const target = darkGrounds ? WHITE : "#000000";
  for (let step = 1; step <= 20; step += 1) {
    const candidate = mix(fg, target, step / 20);
    if (worst(candidate) >= ratio) {
      return candidate;
    }
  }
  return target;
}

/**
 * Darken (or lighten) a GROUND until `text` clears `ratio` on it: a team's
 * yellow becomes the deepest yellow-brown that white still reads on, rather
 * than a yellow nobody can read white on.
 */
export function groundFor(base: string, text: string, ratio: number): string {
  if (contrast(base, text) >= ratio) {
    return normalize(base);
  }
  const target = luminance(text) > 0.5 ? "#000000" : WHITE;
  for (let step = 1; step <= 20; step += 1) {
    const candidate = mix(base, target, step / 20);
    if (contrast(candidate, text) >= ratio) {
      return candidate;
    }
  }
  return target;
}

/** `#RRGGBB` plus an alpha, as the `rgba()` Satori understands. */
export function withAlpha(hex: string, alpha: number): string {
  const { r, g, b } = parseHex(hex);
  return `rgba(${String(r)}, ${String(g)}, ${String(b)}, ${String(alpha)})`;
}
