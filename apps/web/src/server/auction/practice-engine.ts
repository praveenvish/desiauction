import { auctions } from "@desiauction/db";
import { and, eq, inArray, lt } from "drizzle-orm";

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

/**
 * END THE PRACTICES SOMEBODY FORGOT (0101) — run by the feedback sweep every
 * fifteen minutes.
 *
 * A practice left running keeps a room open on the engine and the switch on
 * every owner's screen until the real auction opens, which may be days away.
 * Anything older than four hours ends, through the engine like a click on End
 * practice, attributed to the organiser who started it. Reads across clubs on
 * the system pool (select only); the write is the engine's.
 */
export async function endStalePractices(): Promise<{ ended: number; failed: number }> {
  const stale = await systemDb
    .select({ id: auctions.id, createdBy: auctions.createdBy })
    .from(auctions)
    .where(
      and(
        eq(auctions.kind, "practice"),
        inArray(auctions.status, ["scheduled", "live", "paused"]),
        lt(auctions.createdAt, new Date(Date.now() - PRACTICE_MAX_AGE_MS)),
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
