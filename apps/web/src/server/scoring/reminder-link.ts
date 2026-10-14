import { reminderBoundaries, type ReminderBoundaries } from "./reminder-boundaries";
import { auditLog } from "@desiauction/db";
import { and, eq } from "drizzle-orm";
import { eligibleTossReminder, reminderMeta, REQUEST_ACTION } from "./toss-reminder-state";

export function reminderId(raw: unknown): string | null {
  return typeof raw === "string" && /^[0-9A-HJKMNP-TV-Z]{26}$/.test(raw) ? raw : null;
}

/** Ownership is established without an org context before any match lookup. */
export async function resolveReminderLink(
  personId: string,
  raw: unknown,
  boundaries: ReminderBoundaries = reminderBoundaries,
) {
  const id = reminderId(raw);
  if (id === null) return null;
  const owned = await boundaries.asPerson(personId, async (db) => {
    const [row] = await db
      .select()
      .from(auditLog)
      .where(
        and(
          eq(auditLog.id, id),
          eq(auditLog.actor, personId),
          eq(auditLog.action, REQUEST_ACTION),
          eq(auditLog.scopeType, "org"),
        ),
      )
      .limit(1);
    const meta = reminderMeta(row?.meta);
    return row && meta?.personId === personId && meta.orgId === row.scopeId ? meta : null;
  });
  if (owned === null) return null;
  return boundaries.inOrg(personId, owned.orgId, async (db) => {
    const eligible = await eligibleTossReminder(
      db,
      id,
      personId,
      owned.orgId,
      owned.channel,
      false,
    );
    return eligible?.url ?? null;
  });
}
