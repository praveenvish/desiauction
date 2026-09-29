import type { Db } from "@desiauction/db";

import { canCompetition } from "./authz";
import { ownedTeamIdsOn } from "./team-ownership";

/**
 * WHO MAY PICK A TEAM'S LINEUP (founder, 2026-09-29). The organizer
 * (`fixture.manage`) picks both sides; the owner of a team — by paddle or
 * accepted owner invite, the posters' `ownTeamsIn` rule — picks that team's
 * side and no other. Saving and announcing share this one answer.
 *
 * Needs org context on `db` (paddles and auctions are org-scoped).
 */
export async function mayPickLineup(
  db: Db,
  personId: string,
  competition: { id: string; orgId: string },
  teamId: string,
): Promise<boolean> {
  const scope = { orgId: competition.orgId, competitionId: competition.id };
  if (await canCompetition(db, personId, scope, "fixture.manage")) {
    return true;
  }
  return (await ownedTeamIdsOn(db, personId, competition.id)).includes(teamId);
}

/**
 * The sides of a match a viewer is shown in its panel: both for the
 * organizer, their own for a team's owner — never a rival's squad
 * (canSeeRoster) — and none for anyone else.
 */
export function lineupSidesFor<T extends { teamId: string }>(
  sides: readonly T[],
  viewer: { canManage: boolean; ownedTeams: readonly string[] },
): T[] {
  return viewer.canManage
    ? [...sides]
    : sides.filter((side) => viewer.ownedTeams.includes(side.teamId));
}
