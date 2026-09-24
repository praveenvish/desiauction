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

import { formatAmount, paise, type MoneyUnit } from "./money";
import { roleLabel } from "./player-profile";

/**
 * A theme is a DESIGN: a layout family plus a palette.
 *
 * Three families, because the founder asked for variety that reads as three
 * different posters rather than one poster in four colours:
 *
 * - `floodlight` / `gold` / `arena` / `ink` — the CLASSIC family: the product's
 *   own card, a wash of light over a dark (or, for `ink`, paper) ground.
 * - `matchday` — the team's own colour IS the poster. Loud, made for the group.
 * - `minimal` — light editorial: paper, one hairline of team colour, air.
 *
 * Every family draws every poster kind, and the team colour drives the accents
 * in all of them, so the choice is mood, never "which one works for squads".
 */
export const POSTER_THEMES = ["floodlight", "matchday", "minimal", "gold", "arena", "ink"] as const;
export type PosterTheme = (typeof POSTER_THEMES)[number];

export function isPosterTheme(value: string): value is PosterTheme {
  return (POSTER_THEMES as readonly string[]).includes(value);
}

/**
 * Square for a feed, 4:5 portrait for an Instagram/Facebook post (the tallest
 * shape a feed shows uncropped), and 9:16 for a Status/Story. All 1080 wide
 * because that is what every Indian phone uploads without re-compressing to
 * mush — and none is the 1200x630 the link-preview cards use, which is the wrong
 * shape for the places these are actually posted.
 */
export const POSTER_SIZES = {
  square: { width: 1080, height: 1080 },
  portrait: { width: 1080, height: 1350 },
  story: { width: 1080, height: 1920 },
} as const;
export type PosterSize = keyof typeof POSTER_SIZES;

export function isPosterSize(value: string): value is PosterSize {
  return value === "square" || value === "portrait" || value === "story";
}

/**
 * WHAT A POSTER IS OF.
 *
 * `player` and `team` are the two the studio always had. `reveal` is the same
 * squad announced rather than accounted for ("Meet the squad" — faces, no
 * money). `top` and `season` read the whole auction, which is why they are
 * organizer-only upstream: a rival owner may not publish another team's prices.
 */
export const POSTER_KINDS = ["player", "team", "reveal", "top", "season"] as const;
export type PosterKind = (typeof POSTER_KINDS)[number];

export function isPosterKind(value: string): value is PosterKind {
  return (POSTER_KINDS as readonly string[]).includes(value);
}

/**
 * The shapes each kind is drawn in. Every squad in the season on a 1080 square
 * is a contact sheet of thumbnails nobody can read, so `season` is tall-only.
 */
export const POSTER_KIND_SIZES: Record<PosterKind, readonly PosterSize[]> = {
  player: ["square", "portrait", "story"],
  team: ["square", "portrait", "story"],
  reveal: ["square", "portrait", "story"],
  top: ["square", "portrait", "story"],
  season: ["portrait", "story"],
};

/** Top-N is a choice from three, not a free number: 7 rows has no layout. */
export const TOP_BUY_COUNTS = [3, 5, 10] as const;
export type TopBuyCount = (typeof TOP_BUY_COUNTS)[number];

export function isTopBuyCount(value: number): value is TopBuyCount {
  return (TOP_BUY_COUNTS as readonly number[]).includes(value);
}

/**
 * A team colour as the renderer may use it: `#RRGGBB`, uppercase, or null.
 *
 * The column is free text an organizer typed into a colour picker, and it ends
 * up inside a CSS string at raster time. Anything that is not a plain hex —
 * `red`, `url(...)`, a stray semicolon — is refused rather than interpolated.
 */
export function normalizeHexColor(value: string | null | undefined): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  const trimmed = value.trim();
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(trimmed);
  if (short !== null) {
    const [, r = "", g = "", b = ""] = short;
    return `#${r}${r}${g}${g}${b}${b}`.toUpperCase();
  }
  return /^#[0-9a-f]{6}$/i.test(trimmed) ? trimmed.toUpperCase() : null;
}

/** How the sale reads. `sold` is the only one that carries a price. */
/**
 * `captain` is a pre-signed outcome like `icon` and `retained`: a captain the
 * team picked before the night never went to the block, so SOLD would be false
 * and there is no other verdict to print.
 *
 * `pool` is the one outcome that is not a verdict: an approved player whose
 * lot has not come up yet. It is still a true sentence — "I am in the auction,
 * bid for me" — and it is the card a player posts BEFORE the night, which is
 * when a share can still bring a bidder into the room.
 */
export type PosterOutcome = "sold" | "unsold" | "retained" | "icon" | "captain" | "pool";

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
  /** The buying team's colour, normalized upstream by `normalizeHexColor`. */
  teamColor?: string | null;
  competitionName: string;
  competitionLogoUrl: string | null;
  /** What the season's auction counts in: prices print as "₹…" or "… pts". */
  unit: MoneyUnit;
  /** The shirt number the organizer assigned; drawn as the hero when present. */
  jerseyNumber?: string | null;
  /** The auction's lot number, once the player has one. */
  lotNumber?: string | null;
  /** Integer paise. Only a `pool` player's opening price is printed. */
  basePricePaise?: number | null;
}

export interface PlayerPoster {
  name: string;
  numberLabel: string | null;
  roleLine: string;
  photoUrl: string | null;
  monogram: string;
  /** "SOLD" / "UNSOLD" / "RETAINED" / "ICON" / "CAPTAIN" — the stamp. */
  stamp: string;
  /** Formatted money, or null when the outcome carries none. */
  priceLabel: string | null;
  /** "SOLD TO <team>" etc — the sentence under the stamp. */
  outcomeLine: string | null;
  teamName: string | null;
  teamCrestUrl: string | null;
  teamColor: string | null;
  competitionName: string;
  competitionLogoUrl: string | null;
  outcome: PosterOutcome;
  /** The name in two voices: a light first name over a heavy surname. */
  firstName: string | null;
  lastName: string;
  /**
   * The big number behind the player: their shirt number, else null. Only a
   * short run of digits qualifies — "07" is a shirt, "R67X349" is a receipt.
   */
  heroNumber: string | null;
  /** "LOT 14", or null before the auction numbers its lots. */
  lotLabel: string | null;
  /** A `pool` player's opening price, formatted; null for every verdict. */
  basePriceLabel: string | null;
}

const STAMP: Record<PosterOutcome, string> = {
  sold: "SOLD",
  unsold: "UNSOLD",
  retained: "RETAINED",
  icon: "ICON",
  captain: "CAPTAIN",
  pool: "IN THE POOL",
};

/**
 * "Rohit Yadav" → { first: "Rohit", last: "Yadav" }; a single name is all
 * surname. The split is on the LAST space: "Mohammed Azharuddin Khan" keeps
 * "Mohammed Azharuddin" together as the light line.
 */
export function splitName(name: string): { first: string | null; last: string } {
  const parts = name
    .trim()
    .split(/\s+/)
    .filter((part) => part !== "");
  if (parts.length <= 1) {
    return { first: null, last: parts[0] ?? name.trim() };
  }
  return { first: parts.slice(0, -1).join(" "), last: parts[parts.length - 1] ?? "" };
}

/**
 * "L003" → "3", "14" → "14". Lot numbers are stored with a prefix and padding
 * for sorting; a poster that says "LOT L003" is reading the database aloud.
 */
export function lotOf(lotNumber: string | null | undefined): string {
  const trimmed = lotNumber?.trim() ?? "";
  const digits = /^[A-Za-z]*0*(\d+)$/.exec(trimmed);
  return digits?.[1] ?? trimmed;
}

/** A shirt number worth drawing three feet tall: one to three digits, nothing else. */
export function heroNumberOf(jersey: string | null | undefined): string | null {
  const trimmed = jersey?.trim() ?? "";
  return /^\d{1,3}$/.test(trimmed) ? trimmed : null;
}

/** Names wrap badly on a poster long before they are truncated in a list. */
function clamp(value: string, max: number): string {
  const trimmed = value.trim();
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max - 1).trimEnd()}…`;
}

/**
 * What a crest tile says when the club has no logo.
 *
 * A short name IS the mark — "JW", "MI", "RCB" — so it is printed as itself.
 * Taking initials from it produced "J" for a franchise that had already told us
 * what to call it in two letters.
 */
export function crestMark(shortName: string | null | undefined, name: string): string {
  const short = shortName?.trim() ?? "";
  return short !== "" && short.length <= 4 ? short.toUpperCase() : monogramOf(short || name);
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
    sold && input.pricePaise !== null ? formatAmount(paise(input.pricePaise), input.unit) : null;
  const outcomeLine =
    input.outcome === "pool"
      ? null
      : input.teamName === null
        ? input.outcome === "unsold"
          ? "Unsold"
          : null
        : input.outcome === "retained"
          ? `RETAINED BY ${clamp(input.teamName, 22).toUpperCase()}`
          : input.outcome === "icon"
            ? `ICON · ${clamp(input.teamName, 22).toUpperCase()}`
            : input.outcome === "captain"
              ? `CAPTAIN · ${clamp(input.teamName, 22).toUpperCase()}`
              : `SOLD TO ${clamp(input.teamName, 22).toUpperCase()}`;
  const name = clamp(input.playerName, 22);
  // Split the WHOLE name, then clamp each voice: clamping first turned
  // "Venkataraghavan Subramaniam" into a surname of "Subra…". The renderer
  // shrinks a long surname to fit; it cannot un-truncate one.
  const split = splitName(input.playerName);
  const first = split.first === null ? null : clamp(split.first, 24);
  const last = clamp(split.last, 16);
  const lot = lotOf(input.lotNumber);
  const base = input.outcome === "pool" ? (input.basePricePaise ?? null) : null;
  return {
    name,
    outcome: input.outcome,
    firstName: first,
    lastName: last,
    heroNumber: heroNumberOf(input.jerseyNumber),
    lotLabel: lot === "" ? null : `LOT ${lot}`,
    basePriceLabel: base === null || base <= 0 ? null : formatAmount(paise(base), input.unit),
    numberLabel: input.number === null || input.number.trim() === "" ? null : input.number.trim(),
    roleLine: roleLabel(input.role),
    photoUrl: input.photoUrl,
    monogram: monogramOf(input.playerName),
    stamp: STAMP[input.outcome],
    priceLabel,
    outcomeLine,
    // A pool player has no team yet, whatever a stale row says.
    teamName:
      input.outcome === "pool" || input.teamName === null ? null : clamp(input.teamName, 24),
    teamCrestUrl: input.outcome === "pool" ? null : input.teamCrestUrl,
    teamColor: normalizeHexColor(input.teamColor),
    competitionName: clamp(input.competitionName, 34),
    competitionLogoUrl: input.competitionLogoUrl,
  };
}

/** A shorter handle for a small tile: "Prakash Bishnoi" → "Prakash B." */
export function shortNameOf(name: string): string {
  const parts = name
    .trim()
    .split(/\s+/)
    .filter((part) => part !== "");
  if (parts.length <= 1) {
    return clamp(parts[0] ?? name, 14);
  }
  const last = parts[parts.length - 1] ?? "";
  return `${clamp(parts[0] ?? "", 12)} ${last.slice(0, 1).toUpperCase()}.`;
}

/** The smallest handle: the first name alone, for a face the size of a coin. */
export function firstNameOf(name: string): string {
  return clamp(name.trim().split(/\s+/)[0] ?? name, 10);
}

// --- Squad ------------------------------------------------------------------

/**
 * How a player joined the squad without (or besides) the hammer. A player can
 * be an icon AND the captain — the marks are a set, not a single label.
 */
export type PosterMark = "icon" | "captain" | "retained";

export interface TeamPosterMember {
  name: string;
  role: string;
  /** Integer paise, or null for a pre-signed icon/retained/captain player. */
  pricePaise: number | null;
  marks: readonly PosterMark[];
  /**
   * Consent- AND age-gated upstream (a poster is public the moment it is
   * forwarded). Null means the initials tile, never a broken image.
   */
  photoUrl: string | null;
}

export interface TeamPosterInput {
  teamName: string;
  teamShortName?: string | null;
  teamCrestUrl: string | null;
  /** Free text from the team form; normalized here, never trusted. */
  teamColor?: string | null;
  coachName?: string | null;
  competitionName: string;
  competitionLogoUrl: string | null;
  members: readonly TeamPosterMember[];
  /** Integer paise committed at the hammer. */
  spentPaise: number;
  /** Integer paise the franchise started with. */
  pursePaise: number;
  /** What the season's auction counts in: prices print as "₹…" or "… pts". */
  unit: MoneyUnit;
}

export interface TeamPosterRow {
  name: string;
  /** For a tile too narrow for the full name. */
  shortName: string;
  firstName: string;
  monogram: string;
  roleLine: string;
  priceLabel: string | null;
  /** The ONE label a table row has room for — "ICON", "RET" or "C". */
  markerLabel: string | null;
  /** Every mark, for a face tile: "C" and "ICON" can both apply. */
  badges: readonly string[];
  isCaptain: boolean;
  photoUrl: string | null;
}

export interface TeamPoster {
  teamName: string;
  teamMonogram: string;
  teamCrestUrl: string | null;
  teamColor: string | null;
  coachName: string | null;
  /** The first captain's name, for the "Captain · X" line. */
  captainName: string | null;
  competitionName: string;
  competitionLogoUrl: string | null;
  rows: readonly TeamPosterRow[];
  squadLabel: string;
  spentLabel: string;
  remainingLabel: string;
}

const BADGE: Record<PosterMark, string> = {
  captain: "C",
  icon: "ICON",
  retained: "RET",
};

/** Marks in the order they are read: the captain's armband before the rest. */
const MARK_ORDER: readonly PosterMark[] = ["captain", "icon", "retained"];

/** Where a member sits on the sheet: the captain leads, then the pre-signed. */
function rankOf(member: TeamPosterMember): number {
  if (member.marks.includes("captain")) {
    return 0;
  }
  if (member.marks.includes("icon")) {
    return 1;
  }
  return member.marks.includes("retained") ? 2 : 3;
}

function rowOf(member: TeamPosterMember, unit: MoneyUnit): TeamPosterRow {
  const marks = MARK_ORDER.filter((mark) => member.marks.includes(mark));
  // A table row has room for one word; ICON is the one people look for, and
  // "C" beside a price is the captain the room bought.
  const primary = marks.includes("icon") ? "icon" : (marks[0] ?? null);
  return {
    name: clamp(member.name, 20),
    shortName: shortNameOf(member.name),
    firstName: firstNameOf(member.name),
    monogram: monogramOf(member.name),
    roleLine: roleLabel(member.role),
    priceLabel: member.pricePaise === null ? null : formatAmount(paise(member.pricePaise), unit),
    markerLabel: primary === null ? null : BADGE[primary],
    badges: marks.map((mark) => BADGE[mark]),
    isCaptain: marks.includes("captain"),
    photoUrl: member.photoUrl,
  };
}

/**
 * The squad poster — the one an OWNER posts, and the more valuable of the two:
 * one image covers fifteen players and lands in the group where next season's
 * organizers are already reading.
 *
 * Rows are NOT truncated to a fixed count here. How many fit is a layout
 * question and belongs to the renderer, which knows the size it is drawing;
 * silently dropping players in a pure model would mean a squad poster that
 * quietly omits somebody's name.
 *
 * The ORDER is decided here: captain first, then icons, then retained, then the
 * room's purchases in the order they arrived (the source sends them priciest
 * first). A stable sort, so equal ranks keep the source's order.
 */
export function buildTeamPoster(input: TeamPosterInput): TeamPoster {
  const remaining = Math.max(0, input.pursePaise - input.spentPaise);
  const ordered = input.members
    .map((member, index) => ({ member, index }))
    .sort((a, b) => rankOf(a.member) - rankOf(b.member) || a.index - b.index)
    .map(({ member }) => member);
  const captain = ordered.find((member) => member.marks.includes("captain"));
  const coach = input.coachName?.trim() ?? "";
  return {
    teamName: clamp(input.teamName, 24),
    teamMonogram: crestMark(input.teamShortName, input.teamName),
    teamCrestUrl: input.teamCrestUrl,
    teamColor: normalizeHexColor(input.teamColor),
    coachName: coach === "" ? null : clamp(coach, 24),
    captainName: captain === undefined ? null : clamp(captain.name, 24),
    competitionName: clamp(input.competitionName, 34),
    competitionLogoUrl: input.competitionLogoUrl,
    rows: ordered.map((member) => rowOf(member, input.unit)),
    squadLabel: `${String(input.members.length)} player${input.members.length === 1 ? "" : "s"}`,
    spentLabel: formatAmount(paise(input.spentPaise), input.unit),
    remainingLabel: formatAmount(paise(remaining), input.unit),
  };
}

// --- Top buys ---------------------------------------------------------------

export interface TopBuyInput {
  playerName: string;
  role: string;
  photoUrl: string | null;
  /** Integer paise. Only SOLD lots are buys; the source never sends others. */
  pricePaise: number;
  teamName: string;
  teamColor?: string | null;
  teamCrestUrl: string | null;
}

export interface TopBuysPosterInput {
  competitionName: string;
  competitionLogoUrl: string | null;
  buys: readonly TopBuyInput[];
  count: TopBuyCount;
  /** What the season's auction counts in: prices print as "₹…" or "… pts". */
  unit: MoneyUnit;
}

export interface TopBuyRow {
  rank: number;
  /** "01" — a two-digit rank reads as a chart position, "1" as a list item. */
  rankLabel: string;
  name: string;
  shortName: string;
  monogram: string;
  roleLine: string;
  priceLabel: string;
  teamName: string;
  teamMonogram: string;
  teamColor: string | null;
  teamCrestUrl: string | null;
  photoUrl: string | null;
}

export interface TopBuysPoster {
  competitionName: string;
  competitionLogoUrl: string | null;
  /** "TOP 5 BUYS" — or fewer, honestly, when fewer were sold. */
  title: string;
  chip: string;
  rows: readonly TopBuyRow[];
}

/**
 * The night's biggest signings, ranked.
 *
 * The title counts what is ON the poster, not what was asked for: a season
 * that sold three players asked for a "Top 5" gets "TOP 3 BUYS", because a
 * headline promising five above three rows is the kind of small lie that makes
 * everything under it look made up. Ties keep the source's order (it sorts by
 * price, then by sale), so the same night always ranks the same way.
 */
export function buildTopBuysPoster(input: TopBuysPosterInput): TopBuysPoster {
  const ranked = input.buys
    .map((buy, index) => ({ buy, index }))
    .sort((a, b) => b.buy.pricePaise - a.buy.pricePaise || a.index - b.index)
    .slice(0, input.count)
    .map(({ buy }, index): TopBuyRow => ({
      rank: index + 1,
      rankLabel: String(index + 1).padStart(2, "0"),
      name: clamp(buy.playerName, 22),
      shortName: shortNameOf(buy.playerName),
      monogram: monogramOf(buy.playerName),
      roleLine: roleLabel(buy.role),
      priceLabel: formatAmount(paise(buy.pricePaise), input.unit),
      teamName: clamp(buy.teamName, 22),
      teamMonogram: monogramOf(buy.teamName),
      teamColor: normalizeHexColor(buy.teamColor),
      teamCrestUrl: buy.teamCrestUrl,
      photoUrl: buy.photoUrl,
    }));
  const shown = ranked.length;
  return {
    competitionName: clamp(input.competitionName, 34),
    competitionLogoUrl: input.competitionLogoUrl,
    title: shown === 1 ? "TOP BUY" : `TOP ${String(shown)} BUYS`,
    chip: `Top ${String(shown)}`,
    rows: ranked,
  };
}

// --- Season: every squad ----------------------------------------------------

export interface SeasonSquadInput {
  teamName: string;
  teamShortName?: string | null;
  teamColor?: string | null;
  teamCrestUrl: string | null;
  members: readonly TeamPosterMember[];
  spentPaise: number;
}

export interface SeasonPosterInput {
  competitionName: string;
  competitionLogoUrl: string | null;
  squads: readonly SeasonSquadInput[];
  /** What the season's auction counts in: prices print as "₹…" or "… pts". */
  unit: MoneyUnit;
}

export interface SeasonSquad {
  teamName: string;
  teamMonogram: string;
  teamColor: string | null;
  teamCrestUrl: string | null;
  countLabel: string;
  spentLabel: string;
  rows: readonly TeamPosterRow[];
}

export interface SeasonPoster {
  competitionName: string;
  competitionLogoUrl: string | null;
  chip: string;
  /** "48 players · 6 teams" — the line that holds with prices hidden. */
  countLine: string;
  /** Total committed at the hammer across every squad. */
  spentLabel: string;
  squads: readonly SeasonSquad[];
  /** The largest squad — what the grid has to be sized for. */
  largestSquad: number;
}

/**
 * Every squad on one poster — the "results" sheet a club pins after the night.
 *
 * Squads keep the source's order (alphabetical, like every other team list), and
 * each squad is ordered exactly as its own squad poster orders it, through the
 * same `buildTeamPoster` rules, so the two posters never disagree about who
 * leads a team.
 */
export function buildSeasonPoster(input: SeasonPosterInput): SeasonPoster {
  const squads = input.squads.map((squad): SeasonSquad => {
    const team = buildTeamPoster({
      teamName: squad.teamName,
      teamShortName: squad.teamShortName ?? null,
      teamCrestUrl: squad.teamCrestUrl,
      teamColor: squad.teamColor ?? null,
      competitionName: input.competitionName,
      competitionLogoUrl: input.competitionLogoUrl,
      members: squad.members,
      spentPaise: squad.spentPaise,
      pursePaise: squad.spentPaise,
      unit: input.unit,
    });
    return {
      teamName: clamp(squad.teamName, 20),
      teamMonogram: team.teamMonogram,
      teamColor: team.teamColor,
      teamCrestUrl: squad.teamCrestUrl,
      countLabel: team.squadLabel,
      spentLabel: team.spentLabel,
      rows: team.rows,
    };
  });
  const players = input.squads.reduce((total, squad) => total + squad.members.length, 0);
  const spent = input.squads.reduce((total, squad) => total + squad.spentPaise, 0);
  const teamsLabel = `${String(squads.length)} team${squads.length === 1 ? "" : "s"}`;
  return {
    competitionName: clamp(input.competitionName, 34),
    competitionLogoUrl: input.competitionLogoUrl,
    chip: teamsLabel,
    countLine: `${String(players)} player${players === 1 ? "" : "s"} · ${teamsLabel}`,
    spentLabel: formatAmount(paise(spent), input.unit),
    squads,
    largestSquad: squads.reduce((max, squad) => Math.max(max, squad.rows.length), 0),
  };
}
