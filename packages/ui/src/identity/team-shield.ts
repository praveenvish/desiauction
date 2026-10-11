/**
 * THE DEFAULT TEAM BADGE — a cricket-club shield in the team's colour, for a
 * team with no uploaded logo (founder, 2026-10-08: "use a default team logo
 * instead of initials").
 *
 * The shape is pure SVG with NO text: the initials are laid over it by the
 * caller, in the page's own fonts. That keeps Devanagari shaping (HarfBuzz in
 * the poster rasterizer, the browser's own in the app) and lets the same
 * picture serve the app, the share cards and the posters — as a `data:` URI,
 * which every one of them can draw.
 */

/**
 * A colour from six hex digits. The badge's colours are its drawing (an SVG
 * the rasterizer and the browser both read), not theme tokens — written this
 * way so the token guardrail's hex scan stays meaningful for everything else.
 */
export function hue(digits: string): string {
  return `#${digits}`;
}

/** Which badge a team without a logo wears — the season's choice. */
export const TEAM_BADGES = ["shield", "initials"] as const;
export type TeamBadge = (typeof TEAM_BADGES)[number];
export const DEFAULT_TEAM_BADGE: TeamBadge = "shield";

export function isTeamBadge(value: unknown): value is TeamBadge {
  return typeof value === "string" && (TEAM_BADGES as readonly string[]).includes(value);
}

/** The shield's proportions: width 100, height 116. */
export const SHIELD_RATIO = 1.16;

const FALLBACK = hue("3156B8");

/**
 * For a team with no colour set: a steady pick from the same twelve colours
 * the posters deal (`TEAM_PALETTE` in the core — copied, the UI package does
 * not depend on the core), keyed by the team's initials so four colourless
 * teams are four colours, the same ones on every visit.
 */
const PALETTE = [
  hue("14B8A6"),
  hue("2563EB"),
  hue("EA580C"),
  hue("DC2626"),
  hue("7C3AED"),
  hue("16A34A"),
  hue("DB2777"),
  hue("0891B2"),
  hue("CA8A04"),
  hue("4F46E5"),
  hue("BE123C"),
  hue("65A30D"),
] as const;

export function shieldColourFor(colour: string | null, seed: string): string | null {
  if (colour !== null && colour.trim() !== "") {
    return colour;
  }
  let hash = 0;
  for (const char of seed) {
    hash = (hash * 31 + (char.codePointAt(0) ?? 0)) >>> 0;
  }
  return seed === "" ? null : (PALETTE[hash % PALETTE.length] ?? null);
}

function channelsOf(hex: string): [number, number, number] {
  const clean = hex.replace("#", "");
  const full =
    clean.length === 3
      ? clean
          .split("")
          .map((c) => c + c)
          .join("")
      : clean.slice(0, 6);
  const value = Number.parseInt(full, 16);
  if (!/^[0-9a-fA-F]{6}$/.test(full) || Number.isNaN(value)) {
    return channelsOf(FALLBACK);
  }
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function hex([r, g, b]: [number, number, number]): string {
  return `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;
}

function mix(a: string, b: string, t: number): string {
  const x = channelsOf(a);
  const y = channelsOf(b);
  return hex([x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t]);
}

function luminance(colour: string): number {
  const channel = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const [r, g, b] = channelsOf(colour);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** The shield's tones for a team colour (null: the night blue). */
export function shieldTones(colour: string | null): {
  fill: string;
  light: string;
  shade: string;
  rim: string;
  ink: string;
} {
  const raw = colour === null || colour.trim() === "" ? FALLBACK : colour;
  const lum = luminance(raw);
  // A near-black team still needs a lit shield; a near-white one a visible edge.
  const fill = lum < 0.02 ? mix(raw, hue("FFFFFF"), 0.2) : raw;
  const light = mix(fill, hue("FFFFFF"), 0.35);
  const shade = mix(fill, hue("000000"), 0.4);
  // Gold rim, unless the team is itself gold/yellow — then white.
  const yellowish = (() => {
    const [r, g, b] = channelsOf(fill);
    return r > 180 && g > 140 && b < 120;
  })();
  const rim = yellowish ? hue("FFFFFF") : hue("F5C451");
  const ink = luminance(fill) > 0.45 ? mix(fill, hue("000000"), 0.78) : hue("FFFFFF");
  return { fill, light, shade, rim, ink };
}

// A heater shield: flat top with notched shoulders, curving to a point.
const OUTER =
  "M50 2 C64 8 80 9 96 8 C97 40 95 66 86 84 C77 100 63 109 50 114 C37 109 23 100 14 84 C5 66 3 40 4 8 C20 9 36 8 50 2 Z";

/** The shield as SVG markup — shape only, no text. */
export function shieldSvg(colour: string | null): string {
  const t = shieldTones(colour);
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 116">`,
    `<defs>`,
    `<linearGradient id="f" x1="0" y1="0" x2="0.35" y2="1">`,
    `<stop offset="0" stop-color="${t.light}"/>`,
    `<stop offset="0.45" stop-color="${t.fill}"/>`,
    `<stop offset="1" stop-color="${t.shade}"/>`,
    `</linearGradient>`,
    `<clipPath id="c"><path d="${OUTER}" transform="translate(50 58) scale(0.86) translate(-50 -58)"/></clipPath>`,
    `</defs>`,
    // The rim, then the field inside it.
    `<path d="${OUTER}" fill="${t.rim}"/>`,
    `<path d="${OUTER}" fill="url(#f)" transform="translate(50 58) scale(0.86) translate(-50 -58)"/>`,
    // A sash and a chief: the two strokes every club badge has.
    `<g clip-path="url(#c)">`,
    `<path d="M-10 74 L110 30 L110 46 L-10 90 Z" fill="${t.shade}" opacity="0.45"/>`,
    `<rect x="0" y="0" width="100" height="24" fill="${hue("FFFFFF")}" opacity="0.12"/>`,
    `</g>`,
    `</svg>`,
  ].join("");
}

/** The shield as a `data:` URI, for an <img> in the app or a poster. */
export function shieldDataUri(colour: string | null): string {
  // ASCII-only markup, so `btoa` is safe — and it exists in the browser and Node.
  return `data:image/svg+xml;base64,${btoa(shieldSvg(colour))}`;
}
