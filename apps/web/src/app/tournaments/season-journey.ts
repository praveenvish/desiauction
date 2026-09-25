/**
 * ONE SEASON'S ROAD, as the console's journey stepper draws it.
 *
 * The /tournaments feature card and the /home club hero both show where a
 * season is — set up, teams, registration, auction night, settlement — and
 * both used to have nothing to say it with. The states are DERIVED from facts
 * the read models already carry (the competition status, the team count, the
 * auction's own lifecycle and the settlement case's own word), never asserted:
 * a step is done because its fact is true, and the first step that is not done
 * is the current one. Pure, so a test can pin it.
 */

export type JourneyState = "done" | "current" | "upcoming";

export interface SeasonJourneyInput {
  status: string;
  teams: number;
  /** Registrations of any status — the "N registered" hint while open. */
  registrations: number;
  /** The auction's lifecycle, or null before one exists. */
  auctionStatus: string | null;
  /** The settlement case's own word, or null before one is opened. */
  settlement: string | null;
  /**
   * What the auction counts in (0091). A POINTS season has no books, so its
   * last step is the matches, not Settlement — it used to show "Settlement ·
   * Pending" with a rupee mark on a season where nothing will ever be owed, and
   * no Fixtures step at all. Absent reads as rupees, like every season before
   * the unit existed.
   */
  auctionUnit?: "inr" | "points";
  /** Fixtures on the books — the points season's last step. */
  fixtures?: number;
}

export interface SeasonJourneyStep {
  key: "setup" | "teams" | "registration" | "auction" | "fixtures" | "settlement";
  label: string;
  state: JourneyState;
  hint: string;
}

const AUCTION_OVER = new Set(["completed", "reconciled"]);
const AUCTION_LIVE = new Set(["live", "paused"]);
const BOOKS_DONE = new Set(["settled", "closed"]);

/**
 * `withTeams: false` folds the teams rung into "Set up" — the four-stage row
 * /home draws (set up · registration · auction night · settlement).
 */
export function seasonJourney(
  raw: SeasonJourneyInput,
  options: { withTeams: boolean },
): SeasonJourneyStep[] {
  // A voided case never happened (the /home rail's rule).
  const input: SeasonJourneyInput =
    raw.settlement === "voided" ? { ...raw, settlement: null } : raw;
  const pastSetup = input.status === "registration_open" || input.status === "registration_closed";
  const auctionOver = input.auctionStatus !== null && AUCTION_OVER.has(input.auctionStatus);
  const settlementDone = input.settlement !== null && BOOKS_DONE.has(input.settlement);
  // A later fact proves an earlier one: a season with a settlement case ran its
  // auction and closed registration, whatever its status column was left saying.
  const auctionDone = auctionOver || settlementDone || input.settlement !== null;
  const registrationDone = input.status === "registration_closed" || auctionDone;
  const teamsDone = input.teams > 0 || auctionDone;
  const setupDone = pastSetup || auctionDone;

  const facts: { key: SeasonJourneyStep["key"]; label: string; done: boolean }[] = [
    {
      key: "setup",
      label: options.withTeams ? "Setup" : "Set up",
      done: options.withTeams ? setupDone : setupDone && teamsDone,
    },
    ...(options.withTeams ? [{ key: "teams" as const, label: "Teams", done: teamsDone }] : []),
    { key: "registration", label: "Registration", done: registrationDone },
    {
      key: "auction",
      label: options.withTeams ? "Auction" : "Auction night",
      done: auctionDone,
    },
    input.auctionUnit === "points"
      ? { key: "fixtures" as const, label: "Fixtures", done: (input.fixtures ?? 0) > 0 }
      : { key: "settlement" as const, label: "Settlement", done: settlementDone },
  ];
  const current = facts.findIndex((fact) => !fact.done);
  return facts.map((fact, index) => {
    const state: JourneyState = fact.done ? "done" : index === current ? "current" : "upcoming";
    return { key: fact.key, label: fact.label, state, hint: hintFor(fact.key, state, input) };
  });
}

function hintFor(
  key: SeasonJourneyStep["key"],
  state: JourneyState,
  input: SeasonJourneyInput,
): string {
  switch (key) {
    case "setup":
      return state === "done" ? "Completed" : state === "current" ? "In progress" : "Pending";
    case "teams":
      return state === "done"
        ? `${String(input.teams)} team${input.teams === 1 ? "" : "s"}`
        : state === "current"
          ? "Add the teams"
          : "Pending";
    case "registration":
      if (state === "done") return "Closed";
      if (input.status === "registration_open") {
        return `Open · ${input.registrations.toLocaleString("en-IN")} registered`;
      }
      return state === "current" ? "Not open yet" : "Pending";
    case "auction":
      if (state === "done") return "Completed";
      if (input.auctionStatus !== null && AUCTION_LIVE.has(input.auctionStatus)) return "Live";
      if (input.auctionStatus === "scheduled") return "Scheduled";
      return state === "current" ? "Ready to set up" : "Pending";
    case "fixtures": {
      const count = input.fixtures ?? 0;
      return count > 0 ? `${String(count)} match${count === 1 ? "" : "es"}` : "Not scheduled";
    }
    case "settlement":
      if (state === "done") return "Settled";
      return input.settlement !== null ? "Collecting" : "Pending";
  }
}
