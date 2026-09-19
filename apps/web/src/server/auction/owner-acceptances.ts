import { auctionOwnerInvites, orgMembers, people, type Db } from "@desiauction/db";
import { and, eq, isNotNull, isNull } from "drizzle-orm";

// Lifted out of `conduct-actions.ts` (a "use server" module, where every export
// is a callable endpoint) so the auction setup page can read the same
// acceptances the cockpit does without exposing this read as an action.

export interface OwnerAcceptance {
  /** `auction_owner_invites.id` — the key back onto `owners.invites`. */
  inviteId: string;
  personId: string;
  name: string | null;
  /**
   * E.164 as stored; the panel formats it. NULL since 0062 for a team owner who
   * signs in by email — a team owner works the auction through this website, so
   * unlike a player they need no number.
   */
  phone: string | null;
  email: string | null;
  /** ISO. */
  acceptedAt: string | null;
  /**
   * Still a member of this organization?
   *
   * `removeMember` revokes grants and deletes the membership row, and leaves
   * `auction_owner_invites.accepted_by` and `paddle_grants` exactly where they
   * were — both are auction-aggregate state that only the engine may write, and
   * there is no command to withdraw either. So the cockpit went on listing an
   * offboarded person as an owner ready to be handed a paddle. It cannot be
   * unwound here; it CAN be told the truth about, and the grant refused.
   */
  stillMember: boolean;
}

/** Identity for every accepted owner invitation on this auction. */
/**
 * Runs on the TENANT handle now, not the bypass pool (audit PA-1 §10 P1-4).
 *
 * This read ships owner names and PHONE NUMBERS to the conduct screen, and it
 * was the one part of `cockpitView` outside the boundary the rest of that view
 * already used — `inGateOrg` is `withTenantDb`, so everything around it was
 * scoped and this was not. Its correctness rested entirely on the `orgId`
 * argument being right, with RLS unable to catch it if it ever wasn't.
 *
 * `people` carries no org and no RLS, so the join still resolves inside the
 * boundary; what changes is that `auction_owner_invites` and `org_members` are
 * now filtered by the policy as well as by the predicate.
 */
export async function ownerAcceptancesOf(
  db: Db,
  auctionId: string,
  orgId: string,
): Promise<OwnerAcceptance[]> {
  const rows = await db
    .select({
      inviteId: auctionOwnerInvites.id,
      personId: auctionOwnerInvites.acceptedBy,
      acceptedAt: auctionOwnerInvites.acceptedAt,
      name: people.name,
      phone: people.phone,
      email: people.email,
      memberOrgId: orgMembers.orgId,
    })
    .from(auctionOwnerInvites)
    .innerJoin(people, eq(people.id, auctionOwnerInvites.acceptedBy))
    .leftJoin(
      orgMembers,
      and(eq(orgMembers.personId, auctionOwnerInvites.acceptedBy), eq(orgMembers.orgId, orgId)),
    )
    .where(
      and(
        eq(auctionOwnerInvites.auctionId, auctionId),
        isNull(auctionOwnerInvites.revokedAt),
        isNotNull(auctionOwnerInvites.acceptedBy),
      ),
    );
  return rows.map((row) => ({
    inviteId: row.inviteId,
    personId: row.personId ?? "",
    name: row.name,
    phone: row.phone,
    email: row.email,
    acceptedAt: row.acceptedAt === null ? null : row.acceptedAt.toISOString(),
    stillMember: row.memberOrgId !== null,
  }));
}
