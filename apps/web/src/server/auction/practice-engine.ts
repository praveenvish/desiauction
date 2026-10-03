import { auctionEvents, auctions } from "@desiauction/db";
import { and, eq, inArray, lt, or, sql } from "drizzle-orm";

import { systemDb } from "../db";
import { sendEngineCommand } from "./engine-client";

/**
 * End a practice auction through the engine, its single writer (0101). True
 * once it is over — including when it already was.
 *
 * Ending a rehearsal is not the destructive act aborting the night is, so the
 * auctioneer who opens the night may do it: the command carries `manage` for
 * that one purpose. Deliberately NOT in a "use server" module — every export
 * there is callable from a browser, and this takes the auction id on trust.
 */
export async function endPractice(practiceId: string, personId: string): Promise<boolean> {
  const ack = await sendEngineCommand({
    auctionId: practiceId,
    type: "AbortAuction",
    actor: personId,
    conduct: true,
    manage: true,
    payload: { reason: "practice ended" },
  });
  return ack.accepted || ack.reason === "illegal_transition";
}

/** A practice is a ten-minute rehearsal; one still running after this was forgotten. */
export const PRACTICE_MAX_AGE_MS = 4 * 60 * 60 * 1000;
/** …and one with nothing done in it for this long is over, whatever its age. */
export const PRACTICE_IDLE_MS = 60 * 60 * 1000;

/**
 * END THE PRACTICES SOMEBODY FORGOT (0101) — run by the feedback sweep every
 * fifteen minutes.
 *
 * A practice left running keeps a room open on the engine and the switch on
 * every owner's screen — and, worse, is the room everyone lands in on the
 * night if it is still there. One ends, through the engine like a click on
 * End practice and attributed to the organiser who started it, when:
 *
 * - nothing has happened in it for an hour,
 * - it is four hours old, whatever happened, or
 * - the season's real auction has already started (its open ends the
 *   practice; this catches one the engine could not end then).
 *
 * Reads across clubs on the system pool (select only); the write is the engine's.
 */
export async function endStalePractices(): Promise<{ ended: number; failed: number }> {
  const stale = await systemDb
    .select({ id: auctions.id, createdBy: auctions.createdBy })
    .from(auctions)
    .where(
      and(
        eq(auctions.kind, "practice"),
        inArray(auctions.status, ["scheduled", "live", "paused"]),
        or(
          lt(auctions.createdAt, new Date(Date.now() - PRACTICE_MAX_AGE_MS)),
          sql`coalesce((select max(${auctionEvents.atMs}) from ${auctionEvents}
                where ${auctionEvents.auctionId} = ${auctions.id}), 0)
              < ${Date.now() - PRACTICE_IDLE_MS}`,
          sql`exists (select 1 from ${auctions} as night
                where night.competition_id = ${auctions.competitionId}
                  and night.kind = 'real' and night.status <> 'scheduled')`,
        ),
      ),
    )
    .limit(100);
  let ended = 0;
  let failed = 0;
  for (const practice of stale) {
    if (await endPractice(practice.id, practice.createdBy)) {
      ended++;
    } else {
      failed++;
    }
  }
  return { ended, failed };
}
