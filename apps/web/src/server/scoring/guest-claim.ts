import { looksLikePlaceholderPhone, normalizePhone } from "@desiauction/core";
import { auditLog, fixtures, people, registrations, newId, type Db } from "@desiauction/db";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { attachPhoneToClubOnly } from "../competition/club-only-phone";
import { authorityKind } from "./authority";

const inputSchema = z.object({
  registrationId: z.string().regex(/^[0-9A-HJKMNP-TV-Z]{26}$/),
  phone: z.string().max(40),
});
/** Caller supplies the authenticated actor and owns the tenant transaction. */
export async function claimScoringGuest(db: Db, fixtureId: string, actorId: string, raw: unknown) {
  const input = inputSchema.safeParse(raw);
  if (!input.success)
    return {
      ok: false as const,
      error: "bad_payload",
      message: "Choose a guest and enter their mobile number.",
    };
  const phone = normalizePhone(input.data.phone.trim());
  if (!phone.ok || looksLikePlaceholderPhone(phone.phone))
    return {
      ok: false as const,
      error: "bad_phone",
      message: "Enter the player’s real Indian mobile number.",
    };
  const [fixture] = await db
    .select()
    .from(fixtures)
    .where(eq(fixtures.id, fixtureId))
    .for("update");
  if (!fixture) return { ok: false as const, error: "not_found", message: "Match not found." };
  if (!(await authorityKind(db, actorId, fixture)))
    return {
      ok: false as const,
      error: "forbidden",
      message: "You cannot claim players for this match.",
    };
  const [guest] = await db
    .select({ id: registrations.id, teamId: registrations.teamId })
    .from(registrations)
    .innerJoin(people, eq(people.id, registrations.personId))
    .where(
      and(
        eq(registrations.id, input.data.registrationId),
        eq(registrations.orgId, fixture.orgId),
        eq(registrations.competitionId, fixture.competitionId),
        eq(people.clubOrgId, fixture.orgId),
      ),
    )
    .for("update");
  if (!guest || !guest.teamId || ![fixture.homeTeamId, fixture.awayTeamId].includes(guest.teamId))
    return {
      ok: false as const,
      error: "not_guest",
      message: "Choose a guest playing in this match.",
    };
  const [added] = await db
    .select({ id: auditLog.id })
    .from(auditLog)
    .where(
      and(
        eq(auditLog.scopeType, "org"),
        eq(auditLog.scopeId, fixture.orgId),
        eq(auditLog.subject, guest.id),
        eq(auditLog.action, "registration.added"),
        sql`${auditLog.meta}->>'source' = 'scorer_guest'`,
      ),
    );
  if (!added)
    return {
      ok: false as const,
      error: "not_guest",
      message: "Choose a guest added through scoring.",
    };
  const attached = await attachPhoneToClubOnly(db, {
    orgId: fixture.orgId,
    competitionId: fixture.competitionId,
    registrationId: guest.id,
    actorId,
    phone: phone.phone,
    source: "scorer_guest_claim",
  });
  if (!attached.ok)
    return {
      ok: false as const,
      error: attached.reason,
      message:
        attached.reason === "already_in_season"
          ? "This number is already registered in this season."
          : "This player already has contact details.",
    };
  await db.insert(auditLog).values({
    id: newId(),
    actor: actorId,
    action: "registration.guest_claimed",
    scopeType: "org",
    scopeId: fixture.orgId,
    subject: guest.id,
    meta: {
      personId: attached.personId,
      registrationId: guest.id,
      fixtureId,
      competitionId: fixture.competitionId,
    },
  });
  // The season’s shown name and every registration-keyed fact stay unchanged.
  return { ok: true as const, registrationId: guest.id };
}
