import type { OwnedTeam } from "../../server/roles/roles";
import { OwnerSection } from "./owner-section";

/**
 * THE TEAM OWNER'S HOME — one section per team they own.
 *
 * Its one job (RN-1 §0): spend the purse well. `OwnerSection` already renders
 * a team properly (purse, squad, plan, and the three doors an owner uses); what
 * was missing was the plural. `currentTeam()` reduced `roles.owns` to ONE team,
 * so an owner with teams in two seasons lost one of them with no trace — on the
 * home page as well as in the rail.
 *
 * Ordered by urgency, so the night that is running leads: the same precedence
 * the menu applies (LAW 7), because a person reading both should not have to
 * reconcile two different answers about which team matters right now.
 */
const URGENCY: Record<string, number> = {
  live: 0,
  paused: 0,
  scheduled: 1,
  setup: 2,
  draft: 2,
  completed: 3,
  reconciled: 3,
};

export function OwnerHome({ teams }: { teams: OwnedTeam[] }) {
  const ordered = [...teams].sort(
    (a, b) => (URGENCY[a.auctionStatus] ?? 2) - (URGENCY[b.auctionStatus] ?? 2),
  );
  return (
    <>
      {ordered.map((team) => (
        <OwnerSection key={`${team.auctionId}:${team.teamId}`} team={team} />
      ))}
    </>
  );
}
