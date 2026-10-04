import { initialsOf as lettersOf } from "@desiauction/core/initials";
import { formatCount } from "../../lib/plural";

/**
 * WHERE A SEASON IS, AND THE ONE THING IT IS WAITING FOR — pure, so the
 * tournaments index and a tournament's page cannot disagree, and a test pins
 * both answers.
 *
 * The index used to file seasons by the competition's STATUS column (draft ·
 * setup · registration open · registration closed), which stops moving once
 * registration closes: a season whose auction was run and whose matches were
 * being played sat under "Registration closed" while its own card said
 * "Auction done". The stage reads the later facts first — the books, the
 * auction, the matches — the way `seasonStatusBadge` already did for the
 * badge, so a filter and a badge now use one vocabulary.
 */

export type StageKey = "setup" | "registration" | "auction" | "season" | "finished";

export interface StageInput {
  readonly slug: string;
  readonly status: string;
  readonly endsOn: string | null;
  readonly auctionUnit: "inr" | "points";
  readonly settlement: "settling" | "settled" | null;
  readonly counts: {
    readonly teams: number;
    readonly matches: number;
    readonly pending: number;
    readonly auctionDone?: boolean | undefined;
    readonly approved?: number | undefined;
    readonly live?: number | undefined;
    readonly due?: number | undefined;
    readonly played?: number | undefined;
  };
}

export const STAGE_LABEL: Record<StageKey, string> = {
  setup: "Setting up",
  registration: "Registration open",
  auction: "Auction next",
  season: "Season on",
  finished: "Finished",
};

/** The stages in the order a season lives them — the filter chips' order. */
export const STAGE_ORDER: readonly StageKey[] = [
  "setup",
  "registration",
  "auction",
  "season",
  "finished",
];

export function seasonStage(season: StageInput, today: string): StageKey {
  if (season.settlement === "settled") {
    return "finished";
  }
  const auctionDone = season.counts.auctionDone === true || season.settlement === "settling";
  if (auctionDone) {
    // A points season has no books to close, so it ends with its dates — and
    // only once nothing is still being played.
    const over =
      season.auctionUnit === "points" &&
      season.endsOn !== null &&
      season.endsOn < today &&
      (season.counts.live ?? 0) === 0 &&
      (season.counts.due ?? 0) === 0;
    return over ? "finished" : "season";
  }
  if (season.status === "registration_closed") {
    return "auction";
  }
  if (season.status === "registration_open") {
    return "registration";
  }
  return "setup";
}

export interface NextStep {
  /** The button's words. */
  readonly label: string;
  readonly href: string;
  /** One line under the step, saying why. */
  readonly why: string;
  /** Waiting on a person right now — the gold button. */
  readonly urgent: boolean;
}

/** The season's one next step, or null for a finished one. */
export function nextStep(season: StageInput, today: string): NextStep | null {
  const base = `/seasons/${season.slug}`;
  const { counts } = season;
  const live = counts.live ?? 0;
  const due = counts.due ?? 0;
  const played = counts.played ?? 0;
  switch (seasonStage(season, today)) {
    case "setup":
      return {
        label: "Finish setup",
        href: base,
        why:
          counts.teams === 0
            ? "Add the teams, then open registration"
            : "Open registration when you are ready",
        urgent: false,
      };
    case "registration":
      return counts.pending > 0
        ? {
            label: `Review ${formatCount(counts.pending)}`,
            href: `${base}/registrations`,
            why: `${formatCount(counts.pending)} ${counts.pending === 1 ? "player is" : "players are"} waiting for you`,
            urgent: true,
          }
        : {
            label: "Registrations",
            href: `${base}/registrations`,
            why: `${formatCount(counts.approved ?? 0)} approved so far`,
            urgent: false,
          };
    case "auction":
      return {
        label: "Go to the auction",
        href: `${base}/auction`,
        why: "Registration is closed — auction night is next",
        urgent: true,
      };
    case "season":
      // A result owed from an earlier day outranks a match being played: the
      // one being played will want its score soon; this one already does.
      if (due > 0) {
        return {
          label: "Enter results",
          href: `${base}/fixtures`,
          why: `${formatCount(due)} ${due === 1 ? "match needs" : "matches need"} a result`,
          urgent: true,
        };
      }
      if (live > 0) {
        return {
          label: "Enter score",
          href: `${base}/fixtures`,
          why: `${formatCount(live)} ${live === 1 ? "match is" : "matches are"} being played now`,
          urgent: true,
        };
      }
      if (counts.matches === 0) {
        return {
          label: "Build the schedule",
          href: `${base}/fixtures`,
          why: "The squads are picked — the matches come next",
          urgent: true,
        };
      }
      if (season.settlement === "settling") {
        return {
          label: "Settle the money",
          href: `${base}/money`,
          why: "The books are open",
          urgent: false,
        };
      }
      return {
        label: "Schedule",
        href: `${base}/fixtures`,
        why: `${formatCount(played)} of ${formatCount(counts.matches)} matches played`,
        urgent: false,
      };
    case "finished":
      return null;
  }
}

/**
 * WHAT NEEDS YOU NOW: every season not finished, most pressing first — a match
 * being played, then anything waiting on a person, then the rest by when it
 * starts. Capped: the band is a to-do list, not a second index.
 */
export function needsYou<T extends StageInput & { startsOn: string | null }>(
  seasons: readonly T[],
  today: string,
  cap = 4,
): T[] {
  const weight = (season: T): number => {
    const step = nextStep(season, today);
    if ((season.counts.live ?? 0) > 0 || (season.counts.due ?? 0) > 0) return 0;
    if (step?.urgent === true) return 1;
    return 2;
  };
  return seasons
    .filter((season) => seasonStage(season, today) !== "finished")
    .sort(
      (a, b) => weight(a) - weight(b) || (a.startsOn ?? "9999").localeCompare(b.startsOn ?? "9999"),
    )
    .slice(0, cap);
}

/** "TPL 2026" → "T2"; "Demo Premier League" → "DP" — a crest with no logo. */
export function initialsOf(name: string): string {
  return lettersOf(name, { words: "first-two", singleWord: 2 }) || "?";
}
