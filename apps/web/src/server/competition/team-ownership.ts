import { isRealAuction } from "@desiauction/auction";
import { auctionOwnerInvites, auctions, paddles, withTenantDb, type Db } from "@desiauction/db";
import { and, eq, isNull, ne } from "drizzle-orm";

import { dbHandle } from "../db";

/**
 * THE TEAMS THIS PERSON OWNS.
 *
 * The same rule the Teams workspace prints under `ownerName` (DA-32): the owner
 * of a team is whoever HOLDS ITS PADDLE, else whoever accepted its owner invite.
 * One rule, read in two places — a product that answered "who owns this team"
 * differently for a label and for an access decision would be answering it
 * wrongly in one of them.
 *
 * It differs from the label in one respect, deliberately: a REVOKED invitation
 * grants nothing. The card can afford to keep printing a name that was once
 * real; an authorization cannot.
 *
 * Requires org context, because `paddles` and `auctions` are org-scoped with no
 * person disjunct. That is not a limitation in practice — `acceptOwnerJoin`
 * makes every accepted owner a viewer-level member of the org — and it buys the
 * invariant that org context is never established for a non-member.
 */
export async function ownTeamsIn(
  personId: string,
  competition: { id: string; orgId: string },
): Promise<string[]> {
  return withTenantDb(dbHandle, { personId, orgId: competition.orgId }, (db) =>
    ownedTeamIdsOn(db, personId, competition.id),
  );
}

/**
 * The query, on a connection the caller already holds.
 *
 * Separated because `withTenantDb` opens a TRANSACTION: a caller already inside
 * one — the auction dashboard, deciding whether to offer the poster button —
 * would otherwise hold a second pooled connection nested inside its first for
 * the length of the outer read. The org context such a caller carries is the
 * same one this would have set.
 */
export async function ownedTeamIdsOn(
  db: Db,
  personId: string,
  competitionId: string,
): Promise<string[]> {
  const [held, accepted] = await Promise.all([
    db
      .select({ teamId: paddles.teamId })
      .from(paddles)
      .innerJoin(auctions, eq(auctions.id, paddles.auctionId))
      .where(
        and(
          eq(paddles.personId, personId),
          isNull(paddles.releasedAt),
          eq(auctions.competitionId, competitionId),
          ne(auctions.status, "abandoned"),
          isRealAuction(),
        ),
      ),
    db
      .select({ teamId: auctionOwnerInvites.teamId })
      .from(auctionOwnerInvites)
      .innerJoin(auctions, eq(auctions.id, auctionOwnerInvites.auctionId))
      .where(
        and(
          eq(auctionOwnerInvites.acceptedBy, personId),
          isNull(auctionOwnerInvites.revokedAt),
          eq(auctions.competitionId, competitionId),
          ne(auctions.status, "abandoned"),
          isRealAuction(),
        ),
      ),
  ]);
  return [...new Set([...held, ...accepted].map((row) => row.teamId))];
}
