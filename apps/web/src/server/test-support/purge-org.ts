import {
  auctionEvents,
  auctionOwnerInvites,
  auctionTeamTargetRevisions,
  auctionTeamTargets,
  auctions,
  auditLog,
  bids,
  competitions,
  finopsDispatches,
  finopsDocuments,
  finopsEvents,
  finopsJobs,
  finopsSeries,
  fixtures,
  grants,
  invites,
  journalCheckpoints,
  journalLegs,
  journalPostings,
  lots,
  orgMembers,
  organizations,
  paddleGrants,
  paddles,
  payments,
  registrations,
  settlementCases,
  settlementEvents,
  settlementObligations,
  teams,
  tournaments,
  venues,
  type Db,
} from "@desiauction/db";
import { eq } from "drizzle-orm";

/**
 * DELETE EVERYTHING ONE TEST ORG OWNS, IN AN ORDER A FOREIGN KEY WILL ACCEPT.
 *
 * Nineteen regression teardowns were each hand-written, and every one of them
 * had the same hole: they deleted `organizations`, `paddles` and `registrations`
 * and never touched `competitions`, `auctions`, `lots`, `bids` or `teams`. So
 * every run left the whole auction spine behind, pointing at an organization
 * that no longer existed.
 *
 * That is not tidiness. Audit PA-1 §7 found 220 lots referencing a missing
 * registration and 214 sold lots referencing a missing paddle in the
 * development database; a single afternoon of running these suites recreated
 * 660 of them. Read models render empty rather than erroring, so the next
 * person to see it spends an afternoon debugging the platform for data that was
 * simply broken — and the residue arrives looking exactly like a product bug.
 *
 * ONE HELPER RATHER THAN NINETEEN LISTS, because the lists drifted: each was
 * written against the schema as it stood that week, and a table added later was
 * added to none of them. This is the single place a new tenant table has to be
 * named, and the foreign keys added in PA-1R Phase 3.1 make forgetting it a
 * loud failure at the point of the delete rather than a silent orphan.
 *
 * Order matters and is the whole content of this function: children before
 * parents, deepest first. Everything is keyed on `org_id` except the few rows
 * that reach an org only through their parent, which are named explicitly.
 *
 * TEST SUPPORT ONLY. Nothing in the running product deletes an organization —
 * offboarding anonymizes, because money records survive erasure (invariant 4).
 */
export async function purgeOrg(db: Db, orgId: string): Promise<void> {
  // Money first: the journal and its evidence hang off cases and payments.
  await db.delete(journalLegs).where(eq(journalLegs.orgId, orgId));
  await db.delete(journalPostings).where(eq(journalPostings.orgId, orgId));
  await db.delete(journalCheckpoints).where(eq(journalCheckpoints.orgId, orgId));
  await db.delete(payments).where(eq(payments.orgId, orgId));
  await db.delete(settlementObligations).where(eq(settlementObligations.orgId, orgId));
  await db.delete(settlementEvents).where(eq(settlementEvents.orgId, orgId));
  await db.delete(settlementCases).where(eq(settlementCases.orgId, orgId));

  // Financial operations: documents and dispatches before the series they number.
  await db.delete(finopsDispatches).where(eq(finopsDispatches.orgId, orgId));
  await db.delete(finopsDocuments).where(eq(finopsDocuments.orgId, orgId));
  await db.delete(finopsSeries).where(eq(finopsSeries.orgId, orgId));
  await db.delete(finopsJobs).where(eq(finopsJobs.orgId, orgId));
  await db.delete(finopsEvents).where(eq(finopsEvents.orgId, orgId));

  // The auction spine — the half every hand-written teardown forgot.
  await db.delete(auctionTeamTargetRevisions).where(eq(auctionTeamTargetRevisions.orgId, orgId));
  await db.delete(auctionTeamTargets).where(eq(auctionTeamTargets.orgId, orgId));
  await db.delete(bids).where(eq(bids.orgId, orgId));
  await db.delete(lots).where(eq(lots.orgId, orgId));
  await db.delete(auctionEvents).where(eq(auctionEvents.orgId, orgId));
  await db.delete(paddleGrants).where(eq(paddleGrants.orgId, orgId));
  await db.delete(auctionOwnerInvites).where(eq(auctionOwnerInvites.orgId, orgId));
  await db.delete(paddles).where(eq(paddles.orgId, orgId));
  await db.delete(auctions).where(eq(auctions.orgId, orgId));

  // Competition structure.
  await db.delete(fixtures).where(eq(fixtures.orgId, orgId));
  await db.delete(registrations).where(eq(registrations.orgId, orgId));
  await db.delete(teams).where(eq(teams.orgId, orgId));
  await db.delete(competitions).where(eq(competitions.orgId, orgId));
  await db.delete(venues).where(eq(venues.orgId, orgId));
  await db.delete(tournaments).where(eq(tournaments.orgId, orgId));

  // Identity edges into the org, then the org itself.
  await db.delete(invites).where(eq(invites.orgId, orgId));
  await db.delete(grants).where(eq(grants.scopeId, orgId));
  await db.delete(orgMembers).where(eq(orgMembers.orgId, orgId));
  await db.delete(auditLog).where(eq(auditLog.scopeId, orgId));
  await db.delete(organizations).where(eq(organizations.id, orgId));
}
