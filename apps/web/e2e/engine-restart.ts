import { auctions, competitions, createDb } from "@desiauction/db";
import { expect, type APIRequestContext } from "@playwright/test";
import { eq } from "drizzle-orm";

/**
 * RESTART THE ENGINE FOR ONE AUCTION — NEVER FOR THE WHOLE SUITE.
 *
 * `live-auction.spec.ts` and `conduct-ceremony.spec.ts` both prove the room
 * survives an engine restart, through the engine's test surface
 * `POST /admin/reset`. Both sent an EMPTY body, and an empty body resets every
 * auction the engine holds: it is a restart of the one engine process the whole
 * suite shares.
 *
 * With one worker that is merely rude. With two — which is what CI's `CI=true`
 * gives the nightly — it lands in the middle of another spec's live auction:
 * that auction's in-memory state, its command queue and its idempotency cache
 * vanish mid-journey, its lot clock stops until something touches it again, and
 * the other spec fails somewhere that has nothing to do with restarts. Which
 * spec, and where, depends on what the other worker happened to be doing — the
 * "different failure every run" signature that kept Firefox and WebKit out of
 * the nightly (their slower journeys overlap more).
 *
 * The rule under test is "THIS room survives a restart", and the engine takes
 * an `auctionId` to reset exactly that. The id is read from the database by the
 * season slug the spec already holds; per-call connection, like `otp.ts`.
 */

const DB_URL =
  process.env["DATABASE_URL"] ?? "postgres://desiauction:desiauction@localhost:5433/desiauction";
const ENGINE = "http://127.0.0.1:4000";
const ENGINE_SECRET = process.env["ENGINE_SECRET"] ?? "dev-engine-secret";

async function auctionIdForSeason(seasonSlug: string): Promise<string> {
  const handle = createDb(DB_URL, { max: 1 });
  try {
    const [row] = await handle.db
      .select({ id: auctions.id })
      .from(auctions)
      .innerJoin(competitions, eq(competitions.id, auctions.competitionId))
      .where(eq(competitions.slug, seasonSlug))
      .limit(1);
    if (row === undefined) {
      throw new Error(`no auction for season ${seasonSlug} — create it before restarting`);
    }
    return row.id;
  } finally {
    await handle.sql.end({ timeout: 5 });
  }
}

export async function restartEngineFor(
  request: APIRequestContext,
  seasonSlug: string,
): Promise<void> {
  const auctionId = await auctionIdForSeason(seasonSlug);
  const reset = await request.post(`${ENGINE}/admin/reset`, {
    headers: { "x-engine-secret": ENGINE_SECRET },
    data: { auctionId },
  });
  expect(reset.ok()).toBe(true);
}
