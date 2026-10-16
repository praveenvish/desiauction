import { parseBattingStyle } from "@desiauction/core";
import type { EventPayloads } from "@desiauction/core/scoring";
import { auditLog, newId, registrations, type Db } from "@desiauction/db";
import { and, eq, isNull } from "drizzle-orm";

/** Validated newly stored event only; each independent column is write-once here. */
export async function propagateScoringStyle(
  db: Db,
  scope: { orgId: string; competitionId: string; fixtureId: string; actorId: string },
  style: EventPayloads["style_set"],
) {
  const changes: Record<string, string> = {};
  const where = and(
    eq(registrations.id, style.registrationId),
    eq(registrations.orgId, scope.orgId),
    eq(registrations.competitionId, scope.competitionId),
  );
  if (style.battingHand) {
    const value = parseBattingStyle(style.battingHand);
    if (!value) throw new Error("Scoring batting hand is missing from the sport pack");
    const written = await db
      .update(registrations)
      .set({ battingStyle: value })
      .where(and(where, isNull(registrations.battingStyle)))
      .returning({ id: registrations.id });
    if (written.length) changes["battingStyle"] = value;
  }
  if (style.bowlingStyle) {
    const written = await db
      .update(registrations)
      .set({ bowlingStyle: style.bowlingStyle })
      .where(and(where, isNull(registrations.bowlingStyle)))
      .returning({ id: registrations.id });
    if (written.length) changes["bowlingStyle"] = style.bowlingStyle;
  }
  if (Object.keys(changes).length)
    await db.insert(auditLog).values({
      id: newId(),
      actor: scope.actorId,
      action: "registration.style_set_by_scorer",
      scopeType: "org",
      scopeId: scope.orgId,
      subject: style.registrationId,
      meta: { fixtureId: scope.fixtureId, ...changes },
    });
}
