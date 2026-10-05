import { attributeOptions, DEFAULT_AUCTION_CONFIG, sportPackFor } from "@desiauction/core";
import { auctionOf } from "@desiauction/auction";
import type { Db } from "@desiauction/db";

import { canCompetition } from "./authz";
import type { CompetitionSummary } from "./competitions";

/**
 * EVERYTHING THE PLAYER SHEET NEEDS TO KNOW ABOUT THE SEASON, ONCE.
 *
 * The sheet opens instantly because it asks the server nothing on open: the
 * row it shows is already on the page, and this is the rest — which roles and
 * bands are legal, what the sport asks about, whether the viewer may pre-sign
 * players, and whether the auction has frozen the roster. Plain data only,
 * because it crosses into a client component (a sport pack carries functions).
 */
export interface PlayerDeskContext {
  /** `team.manage` — marks and team moves. Reviewing is the page's own gate. */
  canManageTeams: boolean;
  /** An auction exists and has not been abandoned. */
  auctionExists: boolean;
  /** The auction has left `scheduled`: pool, marks, role and band are frozen. */
  rosterLocked: boolean;
  /** The auction has been run (completed / reconciled): no team now means unsold. */
  auctionDone: boolean;
  /**
   * Results of an auction held outside the app are still being typed in
   * (0105): no auction in the app, and the viewer is an organiser. The sheet
   * then asks what the player went for, beside their team.
   */
  handEntry: boolean;
  bands: readonly string[];
  roles: readonly { key: string; label: string }[];
  rolesRequired: boolean;
  attributes: ReturnType<typeof attributeOptions>;
}

export async function playerDeskContext(
  db: Db,
  personId: string,
  competition: CompetitionSummary,
): Promise<PlayerDeskContext> {
  const scope = { orgId: competition.orgId, competitionId: competition.id };
  const [canManageTeams, canManage, auction] = await Promise.all([
    canCompetition(db, personId, scope, "team.manage"),
    // The hand-entry writers' own gate (`hand-results-actions.ts`).
    canCompetition(db, personId, scope, "competition.manage"),
    auctionOf(db, competition.id),
  ]);
  const pack = sportPackFor(competition.sport);
  return {
    canManageTeams,
    auctionExists: auction !== null && auction.status !== "abandoned",
    rosterLocked: auction !== null && auction.status !== "scheduled",
    auctionDone:
      auction !== null && (auction.status === "completed" || auction.status === "reconciled"),
    handEntry: canManage && (auction === null || auction.status === "abandoned"),
    bands: Object.keys(auction?.config.basePriceBands ?? DEFAULT_AUCTION_CONFIG.basePriceBands),
    roles: pack.roles.values.map((value) => ({ key: value.key, label: value.label })),
    rolesRequired: pack.roles.required,
    attributes: attributeOptions(competition.sport),
  };
}
