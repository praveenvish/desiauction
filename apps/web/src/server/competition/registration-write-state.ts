import { registrations, type Db } from "@desiauction/db";
import { and, eq, inArray, sql } from "drizzle-orm";
import { boundedStringList } from "./write-state-input";

/** One review-gated batch read of only the fields changed by triage/adult bulk actions. */
export async function registrationWriteState(
  db: Db,
  competitionId: string,
  requested: readonly string[],
) {
  if (!boundedStringList(requested, 1, 1000)) return null;
  const ids = [...new Set(requested)];
  const rows = await db
    .select({
      id: registrations.id,
      status: registrations.status,
      adultConfirmed: sql<boolean>`${registrations.adultConfirmedAt} is not null`,
      rejectionReason: registrations.rejectionReason,
      rejectionNote: registrations.rejectionNote,
    })
    .from(registrations)
    .where(and(eq(registrations.competitionId, competitionId), inArray(registrations.id, ids)));
  if (rows.length !== ids.length) return null;
  return rows;
}
