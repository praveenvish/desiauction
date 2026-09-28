import { createHash } from "node:crypto";

import {
  auctionOwnerInvites,
  auctions,
  competitions,
  organizations,
  teams,
  type Db,
} from "@desiauction/db";
import { and, eq, gt, isNull } from "drizzle-orm";

/**
 * THE OWNER INVITATION'S TOKEN — read from its link, and matched to a live
 * invitation. Not in owner-actions.ts: that is a "use server" module, and every
 * export there is callable from a browser.
 */

export function hashInviteToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** ".../owner-join/<token>" → the token; anything else → null. */
export function inviteTokenFrom(joinUrl: string): string | null {
  return /\/owner-join\/([A-Za-z0-9_-]{16,})\/?$/.exec(joinUrl.trim())?.[1] ?? null;
}

export interface LiveInvite {
  readonly id: string;
  readonly teamId: string;
  readonly teamName: string;
  readonly season: string;
  readonly seasonSlug: string;
  readonly sport: string;
  readonly auctionAt: Date | null;
  readonly orgName: string;
}

/**
 * The invitation this token opens, if it may still be sent: on THIS auction,
 * not accepted, not withdrawn, not expired. A link from another club's
 * auction, or one already used, is not an invitation anybody may be emailed.
 */
export async function liveInviteByToken(
  db: Db,
  auctionId: string,
  token: string,
  now: Date = new Date(),
): Promise<LiveInvite | null> {
  const [invite] = await db
    .select({
      id: auctionOwnerInvites.id,
      teamId: auctionOwnerInvites.teamId,
      teamName: teams.name,
      season: competitions.name,
      seasonSlug: competitions.slug,
      sport: competitions.sport,
      auctionAt: competitions.auctionStartsAt,
      orgName: organizations.name,
    })
    .from(auctionOwnerInvites)
    .innerJoin(teams, eq(teams.id, auctionOwnerInvites.teamId))
    .innerJoin(auctions, eq(auctions.id, auctionOwnerInvites.auctionId))
    .innerJoin(competitions, eq(competitions.id, auctions.competitionId))
    .innerJoin(organizations, eq(organizations.id, auctionOwnerInvites.orgId))
    .where(
      and(
        eq(auctionOwnerInvites.tokenHash, hashInviteToken(token)),
        eq(auctionOwnerInvites.auctionId, auctionId),
        isNull(auctionOwnerInvites.acceptedBy),
        isNull(auctionOwnerInvites.revokedAt),
        gt(auctionOwnerInvites.expiresAt, now),
      ),
    )
    .limit(1);
  return invite ?? null;
}
