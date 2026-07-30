/**
 * Share-card model (Reporting/Acquisition platform). Pure and deterministic:
 * the layout-agnostic normalization behind every social share image the product
 * renders (OpenGraph / Twitter cards on `/c/[slug]`, and — reusing this shape —
 * player and results cards to come). No IO, no JSX, no colors: it turns the
 * public read model into truncated title/organizer text, an honest status
 * label, and a small stat set. The image boundary (Satori/`next/og`) consumes
 * this; the monogram and palette live at that boundary because CSS-variable
 * tokens cannot cross into a rasterizer.
 *
 * Keeping this pure means the WhatsApp/social preview — the acquisition loop the
 * product depends on — is unit-tested for the cases that actually bite:
 * over-long names, missing dates/location, singular vs plural, and the
 * lifecycle → status-label mapping.
 */

import { roleLabel, styleLabel } from "./player-profile";

export interface CompetitionShareCardInput {
  name: string;
  organizer: string;
  location: string | null;
  /** Pre-formatted human date range (never null — callers pass a placeholder). */
  dateRange: string | null;
  teamCount: number;
  playerCount: number;
  /** `competitions.status` (e.g. "registration_open", "completed"). */
  status: string;
  /** `auctions.status` when an auction exists ("live"/"paused"/...), else null. */
  auctionStatus: string | null;
}

export type ShareCardTone = "live" | "open" | "closed";

export interface ShareCardStat {
  label: string;
  value: string;
}

export interface CompetitionShareCard {
  title: string;
  organizer: string;
  /** "Mumbai · 1 – 3 Aug 2026" / "1 – 3 Aug 2026" / null. */
  meta: string | null;
  statusLabel: string;
  statusTone: ShareCardTone;
  /** 0–2 pills; teams then players, each omitted when zero. */
  stats: ShareCardStat[];
}

const MAX_TITLE = 70;
const MAX_ORGANIZER = 48;

/** Trim to a whole-character budget, appending an ellipsis when clipped. */
function truncate(text: string, max: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= max) {
    return trimmed;
  }
  // Reserve one slot for the ellipsis and avoid a trailing space before it.
  return `${trimmed.slice(0, max - 1).trimEnd()}…`;
}

function deriveStatus(input: CompetitionShareCardInput): {
  statusLabel: string;
  statusTone: ShareCardTone;
} {
  if (input.auctionStatus === "live" || input.auctionStatus === "paused") {
    return { statusLabel: "Auction live", statusTone: "live" };
  }
  if (input.auctionStatus === "completed") {
    return { statusLabel: "Auction complete", statusTone: "closed" };
  }
  if (input.status === "registration_open") {
    return { statusLabel: "Registration open", statusTone: "open" };
  }
  return { statusLabel: "Registration closed", statusTone: "closed" };
}

function buildMeta(location: string | null, dateRange: string | null): string | null {
  const parts = [location, dateRange]
    .map((part) => part?.trim() ?? "")
    .filter((part) => part !== "");
  return parts.length === 0 ? null : parts.join(" · ");
}

function buildStats(teamCount: number, playerCount: number): ShareCardStat[] {
  const stats: ShareCardStat[] = [];
  if (teamCount > 0) {
    stats.push({ label: teamCount === 1 ? "Team" : "Teams", value: String(teamCount) });
  }
  if (playerCount > 0) {
    stats.push({ label: playerCount === 1 ? "Player" : "Players", value: String(playerCount) });
  }
  return stats;
}

/**
 * Normalize a public competition into the card model rendered by the OG/Twitter
 * image routes. Never throws: empty name/organizer degrade to sensible defaults
 * so the acquisition preview always renders something branded rather than blank.
 */
export function buildCompetitionShareCard(input: CompetitionShareCardInput): CompetitionShareCard {
  const { statusLabel, statusTone } = deriveStatus(input);
  const title = truncate(input.name, MAX_TITLE) || "Untitled competition";
  const organizer = truncate(input.organizer, MAX_ORGANIZER);
  return {
    title,
    organizer,
    meta: buildMeta(input.location, input.dateRange),
    statusLabel,
    statusTone,
    stats: buildStats(input.teamCount, input.playerCount),
  };
}

export interface PlayerShareCardInput {
  name: string;
  /** Registration number (always present). */
  number: string;
  role: string;
  age: number | null;
  /** Raw enum keys from the DB (labeled here via the core label functions). */
  battingStyle: string | null;
  bowlingStyle: string | null;
  status: "available" | "sold" | "retained";
  teamName: string | null;
  competitionName: string;
}

export interface PlayerShareCard {
  name: string;
  /** "#12 · Sunday Premier League". */
  subtitle: string;
  /** "All-rounder · 24 yrs" (age omitted when unknown). */
  roleLine: string;
  /** "Right Hand Opener · Off-Break", or null when no styles are set. */
  styleLine: string | null;
  statusLabel: string;
  statusTone: ShareCardTone;
}

/** The player's outcome as a label + tone. Being on a team sheet is the
 *  celebratory case and carries the accent (live) tone, whether the place was
 *  won at auction or signed before it opened. The retained branch used to be
 *  absent: anything that was not "sold" fell through to "Available", so the
 *  card for a player who already had a squad advertised them as up for grabs —
 *  on the one artefact of this product that gets forwarded to a group chat. */
function derivePlayerStatus(input: PlayerShareCardInput): {
  statusLabel: string;
  statusTone: ShareCardTone;
} {
  if (input.status === "available") {
    return { statusLabel: "Available", statusTone: "open" };
  }
  const verb = input.status === "retained" ? "Retained by" : "Sold to";
  const bare = input.status === "retained" ? "Retained" : "Sold";
  return {
    statusLabel: input.teamName !== null ? `${verb} ${input.teamName}` : bare,
    statusTone: "live",
  };
}

/**
 * Normalize a single approved player into the card model rendered by the
 * per-player OG/Twitter image routes (`/c/[slug]/p/[number]`). Never throws.
 */
export function buildPlayerShareCard(input: PlayerShareCardInput): PlayerShareCard {
  const name = truncate(input.name, MAX_TITLE) || "Player";
  const subtitle = `#${input.number} · ${truncate(input.competitionName, MAX_ORGANIZER)}`;
  const roleLine =
    input.age !== null
      ? `${roleLabel(input.role)} · ${String(input.age)} yrs`
      : roleLabel(input.role);
  const styleLine = buildMeta(styleLabel(input.battingStyle), styleLabel(input.bowlingStyle));
  const { statusLabel, statusTone } = derivePlayerStatus(input);
  return { name, subtitle, roleLine, styleLine, statusLabel, statusTone };
}
