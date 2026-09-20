import type { PosterTheme } from "@desiauction/core";

import {
  AA,
  INK,
  WHITE,
  ensureContrast,
  groundFor,
  mix,
  readableOn,
  withAlpha,
} from "./poster-color";

/**
 * THE SKINS — every colour a poster is drawn in, resolved to literal hex.
 *
 * Satori resolves no CSS variables (`var(--accent)` silently renders black), so
 * the rasterizer needs literal colours, and the source of truth for the dark
 * ones is `packages/ui/src/generated/floodlight.css`. Each theme below is a
 * deliberate departure from it, not a drift.
 *
 * Three FAMILIES (see `POSTER_THEMES`): `classic` is the product's own card in
 * four moods, `matchday` makes the team's colour the ground, `minimal` is paper
 * and air. The family decides the frame and the emphasis; the palette decides
 * the colours; and the TEAM colour — when the poster has one team — drives the
 * accents in all three.
 *
 * Every TEXT colour is passed through `ensureContrast` against every ground it
 * can land on, so AA is a property of the construction rather than of the two
 * demo teams somebody happened to check. `poster-skins.test.ts` asserts it for
 * every theme across a spread of hostile team colours.
 */

export type PosterFamily = "classic" | "matchday" | "minimal";

export interface Palette {
  readonly surface: string;
  /** Inner stop of the floodlight wash (and the matchday band). */
  readonly washInner: string;
  readonly washGeometry: string;
  readonly panel: string;
  readonly border: string;
  readonly heading: string;
  readonly body: string;
  readonly muted: string;
  readonly accent: string;
  readonly accentSoft: string;
  readonly onAccent: string;
  readonly money: string;
  /** The "Auction" half of the wordmark. */
  readonly brandAccent: string;
}

/** One team's colour, made safe for the ground it lands on. */
export interface TeamTone {
  /** Decorative fills: crest ring, initials tile, face stripe, chips. */
  readonly fill: string;
  /** Text drawn ON `fill`. */
  readonly onFill: string;
  /** The team colour as TEXT on the poster's own surfaces. */
  readonly text: string;
  /** A translucent wash of it, for glows. */
  readonly glow: string;
}

export interface Skin {
  readonly theme: PosterTheme;
  readonly family: PosterFamily;
  readonly dark: boolean;
  readonly palette: Palette;
  /**
   * The one emphasis knob inside the classic family: who carries the solid
   * accent on the verdict row — the stamp, or (arena) the price.
   */
  readonly accentOn: "stamp" | "price";
  /** Rule and tile border weight. */
  readonly rule: number;
  /** The poster's own team, or the palette's accent when it has none. */
  readonly team: TeamTone;
}

const BRAND_GOLD = "#E6B24A";

interface RawPalette extends Omit<Palette, "brandAccent"> {
  readonly brandAccent?: string;
}

const CLASSIC: Record<
  "floodlight" | "gold" | "arena" | "ink",
  { palette: RawPalette; accentOn: "stamp" | "price"; rule: number }
> = {
  // The product's own dark navy, verbatim from the floodlight tokens. This is
  // the one that has to look like DesiAuction and not like a poster generator.
  floodlight: {
    palette: {
      surface: "#0B1018",
      washInner: "#161E2E",
      washGeometry: "1200px 780px at 6% -10%",
      panel: "#101623",
      border: "#2C3A52",
      heading: "#E8EEF9",
      body: "#C9D4E8",
      muted: "#8193B2",
      accent: BRAND_GOLD,
      accentSoft: "#F3D078",
      onAccent: "#070A0F",
      money: "#F6F9FF",
    },
    accentOn: "stamp",
    rule: 1,
  },
  // Ceremony. Warm near-black with the wash overhead rather than off to one
  // side, so the poster reads as a trophy shot instead of a dashboard.
  gold: {
    palette: {
      surface: "#090702",
      washInner: "#241A06",
      washGeometry: "1200px 900px at 50% -12%",
      panel: "#17120A",
      border: "#4A3A16",
      heading: "#FFF7E6",
      body: "#E9D7AE",
      muted: "#B09A6A",
      accent: BRAND_GOLD,
      accentSoft: "#F3D078",
      onAccent: "#0A0700",
      money: "#FFF7E6",
    },
    accentOn: "stamp",
    rule: 2,
  },
  // Night match under the lights: the product's `--live` green as the accent,
  // and the emphasis moved off the stamp so the stamp draws as outlined block
  // letters — the one theme where the price, not the verdict, is the loud thing.
  arena: {
    palette: {
      surface: "#05130E",
      washInner: "#0D2A1F",
      washGeometry: "1300px 700px at 96% -8%",
      panel: "#0B1F17",
      border: "#1E4A38",
      heading: "#EAFBF3",
      body: "#BCDCCB",
      muted: "#7FA593",
      accent: "#3DD68C",
      accentSoft: "#7BE8B4",
      onAccent: "#04120C",
      money: "#EAFBF3",
    },
    accentOn: "price",
    rule: 2,
  },
  /*
   * The light classic, and the reason there is one: these get printed, put on a
   * club noticeboard, and posted into feeds that are not black. The accent is
   * the brand gold taken down to a bronze that survives on paper — #E6B24A on
   * cream is legible to nobody.
   */
  ink: {
    palette: {
      surface: "#F5F2EA",
      washInner: "#FFFFFF",
      washGeometry: "1200px 780px at 6% -10%",
      panel: "#FFFFFF",
      border: "#D9D2C4",
      heading: "#14171F",
      body: "#333A46",
      muted: "#5F6570",
      accent: "#8A5A00",
      accentSoft: "#8A5A00",
      onAccent: "#FFF8EA",
      money: "#14171F",
      brandAccent: "#8A5A00",
    },
    accentOn: "stamp",
    rule: 2,
  },
};

/** Matchday with no team to take a colour from: a stadium-seat royal blue. */
const MATCHDAY_DEFAULT = "#1E3A8A";
/** Minimal with no team: the ink theme's bronze. */
const MINIMAL_DEFAULT = "#8A5A00";

/** Every text colour, forced to AA against every ground it can land on. */
function settle(raw: RawPalette): Palette {
  const grounds = [raw.surface, raw.washInner, raw.panel];
  const text = (colour: string) => ensureContrast(colour, grounds, AA);
  const accent = text(raw.accent);
  return {
    ...raw,
    heading: text(raw.heading),
    body: text(raw.body),
    muted: text(raw.muted),
    accent,
    accentSoft: text(raw.accentSoft),
    money: text(raw.money),
    onAccent: ensureContrast(raw.onAccent, [accent], AA),
    brandAccent: text(raw.brandAccent ?? BRAND_GOLD),
  };
}

function matchdayPalette(base: string): RawPalette {
  // The ground is the team's colour taken as deep as white text needs it to
  // be — a highlighter yellow becomes a mustard-brown, a navy stays a navy.
  const surface = groundFor(base, WHITE, 9);
  const washInner = groundFor(base, WHITE, 6);
  return {
    surface,
    washInner,
    washGeometry: "1400px 900px at 100% 0%",
    panel: mix(surface, "#000000", 0.28),
    border: mix(surface, WHITE, 0.24),
    heading: WHITE,
    body: mix(WHITE, surface, 0.1),
    muted: mix(WHITE, surface, 0.28),
    // Gold on the team's colour: a trophy on a jersey.
    accent: "#F5C84C",
    accentSoft: "#F8DC8C",
    onAccent: INK,
    money: WHITE,
    brandAccent: "#F5C84C",
  };
}

function minimalPalette(base: string): RawPalette {
  const surface = "#FAF8F3";
  const accent = ensureContrast(base, [surface, WHITE], AA);
  return {
    surface,
    washInner: WHITE,
    washGeometry: "1200px 780px at 50% -20%",
    panel: WHITE,
    border: "#E4DED2",
    heading: "#111318",
    body: "#2F3540",
    muted: "#5F6672",
    accent,
    accentSoft: accent,
    onAccent: readableOn(accent),
    money: "#111318",
    brandAccent: "#8A5A00",
  };
}

/** A team's colour against a resolved palette. */
export function teamToneFor(palette: Palette, colour: string | null): TeamTone {
  const fill = colour ?? palette.accent;
  return {
    fill,
    onFill: readableOn(fill),
    text: ensureContrast(fill, [palette.surface, palette.washInner, palette.panel], AA),
    // A franchise's colour earns a glow on the frame; the fallback accent does
    // not — on the season-wide posters, which have no one team, a full-strength
    // gold wash across the foot of the poster reads as a light leak.
    glow: withAlpha(fill, colour === null ? 0.12 : 0.3),
  };
}

export function skinFor(theme: PosterTheme, teamColor: string | null): Skin {
  if (theme === "matchday") {
    const palette = settle(matchdayPalette(teamColor ?? MATCHDAY_DEFAULT));
    return {
      theme,
      family: "matchday",
      dark: true,
      palette,
      accentOn: "stamp",
      rule: 2,
      // On matchday the ground already IS the team; its tone for chips and
      // stripes is the gold, so a crest ring does not vanish into the ground.
      team: teamToneFor(palette, null),
    };
  }
  if (theme === "minimal") {
    const palette = settle(minimalPalette(teamColor ?? MINIMAL_DEFAULT));
    return {
      theme,
      family: "minimal",
      dark: false,
      palette,
      accentOn: "stamp",
      rule: 1,
      team: teamToneFor(palette, teamColor),
    };
  }
  const classic = CLASSIC[theme];
  const palette = settle(classic.palette);
  return {
    theme,
    family: "classic",
    dark: theme !== "ink",
    palette,
    accentOn: classic.accentOn,
    rule: classic.rule,
    team: teamToneFor(palette, teamColor),
  };
}
