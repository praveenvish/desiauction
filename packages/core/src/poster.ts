/**
 * THE POSTER MODEL — the artifact people actually share.
 *
 * Distinct from `share-card.ts`, and deliberately so. A share card is a LINK
 * PREVIEW: 1200x630, landscape, rendered by a crawler when somebody pastes a
 * URL into a chat. A poster is a FILE an organizer downloads and posts —
 * square for a feed, portrait for a Status — and it exists because the hour
 * after the gavel falls is the one hour when every owner and every player
 * WANTS to broadcast. That is the platform's cheapest distribution, and it only
 * works if the artifact is good enough that nobody crops the footer off.
 *
 * Pure and deterministic, like every model in this package: no IO, no JSX, no
 * colour. It turns a sale into truncated, formatted, honest text and leaves the
 * pixels to the rasterizer boundary — where the palette has to be literal hex
 * anyway, because Satori cannot resolve a CSS variable.
 */

import { formatPaiseINR, paise } from "./money";
import { roleLabel } from "./player-profile";

/**
 * Themes are a PALETTE PLUS AN EMPHASIS, not four separate layouts. One
 * renderer reading a theme keeps every poster on the same grid, which is what
 * stops a theme picker from becoming four designs that drift apart.
 */
export const POSTER_THEMES = ["floodlight", "gold", "arena", "ink"] as const;
export type PosterTheme = (typeof POSTER_THEMES)[number];

export function isPosterTheme(value: string): value is PosterTheme {
  return (POSTER_THEMES as readonly string[]).includes(value);
}

/**
 * Square for a feed, portrait for a Status/Story. Both 1080-wide because that
 * is what every Indian phone uploads without re-compressing to mush — and
 * neither is the 1200x630 the link-preview cards use, which is the wrong shape
 * for the two places these are actually posted.
 */
export const POSTER_SIZES = {
  square: { width: 1080, height: 1080 },
  story: { width: 1080, height: 1920 },
} as const;
export type PosterSize = keyof typeof POSTER_SIZES;

export function isPosterSize(value: string): value is PosterSize {
  return value === "square" || value === "story";
}

/** How the sale reads. `sold` is the only one that carries a price. */
export type PosterOutcome = "sold" | "unsold" | "retained" | "icon";

export interface PlayerPosterInput {
  playerName: string;
  /** Registration number — the identity the player already sees on their page. */
  number: string | null;
  role: string;
  /** Consent-gated upstream: null means render the monogram, never a broken img. */
  photoUrl: string | null;
  outcome: PosterOutcome;
  /** Integer paise. Null unless `outcome === "sold"`. */
  pricePaise: number | null;
  teamName: string | null;
  teamCrestUrl: string | null;
  competitionName: string;
  competitionLogoUrl: string | null;
}

export interface PlayerPoster {
  name: string;
  numberLabel: string | null;
  roleLine: string;
  photoUrl: string | null;
  monogram: string;
  /** "SOLD" / "UNSOLD" / "RETAINED" / "ICON" — the stamp. */
  stamp: string;
  /** Formatted money, or null when the outcome carries none. */
  priceLabel: string | null;
  /** "SOLD TO <team>" etc — the sentence under the stamp. */
  outcomeLine: string | null;
  teamName: string | null;
  teamCrestUrl: string | null;
  competitionName: string;
  competitionLogoUrl: string | null;
}

const STAMP: Record<PosterOutcome, string> = {
  sold: "SOLD",
  unsold: "UNSOLD",
  retained: "RETAINED",
  icon: "ICON",
};

/** Names wrap badly on a poster long before they are truncated in a list. */
function clamp(value: string, max: number): string {
  const trimmed = value.trim();
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max - 1).trimEnd()}…`;
}

export function monogramOf(name: string): string {
  /*
   * Each word is stripped to its letters and digits BEFORE its initial is
   * taken, not merely tested for having one. "Demo Cup (settled)" produced
   * "D(" on a real poster: the bracketed word passed a has-a-letter filter and
   * then handed over its opening parenthesis as its first character. Any name
   * with a bracket, a quote or a dash does the same, and a competition suffix
   * in brackets is an ordinary way to name a season.
   */
  const parts = name
    .trim()
    .split(/\s+/)
    .map((part) => part.replace(/[^a-z0-9]/gi, ""))
    .filter((part) => part !== "");
  if (parts.length === 0) {
    return "?";
  }
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "";
  return (first + last).toUpperCase();
}

/**
 * A price is rendered ONLY for a sale. An unsold player with a number under it
 * reads as a valuation nobody made, and a retained player's fee is not the
 * auction's business to publish.
 */
export function buildPlayerPoster(input: PlayerPosterInput): PlayerPoster {
  const sold = input.outcome === "sold" && input.pricePaise !== null;
  const priceLabel =
    sold && input.pricePaise !== null ? formatPaiseINR(paise(input.pricePaise)) : null;
  const outcomeLine =
    input.teamName === null
      ? input.outcome === "unsold"
        ? "Unsold"
        : null
      : input.outcome === "retained"
        ? `RETAINED BY ${clamp(input.teamName, 22).toUpperCase()}`
        : input.outcome === "icon"
          ? `ICON · ${clamp(input.teamName, 22).toUpperCase()}`
          : `SOLD TO ${clamp(input.teamName, 22).toUpperCase()}`;
  return {
    name: clamp(input.playerName, 22),
    numberLabel: input.number === null || input.number.trim() === "" ? null : input.number.trim(),
    roleLine: roleLabel(input.role),
    photoUrl: input.photoUrl,
    monogram: monogramOf(input.playerName),
    stamp: STAMP[input.outcome],
    priceLabel,
    outcomeLine,
    teamName: input.teamName === null ? null : clamp(input.teamName, 24),
    teamCrestUrl: input.teamCrestUrl,
    competitionName: clamp(input.competitionName, 34),
    competitionLogoUrl: input.competitionLogoUrl,
  };
}

export interface TeamPosterMember {
  name: string;
  role: string;
  /** Integer paise, or null for a pre-signed icon/retained player. */
  pricePaise: number | null;
  marker: "icon" | "retained" | "captain" | null;
}

export interface TeamPosterInput {
  teamName: string;
  teamCrestUrl: string | null;
  competitionName: string;
  competitionLogoUrl: string | null;
  members: readonly TeamPosterMember[];
  /** Integer paise committed at the hammer. */
  spentPaise: number;
  /** Integer paise the franchise started with. */
  pursePaise: number;
}

export interface TeamPosterRow {
  name: string;
  roleLine: string;
  priceLabel: string | null;
  markerLabel: string | null;
}

export interface TeamPoster {
  teamName: string;
  teamCrestUrl: string | null;
  competitionName: string;
  competitionLogoUrl: string | null;
  rows: readonly TeamPosterRow[];
  squadLabel: string;
  spentLabel: string;
  remainingLabel: string;
}

const MARKER: Record<NonNullable<TeamPosterMember["marker"]>, string> = {
  icon: "ICON",
  retained: "RET",
  captain: "C",
};

/**
 * The squad poster — the one an OWNER posts, and the more valuable of the two:
 * one image covers fifteen players and lands in the group where next season's
 * organizers are already reading.
 *
 * Rows are NOT truncated to a fixed count here. How many fit is a layout
 * question and belongs to the renderer, which knows the size it is drawing;
 * silently dropping players in a pure model would mean a squad poster that
 * quietly omits somebody's name.
 */
export function buildTeamPoster(input: TeamPosterInput): TeamPoster {
  const remaining = Math.max(0, input.pursePaise - input.spentPaise);
  return {
    teamName: clamp(input.teamName, 24),
    teamCrestUrl: input.teamCrestUrl,
    competitionName: clamp(input.competitionName, 34),
    competitionLogoUrl: input.competitionLogoUrl,
    rows: input.members.map((member) => ({
      name: clamp(member.name, 20),
      roleLine: roleLabel(member.role),
      priceLabel: member.pricePaise === null ? null : formatPaiseINR(paise(member.pricePaise)),
      markerLabel: member.marker === null ? null : MARKER[member.marker],
    })),
    squadLabel: `${String(input.members.length)} player${input.members.length === 1 ? "" : "s"}`,
    spentLabel: formatPaiseINR(paise(input.spentPaise)),
    remainingLabel: formatPaiseINR(paise(remaining)),
  };
}
