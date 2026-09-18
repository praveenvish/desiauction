import {
  competitions,
  auctions,
  auditLog,
  consentRecords,
  emailVerifications,
  erasureRequests,
  grants,
  newId,
  newsletterSubscribers,
  notificationPreferences,
  orgMembers,
  otpCodes,
  otpInbox,
  paddles,
  passkeyCredentials,
  people,
  playerProfiles,
  playerSportProfiles,
  problemReports,
  registrations,
  reviewRequests,
  sessions,
  withTenantDb,
  type Db,
} from "@desiauction/db";
import { and, eq, inArray, isNull, ne, or, sql } from "drizzle-orm";

import { dbHandle } from "../db";
import { logger } from "../logger";
import { storage } from "../media";

/**
 * ACCOUNT ERASURE — the policy on /account, executed.
 *
 * The promise, verbatim from the account page and the Data Retention policy:
 * "Where your data appears only in your own profile, we delete it. Where it
 * appears in a shared, permanent record — an auction you bid in, a receipt
 * issued to you — we anonymize your name and number instead of destroying the
 * record." Migration 0040 turned that sentence into ON DELETE rules and made the
 * destructive version impossible; this module is the constructive one.
 *
 * WHAT IS DELETED (the person's own profile):
 *   sessions, passkeys, notification preferences, the person-level and
 *   per-sport player profiles, email-verification and OTP codes for their
 *   addresses, their newsletter subscription, their photo in storage, and every
 *   review we asked them for (the request row; its review goes with it by
 *   CASCADE, 0065) — what they wrote was theirs, and it signs with their role.
 *
 * WHAT IS ANONYMIZED (shared records keep their shape, lose the person):
 *   `people` — name, phone, email and photo emptied, `erased_at` stamped;
 *   `registrations` — the self-declared profile on each entry (date of birth,
 *   father's name, kit sizes, jersey, playing styles, sport attributes) and the
 *   organizer's free-text note about them. Role, status, team and fee amounts
 *   stay: they are the club's record of a season, not facts about a person.
 *   `problem_reports` — the report is about the platform and stays; its reply
 *   address, the one way it could still reach them, is emptied.
 *
 * WHAT IS KEPT, AND WHY:
 *   memberships and grants end (removed / revoked), but the auction ledger,
 *   paddles, bids, settlement and finance documents are append-only evidence
 *   and are untouched; they now point at an anonymous id. The person's own
 *   audit rows are append-only for every runtime role and remain, keyed to that
 *   id. Consent records are the evidence of what was agreed and are kept, with a
 *   withdrawal appended for every purpose ever granted.
 *
 * ONE TRANSACTION ACROSS EVERY CLUB. The person may be in several clubs, and
 * RLS admits each club's rows only while `app.org_id` names it. Rather than one
 * boundary per club — which would let a failure in club three leave clubs one
 * and two erased and the person not — the transaction switches `app.org_id` from
 * club to club. It is all or nothing: a person is erased everywhere, or nowhere.
 */

export type ErasureRefusal =
  "not_found" | "already_erased" | "platform_grant" | "sole_owner" | "live_auction";

export const REFUSAL_TEXT: Record<ErasureRefusal, string> = {
  not_found: "That account no longer exists.",
  already_erased: "That account has already been erased.",
  platform_grant:
    "This person holds a platform grant. Revoke it out-of-band first — an operator's access is never ended as a side effect.",
  sole_owner:
    "This person is the only owner of a club. Another owner must be appointed first, or the club is left with nobody who can run it.",
  live_auction:
    "This person is in an auction that is live or paused right now. Erase them once it has finished.",
};

/** The same statuses the deploy freeze treats as live (scripts/check-live-window.mjs). */
const LIVE_AUCTION = ["live", "paused"] as const;

async function setOrg(tx: Db, orgId: string): Promise<void> {
  await tx.execute(sql`select set_config('app.org_id', ${orgId}, true)`);
}

async function setPerson(tx: Db, personId: string): Promise<void> {
  await tx.execute(sql`select set_config('app.person_id', ${personId}, true)`);
}

/**
 * Every club the person has a footprint in, read through the person arms of
 * `registrations` and `org_members` — so it runs with `app.person_id` naming the
 * person being erased, and nothing else in this module does.
 */
async function footprintOrgs(tx: Db, personId: string): Promise<string[]> {
  await setPerson(tx, personId);
  const [registered, member] = await Promise.all([
    tx
      .selectDistinct({ orgId: registrations.orgId })
      .from(registrations)
      .where(eq(registrations.personId, personId)),
    tx
      .selectDistinct({ orgId: orgMembers.orgId })
      .from(orgMembers)
      .where(eq(orgMembers.personId, personId)),
  ]);
  return [...new Set([...registered, ...member].map((row) => row.orgId))];
}

/** Why this person cannot be erased right now, or null if they can. */
async function refusalIn(tx: Db, personId: string, orgIds: readonly string[]) {
  const [person] = await tx
    .select({ erasedAt: people.erasedAt })
    .from(people)
    .where(eq(people.id, personId))
    .limit(1);
  if (person === undefined) {
    return "not_found" as const;
  }
  if (person.erasedAt !== null) {
    return "already_erased" as const;
  }
  // The person's own grants are visible through the grants policy's person arm.
  await setPerson(tx, personId);
  const held = await tx
    .select({ scopeType: grants.scopeType, scopeId: grants.scopeId, set: grants.capabilitySet })
    .from(grants)
    .where(and(eq(grants.personId, personId), isNull(grants.revokedAt)));
  if (held.some((grant) => grant.scopeType !== "org")) {
    return "platform_grant" as const;
  }
  for (const orgId of orgIds) {
    await setOrg(tx, orgId);
    if (held.some((grant) => grant.scopeId === orgId && grant.set === "org:owner")) {
      const [others] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(grants)
        .where(
          and(
            eq(grants.scopeType, "org"),
            eq(grants.scopeId, orgId),
            eq(grants.capabilitySet, "org:owner"),
            isNull(grants.revokedAt),
            ne(grants.personId, personId),
          ),
        );
      if ((others?.n ?? 0) === 0) {
        return "sole_owner" as const;
      }
    }
    // In a live or paused auction as a player on its pool, or holding a paddle.
    const [inLive] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(auctions)
      .where(
        and(
          inArray(auctions.status, [...LIVE_AUCTION]),
          sql`(
            exists (select 1 from ${registrations} r
                     where r.competition_id = ${auctions.competitionId}
                       and r.person_id = ${personId})
            or exists (select 1 from ${paddles} p
                        where p.auction_id = ${auctions.id}
                          and p.person_id = ${personId}
                          and p.released_at is null)
          )`,
        ),
      );
    if ((inLive?.n ?? 0) > 0) {
      return "live_auction" as const;
    }
  }
  return null;
}

/** What the desk shows before anybody presses the button. */
export async function erasurePreflight(
  operatorId: string,
  personId: string,
): Promise<{ ok: true; clubs: number } | { ok: false; reason: ErasureRefusal }> {
  return withTenantDb(dbHandle, { personId: operatorId }, async (tx) => {
    const orgIds = await footprintOrgs(tx, personId);
    const refusal = await refusalIn(tx, personId, orgIds);
    return refusal === null ? { ok: true, clubs: orgIds.length } : { ok: false, reason: refusal };
  });
}

export type ErasureResult = { ok: true; clubs: number } | { ok: false; reason: ErasureRefusal };

/**
 * Erase one person, on behalf of one open request. Refuses rather than
 * half-erasing; the refusal reasons are checked inside the same transaction as
 * the writes, so nothing can change between the check and the act.
 */
export async function executeErasure(input: {
  operatorId: string;
  requestId: string;
  note: string | null;
}): Promise<ErasureResult | { ok: false; reason: "no_open_request" }> {
  const outcome = await withTenantDb(dbHandle, { personId: input.operatorId }, async (tx) => {
    const [request] = await tx
      .select({ personId: erasureRequests.personId })
      .from(erasureRequests)
      .where(and(eq(erasureRequests.id, input.requestId), eq(erasureRequests.status, "requested")))
      .limit(1);
    if (request === undefined) {
      return { ok: false as const, reason: "no_open_request" as const };
    }
    const personId = request.personId;
    const orgIds = await footprintOrgs(tx, personId);
    const refusal = await refusalIn(tx, personId, orgIds);
    if (refusal !== null) {
      return { ok: false as const, reason: refusal };
    }

    const [before] = await tx
      .select({ phone: people.phone, email: people.email, photoUrl: people.photoUrl })
      .from(people)
      .where(eq(people.id, personId))
      .limit(1);

    // --- Each club, inside that club's own policy, as the operator ------------
    await setPerson(tx, input.operatorId);
    for (const orgId of orgIds) {
      await setOrg(tx, orgId);
      await tx
        .update(registrations)
        .set({
          dateOfBirth: null,
          fatherName: null,
          jerseyName: null,
          jerseyNumber: null,
          tshirtSize: null,
          trouserSize: null,
          battingStyle: null,
          bowlingStyle: null,
          attributes: {},
          note: null,
        })
        .where(and(eq(registrations.personId, personId), eq(registrations.orgId, orgId)));
      await tx
        .update(grants)
        .set({ revokedAt: new Date() })
        .where(
          and(
            eq(grants.personId, personId),
            eq(grants.scopeType, "org"),
            eq(grants.scopeId, orgId),
            isNull(grants.revokedAt),
          ),
        );
      // Season-scoped grants in this club (0076 — an appointed auctioneer)
      // end with the membership too; their scope is the season, not the org.
      await tx
        .update(grants)
        .set({ revokedAt: new Date() })
        .where(
          and(
            eq(grants.personId, personId),
            eq(grants.scopeType, "tournament"),
            inArray(
              grants.scopeId,
              tx
                .select({ id: competitions.id })
                .from(competitions)
                .where(eq(competitions.orgId, orgId)),
            ),
            isNull(grants.revokedAt),
          ),
        );
      await tx
        .delete(orgMembers)
        .where(and(eq(orgMembers.personId, personId), eq(orgMembers.orgId, orgId)));
      // On the club's own timeline, so its organizers can see why a member and
      // a player's details disappeared. Names the request, never the person.
      await tx.insert(auditLog).values({
        id: newId(),
        actor: input.operatorId,
        action: "person.erased",
        scopeType: "org",
        scopeId: orgId,
        subject: personId,
        meta: { requestId: input.requestId },
      });
    }
    await setOrg(tx, "");

    // --- The person's own profile: deleted --------------------------------------
    await tx.delete(sessions).where(eq(sessions.personId, personId));
    await tx.delete(passkeyCredentials).where(eq(passkeyCredentials.personId, personId));
    await tx.delete(notificationPreferences).where(eq(notificationPreferences.personId, personId));
    await tx.delete(playerProfiles).where(eq(playerProfiles.personId, personId));
    await tx.delete(playerSportProfiles).where(eq(playerSportProfiles.personId, personId));
    await tx.delete(emailVerifications).where(eq(emailVerifications.personId, personId));
    if (before?.phone !== null && before?.phone !== undefined) {
      await tx.delete(otpCodes).where(eq(otpCodes.phone, before.phone));
      await tx.delete(otpInbox).where(eq(otpInbox.phone, before.phone));
    }
    if (before?.email !== null && before?.email !== undefined) {
      const email = before.email.toLowerCase();
      await tx.delete(emailVerifications).where(eq(emailVerifications.email, email));
      await tx.delete(newsletterSubscribers).where(eq(newsletterSubscribers.email, email));
    }

    // --- What they told us (FR-1) -----------------------------------------------
    // Both tables carry no RLS (0064, 0065), so no club needs naming here. The
    // people row is scrubbed, never deleted, so their ON DELETE rules never fire:
    // this is the constructive version of those rules.
    await tx.delete(reviewRequests).where(eq(reviewRequests.personId, personId));
    // By person AND by address: a report filed as a guest carries no person id,
    // only the address they typed — which is still theirs to have erased.
    await tx
      .update(problemReports)
      .set({ replyEmail: null })
      .where(
        before?.email !== null && before?.email !== undefined
          ? or(
              eq(problemReports.personId, personId),
              eq(problemReports.replyEmail, before.email.toLowerCase()),
            )
          : eq(problemReports.personId, personId),
      );

    // --- Consent: kept as evidence, with a withdrawal for everything granted ----
    const purposes = await tx
      .selectDistinct({ purpose: consentRecords.purpose })
      .from(consentRecords)
      .where(and(eq(consentRecords.personId, personId), eq(consentRecords.granted, true)));
    if (purposes.length > 0) {
      await tx.insert(consentRecords).values(
        purposes.map(({ purpose }) => ({
          id: newId(),
          personId,
          purpose,
          granted: false,
          source: "account" as const,
          evidence: { erasureRequestId: input.requestId },
        })),
      );
    }

    // --- The person row: emptied, marked --------------------------------------
    // Both CHECKs from 0066 hold here: no channel remains, and the marker says why.
    await tx
      .update(people)
      .set({
        name: null,
        phone: null,
        email: null,
        emailVerifiedAt: null,
        photoUrl: null,
        photoUploadedAt: null,
        photoConsentAt: null,
        photoConsentVia: null,
        erasedAt: new Date(),
      })
      .where(eq(people.id, personId));

    await tx
      .update(erasureRequests)
      .set({
        status: "completed",
        decidedBy: input.operatorId,
        decidedAt: new Date(),
        decisionNote: input.note,
      })
      .where(eq(erasureRequests.id, input.requestId));
    return { ok: true as const, clubs: orgIds.length, photoKey: before?.photoUrl ?? null };
  });

  // Storage is not transactional, so the photo goes only once the erasure has
  // committed. A failure here leaves an orphaned object with no reference to it
  // anywhere in the database — logged, so it can be swept, never silent.
  if (!outcome.ok) {
    return outcome;
  }
  if (outcome.photoKey !== null) {
    try {
      await storage.delete(outcome.photoKey);
    } catch (error) {
      logger().error({ err: error, requestId: input.requestId }, "erasure.photo_delete_failed");
    }
  }
  return { ok: true, clubs: outcome.clubs };
}
