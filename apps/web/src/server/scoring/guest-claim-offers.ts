import {
  auditLog,
  competitions,
  newId,
  organizations,
  people,
  registrations,
  teams,
  type Db,
} from "@desiauction/db";
import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { attachPhoneToClubOnly } from "../competition/club-only-phone";
import { reminderId } from "./reminder-link";
import { reminderBoundaries, type ReminderBoundaries } from "./reminder-boundaries";

/**
 * GUEST OFFERS (F09). A scorer who types a number an account already holds
 * does not move the guest registration: `claimScoringGuest` records an offer
 * and the holder is told. Here the holder sees what is offered and answers.
 *
 * The offer is found through the person-scope notice row (`player.claim_offered`
 * or, with the inbox muted, `player.claim_offer_dispatched`), which names the
 * club; everything about the registration is then read inside that club.
 */
const NOTICE_ACTIONS = ["player.claim_offered", "player.claim_offer_dispatched"];

export interface GuestClaimOffer {
  /** The person-scope notice row; the handle the page posts back. */
  noticeId: string;
  playedAs: string;
  teamName: string | null;
  seasonName: string;
  clubName: string;
}

type NoticeAddress = { orgId: string; registrationId: string; offerId: string };

async function noticesOf(
  personId: string,
  boundaries: ReminderBoundaries,
  noticeId?: string,
): Promise<(NoticeAddress & { noticeId: string })[]> {
  const rows = await boundaries.asPerson(personId, (db) =>
    db
      .select({ id: auditLog.id, meta: auditLog.meta })
      .from(auditLog)
      .where(
        and(
          eq(auditLog.scopeType, "person"),
          eq(auditLog.scopeId, personId),
          eq(auditLog.actor, personId),
          inArray(auditLog.action, NOTICE_ACTIONS),
          ...(noticeId === undefined ? [] : [eq(auditLog.id, noticeId)]),
        ),
      )
      .orderBy(auditLog.at),
  );
  return rows.flatMap((row) => {
    const meta = row.meta as Record<string, unknown> | null;
    const orgId = reminderId(meta?.orgId);
    const registrationId = reminderId(meta?.registrationId);
    const offerId = reminderId(meta?.offerId);
    return orgId && registrationId && offerId
      ? [{ noticeId: row.id, orgId, registrationId, offerId }]
      : [];
  });
}

/** The offer, still unanswered, still to this person, for a guest still unclaimed. */
async function openOffer(db: Db, personId: string, address: NoticeAddress, lock = false) {
  // audit_log is append-only, so the registration is the row answers queue on.
  if (lock)
    await db
      .select({ id: registrations.id })
      .from(registrations)
      .where(
        and(eq(registrations.id, address.registrationId), eq(registrations.orgId, address.orgId)),
      )
      .for("update");
  const [offer] = await db
    .select({ meta: auditLog.meta })
    .from(auditLog)
    .where(
      and(
        eq(auditLog.id, address.offerId),
        eq(auditLog.scopeType, "org"),
        eq(auditLog.scopeId, address.orgId),
        eq(auditLog.subject, address.registrationId),
        eq(auditLog.action, "registration.guest_claim_offered"),
        sql`${auditLog.meta}->>'personId' = ${personId}`,
        sql`not exists (select 1 from audit_log answer where answer.scope_type = 'org' and answer.scope_id = ${address.orgId} and answer.subject = ${address.offerId} and answer.action in ('registration.guest_claim_offer_accepted', 'registration.guest_claim_offer_declined'))`,
      ),
    );
  if (!offer) return null;
  const [guest] = await db
    .select({
      playedAs: sql<string>`coalesce(${registrations.enteredName}, ${people.name})`,
      competitionId: registrations.competitionId,
      teamName: teams.name,
      seasonName: competitions.name,
      clubName: organizations.name,
    })
    .from(registrations)
    .innerJoin(people, eq(people.id, registrations.personId))
    .innerJoin(competitions, eq(competitions.id, registrations.competitionId))
    .innerJoin(organizations, eq(organizations.id, registrations.orgId))
    .leftJoin(teams, eq(teams.id, registrations.teamId))
    .where(
      and(
        eq(registrations.id, address.registrationId),
        eq(registrations.orgId, address.orgId),
        isNotNull(people.clubOrgId),
      ),
    );
  const meta = offer.meta as { fixtureId?: unknown } | null;
  return guest ? { ...guest, fixtureId: reminderId(meta?.fixtureId) } : null;
}

export async function openGuestClaimOffers(
  personId: string,
  boundaries: ReminderBoundaries = reminderBoundaries,
): Promise<GuestClaimOffer[]> {
  const seen = new Set<string>();
  const offers: GuestClaimOffer[] = [];
  for (const notice of await noticesOf(personId, boundaries)) {
    if (seen.has(notice.offerId)) continue;
    seen.add(notice.offerId);
    const open = await boundaries.inOrg(personId, notice.orgId, (db) =>
      openOffer(db, personId, notice),
    );
    if (open)
      offers.push({
        noticeId: notice.noticeId,
        playedAs: open.playedAs,
        teamName: open.teamName,
        seasonName: open.seasonName,
        clubName: open.clubName,
      });
  }
  return offers;
}

export type GuestClaimAnswer =
  | { ok: true; accepted: boolean }
  | { ok: false; reason: "gone" | "no_phone" | "already_in_season" };

/**
 * Accepting moves the guest registration onto this account through the same
 * attach every other path uses; declining only records the answer. Either way
 * the offer is closed.
 */
export async function answerGuestClaimOffer(
  personId: string,
  rawNoticeId: unknown,
  accept: boolean,
  boundaries: ReminderBoundaries = reminderBoundaries,
): Promise<GuestClaimAnswer> {
  const noticeId = reminderId(rawNoticeId);
  if (!noticeId) return { ok: false, reason: "gone" };
  const [notice] = await noticesOf(personId, boundaries, noticeId);
  if (!notice) return { ok: false, reason: "gone" };
  return boundaries.inOrg(personId, notice.orgId, async (db): Promise<GuestClaimAnswer> => {
    const open = await openOffer(db, personId, notice, true);
    if (!open) return { ok: false, reason: "gone" };
    const answer = (action: string) =>
      db.insert(auditLog).values({
        id: newId(),
        actor: personId,
        action,
        scopeType: "org",
        scopeId: notice.orgId,
        subject: notice.offerId,
        meta: { registrationId: notice.registrationId, personId },
      });
    if (!accept) {
      await answer("registration.guest_claim_offer_declined");
      return { ok: true, accepted: false };
    }
    const [me] = await db
      .select({ phone: people.phone })
      .from(people)
      .where(eq(people.id, personId));
    if (!me?.phone) return { ok: false, reason: "no_phone" };
    const attached = await attachPhoneToClubOnly(db, {
      orgId: notice.orgId,
      competitionId: open.competitionId,
      registrationId: notice.registrationId,
      actorId: personId,
      phone: me.phone,
      source: "scorer_guest_claim",
    });
    if (!attached.ok)
      return {
        ok: false,
        reason: attached.reason === "already_in_season" ? attached.reason : "gone",
      };
    await answer("registration.guest_claim_offer_accepted");
    // The claim is theirs by their own hand; the "your stats are ready" notice
    // for a claim would only repeat what they just did, so it is marked sent.
    const claimed = newId();
    await db.insert(auditLog).values([
      {
        id: claimed,
        actor: personId,
        action: "registration.guest_claimed",
        scopeType: "org",
        scopeId: notice.orgId,
        subject: notice.registrationId,
        meta: {
          personId,
          registrationId: notice.registrationId,
          ...(open.fixtureId ? { fixtureId: open.fixtureId } : {}),
          competitionId: open.competitionId,
          offerId: notice.offerId,
        },
      },
      {
        id: newId(),
        actor: personId,
        action: "registration.guest_claim_notice_dispatched",
        scopeType: "org",
        scopeId: notice.orgId,
        subject: claimed,
        meta: { registrationId: notice.registrationId },
      },
    ]);
    return { ok: true, accepted: true };
  });
}
