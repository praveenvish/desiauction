import { demoAvailability, demoBlackouts, demoBookings, demoRequests } from "@desiauction/db";
import { desc, isNull, sql } from "drizzle-orm";

import { systemDb } from "../db";

/**
 * THE DEMO QUEUE, AS A PROJECTION.
 *
 * Read-only, like every other module in administration: no mutation verb
 * appears here, and the source-level scan in
 * `admin-foundation.regression.test.ts` fails the suite if one ever does. The
 * write lives in `server/marketing/demo-desk.ts` for exactly that reason.
 *
 * On the system pool, which every cross-tenant admin projection uses. This one
 * has no tenant at all — `demo_requests` has no `org_id` — so the pool is not
 * doing RLS work here; it is doing the ordinary thing administration's reads do.
 *
 * OPEN FIRST, ANSWERED BELOW. The queue's job is "who is waiting for a reply",
 * and everything else on the page is history. The note is returned in full and
 * never truncated: it is the column that decides whether to ring or write, and
 * a queue that hides it makes the operator open every row to find out.
 */

export interface DemoQueueRow {
  readonly id: string;
  readonly name: string;
  readonly phone: string;
  readonly email: string | null;
  readonly orgName: string;
  readonly tournamentSize: string;
  readonly auctionOn: string | null;
  readonly preferredWindow: string;
  readonly note: string | null;
  readonly source: string;
  readonly createdAt: Date;
  readonly contactedAt: Date | null;
  readonly outcome: string | null;
  /** The live booking, if they picked a time. Null means still to be arranged. */
  readonly slotStart: Date | null;
}

export interface DemoQueue {
  readonly open: readonly DemoQueueRow[];
  readonly answered: readonly DemoQueueRow[];
  readonly upcoming: readonly DemoQueueRow[];
}

const RECENT_LIMIT = 50;

const columns = {
  id: demoRequests.id,
  name: demoRequests.name,
  phone: demoRequests.phone,
  email: demoRequests.email,
  orgName: demoRequests.orgName,
  tournamentSize: demoRequests.tournamentSize,
  auctionOn: demoRequests.auctionOn,
  preferredWindow: demoRequests.preferredWindow,
  note: demoRequests.note,
  source: demoRequests.source,
  createdAt: demoRequests.createdAt,
  contactedAt: demoRequests.contactedAt,
  outcome: demoRequests.outcome,
  slotStart: sql<Date | null>`${demoBookings.slotStart}`.as("slot_start"),
};

export async function demoQueue(): Promise<DemoQueue> {
  const rows = await systemDb
    .select(columns)
    .from(demoRequests)
    // The LIVE booking only. A cancelled one must not make a request look
    // arranged — that is the difference between "nobody has answered them" and
    // "somebody is expecting a call".
    .leftJoin(
      demoBookings,
      sql`${demoBookings.demoRequestId} = ${demoRequests.id} and ${demoBookings.cancelledAt} is null`,
    )
    .orderBy(desc(demoRequests.createdAt))
    .limit(RECENT_LIMIT);

  const now = new Date();
  return {
    open: rows.filter((row) => row.contactedAt === null),
    upcoming: rows.filter((row) => row.slotStart !== null && row.slotStart > now),
    answered: rows.filter((row) => row.contactedAt !== null),
  };
}

/** The number on the console's overview: how many people are waiting. */
export async function openDemoCount(): Promise<number> {
  const [row] = (await systemDb
    .select({ count: sql<number>`count(*)::int` })
    .from(demoRequests)
    .where(isNull(demoRequests.contactedAt))) as [{ count: number }];
  return row.count;
}

/** Availability as published, for the desk that edits it. */
export async function publishedAvailability(): Promise<
  readonly {
    id: string;
    weekday: number;
    startMinute: number;
    endMinute: number;
    slotMinutes: number;
  }[]
> {
  return systemDb
    .select({
      id: demoAvailability.id,
      weekday: demoAvailability.weekday,
      startMinute: demoAvailability.startMinute,
      endMinute: demoAvailability.endMinute,
      slotMinutes: demoAvailability.slotMinutes,
    })
    .from(demoAvailability)
    .orderBy(demoAvailability.weekday, demoAvailability.startMinute);
}

/** Blackout days, newest first — the ones that still matter are the future ones. */
export async function publishedBlackouts(): Promise<
  readonly { id: string; blackoutOn: string; reason: string | null }[]
> {
  return systemDb
    .select({
      id: demoBlackouts.id,
      blackoutOn: demoBlackouts.blackoutOn,
      reason: demoBlackouts.reason,
    })
    .from(demoBlackouts)
    .orderBy(desc(demoBlackouts.blackoutOn))
    .limit(RECENT_LIMIT);
}
