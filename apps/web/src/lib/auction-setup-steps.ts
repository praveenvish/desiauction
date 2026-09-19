/**
 * AUCTION SETUP, AS FIVE STEPS THAT TICK THEMSELVES OFF.
 *
 * Getting from "players approved" to "room open" used to mean knowing an order
 * nothing wrote down: close registration (on Overview), set the rules and create
 * the auction (here), mint an owner link per team (on Teams, or the cockpit),
 * wait for each owner to accept, grant each a paddle (cockpit), wait for them to
 * claim it on their own device, queue the lots (here), then open — and the
 * refusal for a missed step arrived as a toast after the click, in front of a
 * full hall.
 *
 * This is that order, derived from the facts the page already reads. Nothing
 * here is stored: a step is done because the season says so, which is why the
 * checklist cannot drift from the engine's own guard.
 *
 * Pure and client-safe — the page and its tests call the same function.
 */

export type StepId = "players" | "rules" | "owners" | "lots" | "live";
export type StepState = "done" | "current" | "upcoming";

export interface SetupStep {
  id: StepId;
  title: string;
  state: StepState;
  /** One line: what is true now, in the organizer's words. */
  summary: string;
}

export interface OwnerInviteFact {
  id: string;
  teamId: string;
  acceptedBy: string | null;
  expired: boolean;
}

export interface PaddleGrantFact {
  teamId: string;
  personId: string;
  claimed: boolean;
}

/**
 * Where one team stands on the road to bidding. The engine's go-live guard
 * counts CLAIMED paddles by distinct team; everything before `claimed` is the
 * organizer's or the owner's next move.
 */
export type OwnerStage =
  | { stage: "none" }
  | { stage: "invited"; inviteId: string }
  | { stage: "expired"; inviteId: string }
  | { stage: "accepted"; inviteId: string; personId: string }
  | { stage: "granted"; personId: string }
  | { stage: "claimed"; personId: string };

export function ownerStageOf(
  teamId: string,
  invites: readonly OwnerInviteFact[],
  grants: readonly PaddleGrantFact[],
  claimedTeamIds: ReadonlySet<string>,
): OwnerStage {
  const grant = grants.find((row) => row.teamId === teamId);
  if (grant !== undefined && (grant.claimed || claimedTeamIds.has(teamId))) {
    return { stage: "claimed", personId: grant.personId };
  }
  if (grant !== undefined) {
    return { stage: "granted", personId: grant.personId };
  }
  const forTeam = invites.filter((row) => row.teamId === teamId);
  const accepted = forTeam.find((row) => row.acceptedBy !== null);
  if (accepted !== undefined && accepted.acceptedBy !== null) {
    return { stage: "accepted", inviteId: accepted.id, personId: accepted.acceptedBy };
  }
  // The newest live link wins; an older expired one is history.
  const live = [...forTeam].reverse().find((row) => !row.expired);
  if (live !== undefined) {
    return { stage: "invited", inviteId: live.id };
  }
  const expired = forTeam.at(-1);
  if (expired !== undefined) {
    return { stage: "expired", inviteId: expired.id };
  }
  // A team whose paddle was claimed without the invite path (issued directly
  // to the person clicking) is still able to bid.
  return claimedTeamIds.has(teamId) ? { stage: "claimed", personId: "" } : { stage: "none" };
}

export interface SetupFacts {
  /** `AuctionReadyProjection.checks` — intake closed, pool present, two teams. */
  checks: readonly { id: string; pass: boolean }[];
  poolSize: number;
  teamCount: number;
  /** Null before an auction exists (or after one was abandoned). */
  auctionStatus: string | null;
  /** Distinct teams holding a claimed, unreleased paddle. */
  claimedTeams: number;
  counts: { queued: number; prepared: number } | null;
}

/** The engine's own guard: two teams able to bid and something to bid on. */
export const MIN_CLAIMED_TEAMS = 2;

export function setupSteps(facts: SetupFacts): SetupStep[] {
  const exists = facts.auctionStatus !== null && facts.auctionStatus !== "abandoned";
  const playersDone = facts.checks.length > 0 && facts.checks.every((check) => check.pass);
  const intakeOpen = facts.checks.some((check) => check.id === "intake_closed" && !check.pass);
  const ownersDone = facts.claimedTeams >= MIN_CLAIMED_TEAMS;
  const lotsDone = facts.counts !== null && facts.counts.queued > 0 && facts.counts.prepared === 0;
  const opened = exists && facts.auctionStatus !== "scheduled";

  const raw: { id: StepId; title: string; done: boolean; summary: string }[] = [
    {
      id: "players",
      title: "Players & teams",
      done: playersDone || exists,
      summary: playersDone
        ? `${String(facts.poolSize)} in the auction pool · ${String(facts.teamCount)} teams`
        : intakeOpen
          ? "Close registration to lock the pool."
          : "The pool needs players and at least two teams.",
    },
    {
      id: "rules",
      title: "Rules of the night",
      done: exists,
      summary: exists
        ? "Locked in — purse, squads and timer are set."
        : "Purse, squad size, timer.",
    },
    {
      id: "owners",
      title: "Team owners",
      done: ownersDone,
      summary: `${String(facts.claimedTeams)} of ${String(facts.teamCount)} teams ready to bid`,
    },
    {
      id: "lots",
      title: "Lot order",
      done: lotsDone,
      summary:
        facts.counts === null
          ? "Created with the auction."
          : facts.counts.prepared > 0
            ? `${String(facts.counts.prepared)} players to queue`
            : `${String(facts.counts.queued)} players queued`,
    },
    {
      id: "live",
      title: "Go live",
      done: opened,
      summary: opened ? "The room is open." : "Open the room when everyone is in.",
    },
  ];

  // The first step not done is current — except that owners and lots can be
  // worked in either order once the auction exists, so both stay open to act on.
  const firstOpen = raw.findIndex((step) => !step.done);
  return raw.map((step, index) => ({
    id: step.id,
    title: step.title,
    summary: step.summary,
    state: step.done
      ? "done"
      : index === firstOpen || (exists && (step.id === "owners" || step.id === "lots"))
        ? "current"
        : "upcoming",
  }));
}
