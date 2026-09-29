// Against real Postgres. One demo request may take a slot a bounded number of
// times (PRR 2026-09-29): every booking and every move mails a confirmation to
// an unverified address, so an unbounded loop was an unbounded supply of mail.
import {
  createDb,
  demoAvailability,
  demoBookings,
  demoRequests,
  newId,
  people,
  type DbHandle,
} from "@desiauction/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { env } from "../../env";
import {
  MAX_BOOKINGS_PER_REQUEST,
  bookSlot,
  cancelBooking,
  rescheduleBooking,
} from "./demo-booking";
import { recordDemoRequest } from "./demo-requests";
import { bookableDays } from "./demo-slots";

const handle: DbHandle = createDb(env.DATABASE_URL);
const db = handle.db;

const RUN = String(Date.now()).slice(-8);
const host = newId();
let requestId = "";

async function freeSlots(count: number): Promise<string[]> {
  const slots = (await bookableDays()).flatMap((day) => day.slots).map((slot) => slot.startIso);
  // From the far end of the horizon: nothing else in the suite books there.
  return slots.slice(-count).reverse();
}

beforeAll(async () => {
  await db.insert(people).values({ id: host, phone: `+9184${RUN}`, name: "Ceiling Host" });
  await db.insert(demoAvailability).values(
    [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
      id: newId(),
      weekday,
      startMinute: 9 * 60,
      endMinute: 21 * 60,
      slotMinutes: 30,
      createdBy: host,
    })),
  );
  requestId = await recordDemoRequest(db, {
    name: "Ceiling Ravi",
    phone: `+9185${RUN}`,
    email: `ceiling${RUN}@example.test`,
    orgName: `Ceiling Warriors ${RUN}`,
    sport: "cricket",
    tournamentSize: "8-16",
    auctionOn: null,
    preferredWindow: "any",
    note: null,
    source: "schedule-demo",
    requestIp: null,
  });
});

afterAll(async () => {
  await db.delete(demoBookings).where(eq(demoBookings.demoRequestId, requestId));
  await db.delete(demoRequests).where(eq(demoRequests.id, requestId));
  await db.delete(demoAvailability).where(eq(demoAvailability.createdBy, host));
  await db.delete(people).where(eq(people.id, host));
  await handle.sql.end({ timeout: 5 });
});

describe("one request, a bounded number of bookings", () => {
  it("books, moves five times, and is refused the sixth move with its booking intact", async () => {
    const slots = await freeSlots(MAX_BOOKINGS_PER_REQUEST + 2);
    expect(slots.length).toBe(MAX_BOOKINGS_PER_REQUEST + 2);

    const booked = await bookSlot(requestId, slots[0] as string);
    expect(booked.ok).toBe(true);
    if (!booked.ok) return;
    const token = booked.booking.token;

    for (let move = 1; move < MAX_BOOKINGS_PER_REQUEST; move++) {
      const moved = await rescheduleBooking(token, slots[move] as string);
      expect(moved.ok, `move ${String(move)}`).toBe(true);
    }

    const refused = await rescheduleBooking(token, slots[MAX_BOOKINGS_PER_REQUEST] as string);
    expect(refused).toEqual({ ok: false, reason: "too-many-changes" });

    // Refused means NOTHING moved: the booking they had is the booking they have.
    const live = await db
      .select({ slotStart: demoBookings.slotStart, cancelledAt: demoBookings.cancelledAt })
      .from(demoBookings)
      .where(eq(demoBookings.demoRequestId, requestId));
    expect(live).toHaveLength(MAX_BOOKINGS_PER_REQUEST);
    const open = live.filter((row) => row.cancelledAt === null);
    expect(open).toHaveLength(1);
    expect(open[0]?.slotStart.toISOString()).toBe(
      new Date(slots[MAX_BOOKINGS_PER_REQUEST - 1] as string).toISOString(),
    );

    // Cancelling still works — the way out is never the thing that is capped —
    // and booking again afterwards is not a way round the ceiling.
    expect(await cancelBooking(token, "requester")).toEqual({ ok: true });
    expect(await bookSlot(requestId, slots[MAX_BOOKINGS_PER_REQUEST + 1] as string)).toEqual({
      ok: false,
      reason: "too-many-changes",
    });
  });
});
