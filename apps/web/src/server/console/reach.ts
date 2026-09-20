import { hasCapability, type Capability, type GrantLike } from "@desiauction/core";
import { hasSettlementCapability } from "@desiauction/settlement";

/**
 * WHAT ONE PERSON MAY SEE OF ONE SEASON — decided once, for the three
 * cross-season indexes (/players, /auctions, /reports).
 *
 * Pure: the grants are read once per request (`grantsOfPerson`) and every
 * season's answer is folded from them here, instead of one capability query
 * per season per question. The rules are the ones the season's own desks
 * already enforce, restated rather than reinvented:
 *
 *   · players/registrations — `registration.review` (the registrations desk);
 *   · the season's money — `competition.manage` OR `settlement.view`
 *     (`seasonOverviewView`'s DA-13 rule);
 *   · the auction's money — `auction.conduct` OR `competition.manage`
 *     (`auctionDashboard`'s DA-30 rule: a rival's purse is the night's secret);
 *   · cockpit / ledger / replay — `auction.conduct` (conduct-actions gates).
 *
 * A capability is asked on the org AND on the season (`canCompetition`'s two
 * scopes) — the appointed auctioneer holds `auction.conduct` on the season only.
 * Settlement capabilities live on the org alone.
 */

export interface SeasonAccess {
  canReview: boolean;
  canManage: boolean;
  canConduct: boolean;
  canSettle: boolean;
  /** Fees, spend, purse — the season's books. */
  seesSeasonMoney: boolean;
  /** Money moved at the auction, per-team spend. */
  seesAuctionMoney: boolean;
}

function can(
  grants: readonly GrantLike[],
  season: { id: string; orgId: string },
  capability: Capability,
): boolean {
  return (
    hasCapability(grants, { scopeType: "org", scopeId: season.orgId }, capability) ||
    hasCapability(grants, { scopeType: "tournament", scopeId: season.id }, capability)
  );
}

export function seasonAccess(
  grants: readonly GrantLike[],
  season: { id: string; orgId: string },
): SeasonAccess {
  const canReview = can(grants, season, "registration.review");
  const canManage = can(grants, season, "competition.manage");
  const canConduct = can(grants, season, "auction.conduct");
  const canSettle = hasSettlementCapability(
    grants,
    { scopeType: "org", scopeId: season.orgId },
    "settlement.view",
  );
  return {
    canReview,
    canManage,
    canConduct,
    canSettle,
    seesSeasonMoney: canManage || canSettle,
    seesAuctionMoney: canConduct || canManage,
  };
}
