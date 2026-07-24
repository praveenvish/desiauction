/**
 * Legible text on a fill the design system does not choose.
 *
 * Team colours are organizer data, so a monogram chip's label colour cannot be
 * pinned in CSS: a dark crest and a pale one need opposite labels, and picking
 * either one statically leaves the other below the 4.5:1 that WCAG 2.1 §1.4.3
 * asks of body-sized text. The fill's relative luminance decides it instead.
 *
 * The two candidates are the ink/paper pair that holds its value across both
 * console themes — `--text-on-accent` is the near-black already worn by labels
 * on the gold accent, `--text-on-dark` its light counterpart. `--text-inverse`
 * is deliberately not a candidate: it means "text on the inverted surface" and
 * so flips with the theme, which would fix a chip in Daylight and break the
 * same chip in Floodlight.
 *
 * Choosing between two labels is not on its own enough. Fills whose luminance
 * sits near the crossover of the two are equally illegible under both — the
 * system's own danger red is one — so `paintOnFill` also returns the fill to
 * paint, nudged to the nearest shade of the same hue that clears the ratio.
 * The nudge only fires inside that band; every colour that already works is
 * returned exactly as the organizer chose it.
 */

/** The label colour a fill can carry — always a token, never a literal. */
export type FillTextToken = "var(--text-on-accent)" | "var(--text-on-dark)";

export interface FillPaint {
  /** The fill to paint: the organizer's colour, or the nearest legible shade. */
  background: string;
  /** The label colour to paint on it. */
  color: FillTextToken;
}

/** Three- and six-digit hex, with or without the leading hash. */
const HEX = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;

/**
 * Relative luminance of the two label tokens. Both resolve to the same value in
 * Daylight and Floodlight, which is what makes them a usable pair here; the
 * accompanying test pins these numbers against the generated theme CSS so a
 * token change cannot silently drift past them.
 */
const INK_LUMINANCE = 0.002967429885;
const PAPER_LUMINANCE = 0.9456419377;

/** WCAG's contrast floor for text below the large-text threshold. */
const MIN_RATIO = 4.5;

const INK: FillTextToken = "var(--text-on-accent)";
const PAPER: FillTextToken = "var(--text-on-dark)";

/** The chip's fill when a team has picked no colour at all. */
const ACCENT_FALLBACK = "var(--accent)";

/** One 0–255 channel, linearised out of sRGB's transfer curve. */
function linearise(byte: number): number {
  const channel = byte / 255;
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}

function luminanceOf(channels: readonly number[]): number {
  const [r = 0, g = 0, b = 0] = channels.map(linearise);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function ratio(a: number, b: number): number {
  const [hi, lo] = a > b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}

/** The 0–255 channels of a hex colour, or `null` when it is not one. */
function channelsOf(fill: string): [number, number, number] | null {
  const match = HEX.exec(fill.trim());
  if (match === null) return null;
  const digits = match[1] ?? "";
  const pairs =
    digits.length === 3
      ? [0, 1, 2].map((at) => digits.slice(at, at + 1).repeat(2))
      : [0, 2, 4].map((at) => digits.slice(at, at + 2));
  const [r = 0, g = 0, b = 0] = pairs.map((pair) => Number.parseInt(pair, 16));
  return [r, g, b];
}

function toHex(channels: readonly number[]): string {
  return `#${channels.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
}

/**
 * Blend every channel `amount` of the way towards `target` (0 or 255), landing
 * on whole channels. The rounding happens here rather than at the end so the
 * ratio is measured on the colour that actually gets painted — a blend that
 * clears 4.5:1 in floating point can fall a thousandth short once quantised.
 */
function towards(
  channels: readonly [number, number, number],
  target: number,
  amount: number,
): [number, number, number] {
  return channels.map((channel) => Math.round(channel + (target - channel) * amount)) as [
    number,
    number,
    number,
  ];
}

/**
 * WCAG relative luminance of a hex colour, or `null` when the value is not a
 * hex colour at all — a CSS variable, a named colour, an empty field.
 */
export function relativeLuminance(fill: string): number | null {
  const channels = channelsOf(fill);
  return channels === null ? null : luminanceOf(channels);
}

/**
 * The token to paint text in when it sits on `fill`, ignoring whether the pair
 * can actually reach 4.5:1 there. Use it where the fill is fixed and only the
 * label is yours to choose; prefer {@link paintOnFill} when you own both.
 *
 * Anything unreadable — `null`, a blank string, a `var(--accent)` fallback —
 * yields the ink, which is what the accent itself wears.
 */
export function textOnFill(fill: string | null | undefined): FillTextToken {
  if (fill === null || fill === undefined) return INK;
  const luminance = relativeLuminance(fill);
  if (luminance === null) return INK;
  return ratio(luminance, INK_LUMINANCE) >= ratio(luminance, PAPER_LUMINANCE) ? INK : PAPER;
}

/**
 * The fill and label to paint a monogram chip with, guaranteed to clear 4.5:1.
 *
 * The organizer's colour survives untouched unless it sits in the band where
 * neither label reaches the ratio, where it is shaded or tinted by the smallest
 * step that does — a few percent, hue intact.
 */
export function paintOnFill(fill: string | null | undefined): FillPaint {
  if (fill === null || fill === undefined) {
    return { background: ACCENT_FALLBACK, color: INK };
  }
  const channels = channelsOf(fill);
  if (channels === null) {
    return { background: fill, color: INK };
  }

  const luminance = luminanceOf(channels);
  const onInk = ratio(luminance, INK_LUMINANCE);
  const onPaper = ratio(luminance, PAPER_LUMINANCE);
  if (Math.max(onInk, onPaper) >= MIN_RATIO) {
    return { background: fill, color: onInk >= onPaper ? INK : PAPER };
  }

  // In the band. Walk both ways at once and stop at whichever end clears the
  // ratio first, so the fill moves as little as the eye can get away with.
  for (let amount = 0.005; amount <= 1; amount += 0.005) {
    const lighter = towards(channels, 255, amount);
    if (ratio(luminanceOf(lighter), INK_LUMINANCE) >= MIN_RATIO) {
      return { background: toHex(lighter), color: INK };
    }
    const darker = towards(channels, 0, amount);
    if (ratio(luminanceOf(darker), PAPER_LUMINANCE) >= MIN_RATIO) {
      return { background: toHex(darker), color: PAPER };
    }
  }
  /* istanbul ignore next -- both ends terminate well before full blend. */
  return { background: fill, color: textOnFill(fill) };
}
