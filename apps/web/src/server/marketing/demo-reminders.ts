import { demoBookings, demoRequests } from "@desiauction/db";
import { and, eq, gte, isNotNull, isNull, lt } from "drizzle-orm";

import { db } from "../db";
import { maySend } from "../messaging/consent";
import { tokenForRequest } from "./demo-booking";
import { sendBookingReminder } from "./demo-booking-mail";

/**
 * "WE'RE SPEAKING TOMORROW" AND "WE'RE CALLING IN AN HOUR".
 *
 * TWO WINDOWS, NOT TWO EXACT MOMENTS. A sweep that looked for bookings exactly
 * 24 hours out would miss every one of them the moment a run is late, skipped
 * or slow. It looks for bookings INSIDE a window and stamps the row when it
 * sends — so a run every ten minutes and a run twice a day both work, and
 * neither sends anything twice.
 *
 * IDEMPOTENT BY THE ROW, NOT BY THE CLOCK. `reminder_24h_sent_at` and
 * `reminder_1h_sent_at` are the record. Two sweeps racing each other both write
 * the same stamp on the same row; the guard is the `IS NULL` in the UPDATE's
 * WHERE, so exactly one of them wins and only the winner sends.
 *
 * CONSENT APPLIES HERE AND NOT AT REQUEST TIME, and the difference is real: the
 * acknowledgement answers something the person did thirty seconds ago, while
 * this is us starting a conversation a day later. It goes through
 * `maySend` — suppression first, then category — exactly like every other
 * message the platform originates. A refusal is a normal outcome, recorded and
 * not retried.
 */

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;

/** How wide a net each reminder casts. Generous enough to survive a late run. */
const WINDOWS = {
  24: { from: 23 * HOUR_MS, to: 25 * HOUR_MS },
  1: { from: 30 * MINUTE_MS, to: 90 * MINUTE_MS },
} as const;

export interface SweepResult {
  readonly considered: number;
  readonly sent: number;
  readonly refused: number;
  readonly skipped: number;
}

async function sweepWindow(kind: 24 | 1, now: Date): Promise<SweepResult> {
  const window = WINDOWS[kind];
  const stamp = kind === 24 ? demoBookings.reminder24hSentAt : demoBookings.reminder1hSentAt;

  const due = await db
    .select({
      bookingId: demoBookings.id,
      requestId: demoBookings.demoRequestId,
      slotStart: demoBookings.slotStart,
      slotEnd: demoBookings.slotEnd,
      name: demoRequests.name,
      orgName: demoRequests.orgName,
      email: demoRequests.email,
    })
    .from(demoBookings)
    .innerJoin(demoRequests, eq(demoRequests.id, demoBookings.demoRequestId))
    .where(
      and(
        isNull(demoBookings.cancelledAt),
        isNotNull(demoBookings.confirmedAt),
        isNull(stamp),
        gte(demoBookings.slotStart, new Date(now.getTime() + window.from)),
        lt(demoBookings.slotStart, new Date(now.getTime() + window.to)),
      ),
    );

  let sent = 0;
  let refused = 0;
  let skipped = 0;

  for (const booking of due) {
    // CLAIM FIRST, SEND SECOND. Stamping before the send means a crash between
    // the two loses a reminder; sending before the stamp means a crash sends it
    // twice. Losing one is the better failure — the person still has the
    // booking, the invite and the link, and a duplicate reminder reads as
    // carelessness at exactly the moment we are asking them to trust us.
    const claimed = await db
      .update(demoBookings)
      .set(kind === 24 ? { reminder24hSentAt: now } : { reminder1hSentAt: now })
      .where(and(eq(demoBookings.id, booking.bookingId), isNull(stamp)))
      .returning({ id: demoBookings.id });
    if (claimed.length === 0) {
      skipped += 1;
      continue;
    }

    if (booking.email === null) {
      skipped += 1;
      continue;
    }

    const decision = await maySend(db, {
      contact: booking.email,
      channel: "email",
      category: "transactional",
      scope: "demo",
      now,
    });
    if (!decision.send) {
      refused += 1;
      continue;
    }

    const outcome = await sendBookingReminder(
      {
        to: booking.email,
        name: booking.name,
        orgName: booking.orgName,
        requestId: booking.requestId,
        // Rebuilt, not remembered. The token is an HMAC of the request id, so
        // this sweep can reproduce the person's own manage link a day later
        // without the database ever having held it — which is exactly why the
        // token is derived rather than random (see `demo-booking.ts`).
        token: tokenForRequest(booking.requestId),
        slotStart: booking.slotStart,
        slotEnd: booking.slotEnd,
        sequence: 0,
      },
      kind,
    );
    if (outcome === "sent") {
      sent += 1;
    } else {
      refused += 1;
    }
  }

  return { considered: due.length, sent, refused, skipped };
}

export async function sweepDemoReminders(now: Date = new Date()): Promise<SweepResult> {
  const [day, hour] = await Promise.all([sweepWindow(24, now), sweepWindow(1, now)]);
  return {
    considered: day.considered + hour.considered,
    sent: day.sent + hour.sent,
    refused: day.refused + hour.refused,
    skipped: day.skipped + hour.skipped,
  };
}
