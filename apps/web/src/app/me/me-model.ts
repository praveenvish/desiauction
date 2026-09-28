import type { ProfileItem } from "@desiauction/core";

import type { CareerMatch } from "../../server/player/career";

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
