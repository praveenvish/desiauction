/**
 * READINESS, IN WORDS — pure, so the answer to "can I start the auction?" and
 * every step under it is a unit test.
 *
 * The page used to put that answer in a corner pill ("1 blocker") while the
 * checklist under it drew two red marks: "the auction exists" was drawn as
 * blocked and never counted. Here the steps ARE the count — one list, and the
 * title, the button and the marks all read from it.
 */

export interface GateCheck {
  readonly id: string;
  readonly label: string;
  readonly pass: boolean;
}

export interface Step {
  readonly key: string;
  readonly label: string;
  readonly detail: string | null;
  readonly href: string;
  /** The primary button, when it is not simply the step's own label. */
  readonly action: { readonly label: string; readonly href: string };
}

function waiting(n: number): string {
  return `${String(n)} registration${n === 1 ? " is" : "s are"} still waiting`;
}

/** What stands between the season and auction night, in the order to do it. */
export function readinessSteps(input: {
  checks: readonly GateCheck[];
  auctionCreated: boolean;
  pending: number;
  base: string;
}): Step[] {
  const { checks, auctionCreated, pending, base } = input;
  const steps: Step[] = [];
  for (const check of checks) {
    if (check.pass) continue;
    switch (check.id) {
      case "intake_closed":
        steps.push({
          key: check.id,
          label: "Close registration",
          detail:
            pending > 0
              ? `${waiting(pending)} — approve or decline ${pending === 1 ? "it" : "them"} first, then close. The pool locks when you do.`
              : "The pool locks when you do.",
          href: base,
          action:
            pending > 0
              ? {
                  label: `Review the ${String(pending)} waiting`,
                  href: `${base}/registrations?status=submitted`,
                }
              : { label: "Close registration", href: base },
        });
        break;
      case "pool_present":
        steps.push({
          key: check.id,
          label: "Approve players into the pool",
          detail: "An auction needs players to sell.",
          href: `${base}/registrations`,
          action: { label: "Review registrations", href: `${base}/registrations` },
        });
        break;
      case "teams_present":
        steps.push({
          key: check.id,
          label: "Add at least two teams",
          detail: "Every team gets an owner and a paddle on the night.",
          href: `${base}/teams`,
          action: { label: "Add teams", href: `${base}/teams` },
        });
        break;
      default:
        steps.push({
          key: check.id,
          label: check.label,
          detail: null,
          href: `${base}/auction`,
          action: { label: "Open auction setup", href: `${base}/auction` },
        });
    }
  }
  if (!auctionCreated) {
    steps.push({
      key: "auction_created",
      label: "Create the auction",
      detail: "Set the purse and squad size, then invite the owners.",
      href: `${base}/auction`,
      action: { label: "Create the auction", href: `${base}/auction` },
    });
  }
  return steps;
}

const COUNT_WORD = ["No", "One", "Two", "Three", "Four", "Five"];

/** "Two steps to auction night" — or ready, once nothing stands in the way. */
export function readinessTitle(steps: number): string {
  if (steps === 0) return "Ready for auction night";
  const word = COUNT_WORD[steps] ?? String(steps);
  return `${word} step${steps === 1 ? "" : "s"} to auction night`;
}

export interface Shortfall {
  readonly ok: boolean;
  readonly poolSize: number;
  readonly teamCount: number;
  readonly squadMin: number;
  readonly needed: number;
  readonly shortfall: number;
}

/**
 * The pool against the squads, as a sentence with the ways out. It was an
 * amber "Short" pill at the end of a row — 22 players short read the same as
 * one.
 */
export function shortfallSentence(
  f: Shortfall,
  pending: number,
): { lead: string; body: string } | null {
  if (f.ok) return null;
  const ways =
    pending > 0
      ? `Approve the ${String(pending)} waiting, lower the squad minimum in auction setup, or run short on purpose`
      : "Lower the squad minimum in auction setup, or run short on purpose";
  return {
    lead: `The pool is ${String(f.shortfall)} player${f.shortfall === 1 ? "" : "s"} short.`,
    body: `${String(f.poolSize)} player${f.poolSize === 1 ? "" : "s"} can't fill ${String(f.teamCount)} squad${f.teamCount === 1 ? "" : "s"} of at least ${String(f.squadMin)} (${String(f.needed)} needed). ${ways} — the night will end with squads unfilled.`,
  };
}
