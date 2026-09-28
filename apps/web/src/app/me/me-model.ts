import type { ProfileItem } from "@desiauction/core";

import type { CareerMatch, CareerSeason } from "../../server/player/career";

/**
 * MY SPORTS, put into words — pure, so every sentence the page says about a
 * player's record is a unit test.
 */

/** What each missing profile item asks for, in the order worth asking. */
const ASK: Readonly<Record<ProfileItem, string>> = {
  photo: "a photo",
  role: "your playing role",
  style: "your playing style",
  date_of_birth: "your date of birth",
  location: "where you play",
  name: "your name",
  email: "a verified email",
  passkey: "a passkey",
};
const ORDER: readonly ProfileItem[] = [
  "photo",
  "role",
  "style",
  "date_of_birth",
  "location",
  "name",
  "email",
  "passkey",
];

/**
 * "Profile 2 of 8 — finish it" never said what was missing. This names the
 * first two things worth adding and counts the rest: "Add a photo, your
 * playing role and 4 more". Null when nothing is missing.
 */
export function profileAsk(missing: readonly ProfileItem[]): string | null {
  const ordered = ORDER.filter((item) => missing.includes(item));
  if (ordered.length === 0) return null;
  const named = ordered.slice(0, 2).map((item) => ASK[item]);
  const rest = ordered.length - named.length;
  if (rest === 0) {
    return `Add ${named.length === 2 ? `${named[0] ?? ""} and ${named[1] ?? ""}` : (named[0] ?? "")}`;
  }
  return `Add ${named.join(", ")} and ${String(rest)} more`;
}

export interface MatchRecord {
  readonly played: number;
  readonly won: number;
  readonly lost: number;
  readonly tied: number;
}

/** Wins and losses over the matches the team finished — the header's record. */
export function matchRecord(matches: readonly Pick<CareerMatch, "result">[]): MatchRecord {
  let won = 0;
  let lost = 0;
  let tied = 0;
  for (const match of matches) {
    if (match.result === "won") won += 1;
    else if (match.result === "lost") lost += 1;
    else if (match.result === "tied") tied += 1;
  }
  return { played: won + lost + tied, won, lost, tied };
}

/**
 * Whether the "You" column says anything. It read "Not recorded" on every row
 * until a club records lineups; until one does, the column is not drawn.
 */
export function anyLineupRecorded(matches: readonly Pick<CareerMatch, "played">[]): boolean {
  return matches.some((match) => match.played !== "unknown");
}

/*
 * MY PROFILE (the unified player page). The career used to be split between
 * /me and a per-sport /me/[sport]; one page now answers "who is this player":
 * the sports, the seasons still live, the career, the clubs and the matches.
 */

type SeasonFacts = Pick<
  CareerSeason,
  "status" | "auction" | "teamName" | "endsOn" | "startsOn" | "auctionStatus"
>;

/** The four steps every live season is drawn on, in the order a player lives them. */
export const STAGE_STEPS = ["Registered", "Approved", "Auction", "Season"] as const;

export type LiveStage =
  | { readonly at: 0; readonly kind: "waiting" | "waitlisted" }
  | { readonly at: 2; readonly kind: "pool" | "auction_live" }
  | { readonly at: 3; readonly kind: "season" };

/** A season with no end date is taken as over a year after it started. */
function seasonOver(season: SeasonFacts, today: string): boolean {
  if (season.endsOn !== null) {
    return season.endsOn < today;
  }
  if (season.startsOn === null) {
    return false;
  }
  const year = Number(season.startsOn.slice(0, 4));
  return `${String(year + 1)}${season.startsOn.slice(4, 10)}` < today;
}

/**
 * Where a season stands FOR THIS PLAYER while it is still theirs to live —
 * null once it is over for them (finished, unsold, turned down, withdrawn).
 */
export function liveStage(season: SeasonFacts, today: string): LiveStage | null {
  if (seasonOver(season, today)) {
    return null;
  }
  if (season.status === "submitted") return { at: 0, kind: "waiting" };
  if (season.status === "waitlisted") return { at: 0, kind: "waitlisted" };
  if (season.status !== "approved") return null;
  if (season.auction?.kind === "unsold") return null;
  if (season.auction !== null || season.teamName !== null) return { at: 3, kind: "season" };
  return season.auctionStatus === "live" || season.auctionStatus === "paused"
    ? { at: 2, kind: "auction_live" }
    : { at: 2, kind: "pool" };
}

export interface ClubLine {
  readonly name: string;
  readonly seasons: number;
}

/** Every club this person has entered a season with — most seasons first. */
export function clubsOf(seasons: readonly Pick<CareerSeason, "orgName">[]): ClubLine[] {
  const counts = new Map<string, number>();
  for (const season of seasons) {
    counts.set(season.orgName, (counts.get(season.orgName) ?? 0) + 1);
  }
  return [...counts]
    .map(([name, count]) => ({ name, seasons: count }))
    .sort((a, b) => b.seasons - a.seasons);
}

export type FormResult = "W" | "L" | "T";

/** The last `size` finished results, oldest first — so the row reads left to right in time. */
export function recentForm(
  matches: readonly Pick<CareerMatch, "result">[],
  size = 5,
): FormResult[] {
  const letters: FormResult[] = [];
  for (const match of matches) {
    if (letters.length === size) break;
    if (match.result === "won") letters.push("W");
    else if (match.result === "lost") letters.push("L");
    else if (match.result === "tied") letters.push("T");
  }
  return letters.reverse();
}

/** "2 played · 2 won" for one season, or null before its first finished match. */
export function seasonRecordLine(
  matches: readonly Pick<CareerMatch, "result" | "registrationId">[],
  registrationId: string,
): string | null {
  const record = matchRecord(matches.filter((match) => match.registrationId === registrationId));
  return record.played === 0 ? null : `${String(record.played)} played · ${String(record.won)} won`;
}

/**
 * How often the auction took them: sold nights out of the nights they went
 * under the hammer. Pre-signed seasons never went, so they count in neither.
 */
export function soldOf(seasons: readonly Pick<CareerSeason, "auction">[]): {
  sold: number;
  auctioned: number;
} {
  let sold = 0;
  let auctioned = 0;
  for (const season of seasons) {
    if (season.auction?.kind === "sold") {
      sold += 1;
      auctioned += 1;
    } else if (season.auction?.kind === "unsold") {
      auctioned += 1;
    }
  }
  return { sold, auctioned };
}
