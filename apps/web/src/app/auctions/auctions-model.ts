import type { AuctionLink, AuctionNightStatus } from "../../server/console/auctions-index";

/**
 * /auctions, put into sections and sentences — pure, so the order a night is
 * listed in and what its card says it is waiting for are unit tests.
 */

interface NightFacts {
  readonly startsOn: string | null;
  readonly roleLabel: string;
  readonly links: readonly AuctionLink[];
  readonly facts: {
    readonly status: AuctionNightStatus;
    readonly lotsTotal: number;
    readonly teams: number;
  };
}

export interface NightSections<T> {
  /** Live or paused — the one place anyone should be right now. */
  readonly live: T[];
  /** Not set up or scheduled, soonest first; undated ones last. */
  readonly upcoming: T[];
  /** Completed or settled, newest first. */
  readonly finished: T[];
}

const byStart = (a: NightFacts, b: NightFacts): number =>
  (a.startsOn ?? "9999") < (b.startsOn ?? "9999")
    ? -1
    : (a.startsOn ?? "9999") > (b.startsOn ?? "9999")
      ? 1
      : 0;

export function nightSections<T extends NightFacts>(cards: readonly T[]): NightSections<T> {
  const live = cards.filter(
    (card) => card.facts.status === "live" || card.facts.status === "paused",
  );
  const upcoming = cards
    .filter((card) => card.facts.status === "none" || card.facts.status === "scheduled")
    .sort(byStart);
  const finished = cards
    .filter((card) => card.facts.status === "completed" || card.facts.status === "settled")
    .sort((a, b) => byStart(b, a));
  return { live, upcoming, finished };
}

/** The words on a door: what it does here, not the page it opens. */
export function doorLabel(link: AuctionLink, status: AuctionNightStatus): string {
  if (link.label === "Setup") return status === "none" ? "Set up the auction" : "Rules & setup";
  if (link.label === "Cockpit") return "Open the cockpit";
  if (link.label === "Live room") return "Enter the live room";
  return link.label;
}

/**
 * What a night that hasn't opened is waiting for, said to whoever is reading:
 * the organizer can fix it, everyone else can only wait for it.
 */
export function waitingLine(card: NightFacts): { lead: string; rest: string } {
  const organizer = card.links.some((link) => link.label === "Setup");
  if (card.facts.status === "none") {
    if (organizer) {
      return {
        lead: "Set the purse and rules",
        rest: " to create the auction — then owners can be invited.",
      };
    }
    return card.roleLabel === "Auctioneer"
      ? {
          lead: "Waiting on the organizer",
          rest: " to set the purse and rules. You'll run it from the cockpit when they do.",
        }
      : { lead: "Waiting on the organizer", rest: " to set up the auction." };
  }
  const teams = card.facts.teams === 1 ? "1 team" : `${String(card.facts.teams)} teams`;
  return {
    lead: "Ready to open",
    rest:
      card.facts.lotsTotal > 0
        ? ` · ${String(card.facts.lotsTotal)} lots queued for ${teams}`
        : ` · ${teams}`,
  };
}

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

/** The date tile's two lines — "OCT" over "12" — from an ISO date; null when undated. */
export function dateTile(iso: string | null): { month: string; day: string } | null {
  if (iso === null || !/^\d{4}-\d{2}-\d{2}/.test(iso)) return null;
  const month = MONTHS[Number(iso.slice(5, 7)) - 1];
  return month === undefined ? null : { month, day: iso.slice(8, 10) };
}
