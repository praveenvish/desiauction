import {
  evaluatePlan,
  paise,
  type AuctionSnapshot,
  type PlanCurrentLot,
  type PlanLot,
  type PlanState,
} from "@desiauction/core";

import type { ResolvedLot } from "../../../../server/auction/live-summary";
import type { LivePlan, LivePlanLot } from "../../../../server/auction/owner-plan";

/**
 * THE PLAN, FOLDED AGAINST THE FRAME (WR-1, M4).
 *
 * The server hands the room its plan once, beside the snapshot. From then on
 * every frame the socket delivers is folded here, on the client, with the same
 * pure function the plan page uses — so "your max vs. the next bid" is answered
 * from the SAME version the raise button is drawn from, never from an older
 * server read that could lag the ladder by a rung.
 *
 * Precedence for a lot's status, most live first: the lot on the block (the
 * snapshot's `currentLot`), the resolved history (sold / unsold / withdrawn,
 * carried by the feed so late joiners have it), the snapshot's queue, and only
 * then the status the server saw when the page rendered.
 */

export function liveLots(
  server: readonly LivePlanLot[],
  snapshot: AuctionSnapshot | null,
  resolved: readonly ResolvedLot[],
): PlanLot[] {
  const current = snapshot?.currentLot ?? null;
  const resolvedByLot = new Map(resolved.map((row) => [row.lotId, row]));
  const queued = new Map((snapshot?.queue ?? []).map((entry) => [entry.lotId, entry.status]));
  return server.map((lot) => {
    if (current !== null && current.lotId === lot.lotId) {
      return {
        lotId: lot.lotId,
        registrationId: lot.registrationId,
        status: current.status,
        basePrice: paise(lot.basePrice),
        soldToTeamId: null,
        soldPrice: null,
      };
    }
    const done = resolvedByLot.get(lot.lotId);
    if (done !== undefined) {
      const sold = done.status === "sold";
      return {
        lotId: lot.lotId,
        registrationId: lot.registrationId,
        status: done.status,
        basePrice: paise(lot.basePrice),
        soldToTeamId: sold ? done.teamId : null,
        soldPrice: sold && done.soldPrice !== null ? paise(done.soldPrice) : null,
      };
    }
    return {
      lotId: lot.lotId,
      registrationId: lot.registrationId,
      status: queued.get(lot.lotId) ?? lot.status,
      basePrice: paise(lot.basePrice),
      soldToTeamId: lot.soldToTeamId,
      soldPrice: lot.soldPrice === null ? null : paise(lot.soldPrice),
    };
  });
}

/**
 * The lot on the block as the plan needs it. "Leading is mine" is decided by
 * TEAM, the way the engine decides it (`decideBid` check 3): a holder with two
 * paddles for one franchise cannot outbid himself.
 */
export function liveCurrentLot(
  snapshot: AuctionSnapshot | null,
  myTeamId: string,
): PlanCurrentLot | null {
  const lot = snapshot?.currentLot ?? null;
  if (snapshot === null || lot === null) {
    return null;
  }
  const leader = lot.currentBid;
  const leadingIsMine =
    leader !== null &&
    snapshot.paddles.some(
      (paddle) => paddle.paddleNumber === leader.paddleNumber && paddle.teamId === myTeamId,
    );
  return {
    lotId: lot.lotId,
    nextMinimumBid: paise(lot.nextMinimumBid),
    leadingAmount: leader === null ? null : paise(leader.amount),
    leadingIsMine,
  };
}

/**
 * Null when this team has nothing planned: the room then renders exactly as it
 * did before the plan existed. The purse is the snapshot's own figure for the
 * viewer's team (never sealed for their own paddle); before the first frame it
 * is derived from the lots the team has already won, the same arithmetic the
 * plan page uses.
 */
export function evaluateLivePlan(
  plan: LivePlan,
  teamId: string,
  snapshot: AuctionSnapshot | null,
  resolved: readonly ResolvedLot[],
  squadSize: number,
): PlanState | null {
  const targets = plan.targetsByTeam[teamId];
  if (targets === undefined || targets.length === 0) {
    return null;
  }
  const lots = liveLots(plan.lots, snapshot, resolved);
  const fromSnapshot =
    snapshot?.paddles.find((paddle) => paddle.teamId === teamId && paddle.purseRemaining !== null)
      ?.purseRemaining ?? null;
  const committed = lots.reduce(
    (sum, lot) =>
      lot.status === "sold" && lot.soldToTeamId === teamId && lot.soldPrice !== null
        ? sum + lot.soldPrice
        : sum,
    0,
  );
  const purseRemaining = paise(
    fromSnapshot ?? Math.max(0, plan.planRules.pursePerTeam - committed),
  );
  return evaluatePlan({
    targets,
    lots,
    myTeamId: teamId,
    purseRemaining,
    squadSize,
    rules: plan.planRules,
    currentLot: liveCurrentLot(snapshot, teamId),
  });
}

/** The player behind a registration, for the line's copy. */
export function planNameOf(plan: LivePlan, registrationId: string): string {
  return plan.lots.find((lot) => lot.registrationId === registrationId)?.playerName ?? "a player";
}

/** If the lot on the block is the next planned alternative for a lost target, that target. */
export function backupFor(state: PlanState): string | null {
  const current = state.currentLot?.registrationId ?? null;
  if (current === null) {
    return null;
  }
  for (const suggestion of state.suggestions) {
    if (suggestion.kind === "backup" && suggestion.nextRegistrationId === current) {
      return suggestion.lostRegistrationId;
    }
  }
  return null;
}
