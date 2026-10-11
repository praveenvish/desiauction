import { auditLog } from "@desiauction/db";
import { and, eq } from "drizzle-orm";
import { reminderId } from "./reminder-link";
import { reminderBoundaries, type ReminderBoundaries } from "./reminder-boundaries";
import { confirmationNoticeAddress } from "./confirmation-notice-state";
import { confirmationToken } from "./confirmation-token";
import { confirmationContext } from "./confirmation";

export async function resolveConfirmationNoticeLink(
  personId: string,
  raw: unknown,
  boundaries: ReminderBoundaries = reminderBoundaries,
  now = new Date(),
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
          eq(auditLog.actor, personId),
          eq(auditLog.scopeType, "person"),
          eq(auditLog.scopeId, personId),
        ),
      );
    if (
      !row ||
      !["match.confirm_requested", "match.confirm_notice_dispatched"].includes(row.action)
    )
      return null;
    const address = confirmationNoticeAddress(row.subject);
    const meta = row.meta as { orgId?: unknown } | null;
    const orgId = reminderId(meta?.orgId);
    return address?.personId === personId && orgId ? { address, orgId, issuedAt: row.at } : null;
  });
  if (!owned) return null;
  return boundaries.inOrg(personId, owned.orgId, async (db) => {
    const token = confirmationToken(owned.address, owned.issuedAt);
    return (await confirmationContext(db, personId, token, now)) ? `/match/confirm/${token}` : null;
  });
}
