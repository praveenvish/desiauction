import {
  auditLog,
  newId,
  people,
  registrations,
  writeSurvivingConstraint,
  type Db,
} from "@desiauction/db";
import { and, eq, isNotNull, sql } from "drizzle-orm";

/**
 * GIVING A CLUB-ONLY PLAYER THEIR REAL NUMBER (0104).
 *
 * A club-only player is a person with no phone and no email, owned by the club
 * that added them. When the club learns the real number, one of two things is
 * true, and the club is never told which:
 *
 *   - NOBODY HOLDS IT. The number goes on the club-only person and the club
 *     marker comes off in the same write (`people_club_only_uncontactable_check`)
 *     — from here they are an ordinary player stub, exactly what adding them by
 *     phone would have made.
 *   - AN ACCOUNT HOLDS IT. The registration moves to that account and keeps the
 *     club's name for it as this season's typed name (0075), so the season looks
 *     the same; the club's photo is already on the entry (media/authz.ts), so it
 *     moves too. The emptied club-only person is removed.
 *
 * Not saying which is the point: "whether a phone already has an account is
 * not the club's to learn" (0075) — the same reason `addPlayerByPhone` never
 * reports it. The one refusal that does depend on the account is the one the
 * club can already see: that player is already registered in this season.
 *
 * The caller has already validated the number (`normalizePhone`) and refused a
 * filler (`looksLikePlaceholderPhone`).
 */
export type AttachPhoneResult =
  /** `personId` is who the registration belongs to now. */
  | { ok: true; personId: string; linked: boolean }
  | { ok: false; reason: "not_club_only" | "already_in_season" };

export async function attachPhoneToClubOnly(
  db: Db,
  input: {
    competitionId: string;
    orgId: string;
    actorId: string;
    registrationId: string;
    /** E.164, validated by the caller. */
    phone: string;
    source: "organizer_manual" | "csv_import";
  },
): Promise<AttachPhoneResult> {
  const [entry] = await db
    .select({
      personId: registrations.personId,
      clubName: people.name,
      enteredName: registrations.enteredName,
    })
    .from(registrations)
    .innerJoin(people, eq(people.id, registrations.personId))
    .where(
      and(
        eq(registrations.id, input.registrationId),
        eq(registrations.competitionId, input.competitionId),
        isNotNull(people.clubOrgId),
      ),
    )
    .limit(1);
  if (entry === undefined) {
    return { ok: false, reason: "not_club_only" };
  }

  const holderOf = async (): Promise<string | undefined> =>
    (
      await db.select({ id: people.id }).from(people).where(eq(people.phone, input.phone)).limit(1)
    )[0]?.id;

  let holder = await holderOf();
  let linked = false;
  if (holder === undefined) {
    // Phone on, marker off, one statement. A sign-in that claimed the number
    // between the lookup and here trips the unique phone; the savepoint keeps
    // the caller's transaction healthy and the account path below takes over.
    const landed = await writeSurvivingConstraint(db, (tx) =>
      tx
        .update(people)
        .set({ phone: input.phone, clubOrgId: null })
        .where(and(eq(people.id, entry.personId), isNotNull(people.clubOrgId))),
    );
    if (!landed) {
      holder = await holderOf();
      if (holder === undefined) {
        return { ok: false, reason: "not_club_only" };
      }
    }
  }

  let personId = entry.personId;
  if (holder !== undefined) {
    const [already] = await db
      .select({ id: registrations.id })
      .from(registrations)
      .where(
        and(
          eq(registrations.competitionId, input.competitionId),
          eq(registrations.personId, holder),
        ),
      )
      .limit(1);
    if (already !== undefined) {
      return { ok: false, reason: "already_in_season" };
    }
    const target = holder;
    const moved = await writeSurvivingConstraint(db, (tx) =>
      tx
        .update(registrations)
        .set({
          personId: target,
          // The season keeps showing the name the club gave this player.
          enteredName: sql`coalesce(${registrations.enteredName}, ${entry.clubName})`,
        })
        .where(eq(registrations.id, input.registrationId)),
    );
    if (!moved) {
      return { ok: false, reason: "already_in_season" };
    }
    // Nothing points at the emptied club-only person any more; if something
    // unexpected still does, the row stays rather than failing the attach.
    await writeSurvivingConstraint(db, (tx) =>
      tx.delete(people).where(and(eq(people.id, entry.personId), isNotNull(people.clubOrgId))),
    );
    personId = target;
    linked = true;
  }

  await db.insert(auditLog).values({
    id: newId(),
    actor: input.actorId,
    action: "registration.phone_added",
    scopeType: "org",
    scopeId: input.orgId,
    subject: input.registrationId,
    // Who the number led to stays in the audit row, never in the club's view.
    meta: { source: input.source, linked: linked ? "true" : "false" },
  });
  return { ok: true, personId, linked };
}
