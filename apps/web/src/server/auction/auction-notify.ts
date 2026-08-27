import { formatPaiseINR, paise } from "@desiauction/core";
import {
  lots,
  paddles,
  people,
  registrations,
  teams,
  withTenantDb,
  type Db,
} from "@desiauction/db";
import { and, eq, inArray } from "drizzle-orm";

import { logSecurityEvent } from "../auth/security-events";
import { dbHandle } from "../db";

/**
 * TELLING THE PLAYER WHAT HAPPENED TO THEM.
 *
 * Nobody was ever told. A night ends, ninety people are sold, and the only
 * parties who learn the outcome are the organizer running the room and whoever
 * happened to be watching the stream — the player themselves found out from a
 * friend, or not at all. This is the same hole DA-19 closed for registration
 * decisions ("48 people were approved and one rejected during certification and
 * not one of them was told"), reopened at the moment the product exists for.
 *
 * It rides the SAME person-scoped ledger `/inbox` already reads. No notification
 * store is invented, no provider is required, and it works today — which is the
 * point, because the SMS and email channels are still founder-provisioned and a
 * player who cannot be told until an account exists somewhere is not told.
 *
 * WRITTEN AT COMPLETION, NOT AT THE HAMMER. An unsold lot is requeued by default
 * (`unsoldPolicy` is requeue x2), so "you went unsold" mid-night is a verdict the
 * auction has not reached. At completion it is final and may be said.
 */

/** What a player is told, and the evidence key behind it. */
export type AuctionOutcomeAction = "auction.sold" | "auction.unsold";

interface Outcome {
  personId: string;
  action: AuctionOutcomeAction;
  meta: Record<string, string>;
}

async function outcomesOf(
  db: Db,
  auctionId: string,
  competition: { id: string; name: string },
): Promise<Outcome[]> {
  const rows = await db
    .select({
      personId: registrations.personId,
      status: lots.status,
      soldPrice: lots.soldPrice,
      teamName: teams.name,
    })
    .from(lots)
    .innerJoin(registrations, eq(registrations.id, lots.registrationId))
    .innerJoin(people, eq(people.id, registrations.personId))
    .leftJoin(paddles, eq(paddles.id, lots.soldToPaddleId))
    .leftJoin(teams, eq(teams.id, paddles.teamId))
    .where(and(eq(lots.auctionId, auctionId), inArray(lots.status, ["sold", "unsold"])));
  return rows.flatMap((row): Outcome[] => {
    // A sold row without a team or a price is a half-written sale. The database
    // forbids it (0030's `lots_sold_state_consistent`), so reaching here means
    // something is wrong — and a message that says "sold to undefined" is worse
    // than no message at all.
    if (row.status === "sold") {
      if (row.teamName === null || row.soldPrice === null) {
        return [];
      }
      return [
        {
          personId: row.personId,
          action: "auction.sold",
          meta: {
            // `competitionId` is the ONLY meta key /inbox reads: it resolves the
            // name and, when the season is public, links the row. Without it the
            // notice renders as a bare "You were sold at auction" pointing
            // nowhere — the exact defect the inbox page's own header describes.
            // The name rides along too, so the ledger row stays readable as
            // evidence even after a rename or a deletion.
            competitionId: competition.id,
            competition: competition.name,
            team: row.teamName,
            price: formatPaiseINR(paise(row.soldPrice)),
          },
        },
      ];
    }
    return [
      {
        personId: row.personId,
        action: "auction.unsold",
        meta: { competitionId: competition.id, competition: competition.name },
      },
    ];
  });
}

/**
 * Announce every outcome, once, best-effort.
 *
 * Best-effort by the same rule the registration notifier states: a player who
 * misses a notification still has the outcome; a completed auction rolled back
 * by a failed notification does not. The auction has already committed by the
 * time this runs.
 */
export async function announceAuctionOutcomes(input: {
  personId: string;
  orgId: string;
  auctionId: string;
  competition: { id: string; name: string };
}): Promise<number> {
  let sent = 0;
  try {
    const outcomes = await withTenantDb(
      dbHandle,
      { personId: input.personId, orgId: input.orgId },
      (db) => outcomesOf(db, input.auctionId, input.competition),
    );
    for (const outcome of outcomes) {
      try {
        await logSecurityEvent(outcome.personId, outcome.action, outcome.meta);
        sent += 1;
      } catch {
        // One unreachable player must not cost the other eighty-nine theirs.
      }
    }
  } catch {
    // Nor may the whole announcement cost the auction its completion.
  }
  return sent;
}
