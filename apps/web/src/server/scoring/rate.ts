import { matchEvents, type Db } from "@desiauction/db";
import { and, eq, gte, sql } from "drizzle-orm";

export const SCORING_EVENTS_PER_MINUTE = 300;
/** Called after locking the match, so concurrent batches share one DB-counted budget. */
export async function scoringCapacity(db: Db, fixtureId: string, now: Date): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(matchEvents)
    .where(
      and(
        eq(matchEvents.fixtureId, fixtureId),
        gte(matchEvents.receivedAt, new Date(now.getTime() - 60_000)),
      ),
    );
  return Math.max(0, SCORING_EVENTS_PER_MINUTE - (row?.count ?? 0));
}
