import { auditLog, competitions } from "@desiauction/db";
import { and, eq } from "drizzle-orm";
import { reminderBoundaries, type ReminderBoundaries } from "./reminder-boundaries";
import { reminderId } from "./reminder-link";
import { eligibleMatchNotice, matchNoticeAddress } from "./result-notice-state";
/** Establish recipient ownership without a tenant before looking up any private fixture. */
export async function resolveMatchNoticeLink(
  personId: string,
  raw: unknown,
  boundaries: ReminderBoundaries = reminderBoundaries,
) {
  const id = reminderId(raw);
  if (!id) return null;
  const owned = await boundaries.asPerson(personId, async (db) => {
    const [row] = await db
      .select()
      .from(auditLog)
      .where(
        and(
          eq(auditLog.id, id),
          eq(auditLog.scopeType, "person"),
          eq(auditLog.scopeId, personId),
          eq(auditLog.actor, personId),
        ),
      )
      .limit(1);
    if (
      !row ||
      !["match.result_published", "match.award_won", "match.notice_dispatched"].includes(
        row.action,
      ) ||
      !row.subject
    )
      return null;
    const address = matchNoticeAddress(row.subject);
    const meta = row.meta as { orgId?: unknown } | null;
    return address &&
      address.personId === personId &&
      typeof meta?.orgId === "string" &&
      reminderId(meta.orgId)
      ? { address, orgId: meta.orgId }
      : null;
  });
  if (!owned) return null;
  return boundaries.inOrg(personId, owned.orgId, async (db) => {
    const eligible = await eligibleMatchNotice(db, owned.orgId, owned.address);
    if (!eligible) return null;
    const [season] = await db
      .select({ slug: competitions.slug, visibility: competitions.visibility })
      .from(competitions)
      .where(and(eq(competitions.id, eligible.competitionId), eq(competitions.orgId, owned.orgId)));
    if (!season) return null;
    return season.visibility === "public"
      ? `/c/${encodeURIComponent(season.slug)}/m/${encodeURIComponent(eligible.number)}`
      : `/m/${encodeURIComponent(eligible.token)}`;
  });
}
