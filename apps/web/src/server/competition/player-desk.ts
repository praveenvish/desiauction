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
  const [canManageTeams, auction] = await Promise.all([
    canCompetition(
      db,
      personId,
      { orgId: competition.orgId, competitionId: competition.id },
      "team.manage",
    ),
    auctionOf(db, competition.id),
  ]);
  const pack = sportPackFor(competition.sport);
  return {
    canManageTeams,
    auctionExists: auction !== null && auction.status !== "abandoned",
    rosterLocked: auction !== null && auction.status !== "scheduled",
    bands: Object.keys(auction?.config.basePriceBands ?? DEFAULT_AUCTION_CONFIG.basePriceBands),
    roles: pack.roles.values.map((value) => ({ key: value.key, label: value.label })),
    rolesRequired: pack.roles.required,
    attributes: attributeOptions(competition.sport),
  };
}
