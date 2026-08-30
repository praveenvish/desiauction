import { createHash, createHmac } from "node:crypto";

import { demoBookings, demoRequests, newId } from "@desiauction/db";
import { and, eq, isNull, sql } from "drizzle-orm";

import { db } from "../db";
import { env } from "../../env";
import { bookableDays } from "./demo-slots";

/**
 * TAKING A TIME, AND GIVING IT BACK.
 *
 * THE RACE IS SETTLED BY THE DATABASE. Two people pressing "confirm" on the
 * same slot within a few milliseconds both pass any check-then-insert; the
 * partial unique index `demo_bookings_slot_uq` is what actually refuses the
 * second one. So the code does not check first and hope — it inserts, and reads
 * the constraint violation as the answer. The loser is told the slot went, and
 * the picker re-renders without it.
 *
 * THE TOKEN IS THE PRINCIPAL, AND IT IS DERIVED RATHER THAN DRAWN.
 *
 * There is no session here and no tenant, so RLS has nothing to key on. What
 * authorises somebody against their own booking is a secret in the URL path,
 * stored only as a SHA-256 digest — the same shape sessions, org invites and
 * owner-join links all use. Path segment, never a query string: query strings
 * leak through `Referer` into every third party a page later talks to.
 *
 * It differs from those three in one way, and the reason is the reminder sweep.
 * A random token is unrecoverable the moment it is hashed, so a job running a
 * day later could not rebuild the manage link that is the entire point of a
 * reminder — and keeping the plaintext in the row to solve that would hand a
 * leaked backup a working link to every booking. So the token is an HMAC of the
 * REQUEST id under a key that lives in the environment: reproducible by the
 * application, still absent from the database, and stable across a reschedule
 * so the link already sitting in somebody's mailbox keeps working.
 *
 * A RESCHEDULE IS A NEW ROW, never an UPDATE of `slotStart`. "What time did we
 * agree, and when did that change?" is a question about the past, and a mutated
 * column cannot answer it. The old row is cancelled, the new one points back at
 * it, and the token travels across so the person's link keeps working.
 */

export interface IssuedBooking {
  readonly bookingId: string;
  /** Handed to the requester once — in a link and in their mail. Never stored. */
  readonly token: string;
}

export type BookResult =
  | { readonly ok: true; readonly booking: IssuedBooking }
  | {
      readonly ok: false;
      readonly reason: "taken" | "gone" | "unknown-request" | "already-booked";
    };

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * The link for a request, derivable at any later time from the request id
 * alone. Truncated to 32 base64url characters — 192 bits, which is more than a
 * random 24-byte token would have given and far past guessing.
 */
export function tokenForRequest(requestId: string): string {
  return createHmac("sha256", env.DEMO_TOKEN_SECRET)
    .update(`demo-booking:${requestId}`)
    .digest("base64url")
    .slice(0, 32);
}

function isUniqueViolation(error: unknown): boolean {
  // postgres.js surfaces the SQLSTATE on the error object. 23505 is
  // unique_violation, and on this table it can only be the slot index or the
  // token index — a token collision at 24 random bytes is not a thing that
  // happens, so it is the slot, and "taken" is the honest answer either way.
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "23505"
  );
}

/**
 * `slotStartIso` arrives from a form and is NOT trusted. It is checked against
 * the live derivation, so a hand-edited instant cannot book 3am on a Sunday, a
 * slot inside the lead time, or a day that is blacked out.
 */
export async function bookSlot(
  requestId: string,
  slotStartIso: string,
  now: Date = new Date(),
): Promise<BookResult> {
  const [request] = await db
    .select({ id: demoRequests.id })
    .from(demoRequests)
    .where(eq(demoRequests.id, requestId))
    .limit(1);
  if (request === undefined) {
    return { ok: false, reason: "unknown-request" };
  }

  // One live booking per request. Somebody who wants a different time
  // reschedules the one they have; two open bookings for one lead is a
  // double-entry in the founder's day.
  const [existing] = await db
    .select({ id: demoBookings.id })
    .from(demoBookings)
    .where(and(eq(demoBookings.demoRequestId, requestId), isNull(demoBookings.cancelledAt)))
    .limit(1);
  if (existing !== undefined) {
    return { ok: false, reason: "already-booked" };
  }

  const offered = (await bookableDays(now))
    .flatMap((day) => day.slots)
    .find((slot) => slot.startIso === slotStartIso);
  if (offered === undefined) {
    return { ok: false, reason: "gone" };
  }

  const token = tokenForRequest(requestId);
  const bookingId = newId();
  try {
    await db.transaction(async (tx) => {
      // A request that cancelled and is booking again would collide with its
      // OWN retired row: the token is derived from the request, and `token_hash`
      // is UNIQUE across every row. The dead booking surrenders the hash first
      // — it keeps its history and has no further use for a live link. Without
      // this, re-booking after a cancellation reports the slot as taken by
      // somebody else, which is both wrong and unfalsifiable from the outside.
      await tx
        .update(demoBookings)
        .set({ tokenHash: sql`'retired:' || ${demoBookings.id}` })
        .where(
          and(
            eq(demoBookings.demoRequestId, requestId),
            eq(demoBookings.tokenHash, hashToken(token)),
          ),
        );

      await tx.insert(demoBookings).values({
        id: bookingId,
        demoRequestId: requestId,
        slotStart: new Date(offered.startIso),
        slotEnd: new Date(offered.endIso),
        tokenHash: hashToken(token),
        // Picking IS confirming. A separate confirmation step would be a second
        // chance to lose somebody who has already said yes; the mail that
        // follows carries the cancel link, which is the out that matters.
        confirmedAt: now,
      });
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      return { ok: false, reason: "taken" };
    }
    throw error;
  }

  return { ok: true, booking: { bookingId, token } };
}

export interface BookingView {
  readonly id: string;
  readonly slotStart: Date;
  readonly slotEnd: Date;
  readonly cancelledAt: Date | null;
  readonly cancelledBy: "requester" | "organizer" | null;
  readonly name: string;
  readonly orgName: string;
  readonly email: string | null;
}

/** Resolve a token to its booking. Unknown token = null; the page 404s. */
export async function bookingByToken(token: string): Promise<BookingView | null> {
  // Length-checked before hashing so a pasted paragraph never becomes a query.
  if (token.length < 16 || token.length > 128) {
    return null;
  }
  const [row] = await db
    .select({
      id: demoBookings.id,
      slotStart: demoBookings.slotStart,
      slotEnd: demoBookings.slotEnd,
      cancelledAt: demoBookings.cancelledAt,
      cancelledBy: demoBookings.cancelledBy,
      name: demoRequests.name,
      orgName: demoRequests.orgName,
      email: demoRequests.email,
    })
    .from(demoBookings)
    .innerJoin(demoRequests, eq(demoRequests.id, demoBookings.demoRequestId))
    .where(eq(demoBookings.tokenHash, hashToken(token)))
    .limit(1);
  return row ?? null;
}

export type CancelResult =
  { readonly ok: true } | { readonly ok: false; readonly reason: "unknown" | "already-cancelled" };

export async function cancelBooking(
  token: string,
  by: "requester" | "organizer",
  now: Date = new Date(),
): Promise<CancelResult> {
  const booking = await bookingByToken(token);
  if (booking === null) {
    return { ok: false, reason: "unknown" };
  }
  if (booking.cancelledAt !== null) {
    return { ok: false, reason: "already-cancelled" };
  }
  await db
    .update(demoBookings)
    .set({ cancelledAt: now, cancelledBy: by })
    .where(and(eq(demoBookings.id, booking.id), isNull(demoBookings.cancelledAt)));
  return { ok: true };
}

export type RescheduleResult =
  | { readonly ok: true; readonly token: string; readonly slotStart: Date }
  | { readonly ok: false; readonly reason: "unknown" | "already-cancelled" | "taken" | "gone" };

/**
 * The old booking steps aside and a new one takes its place, carrying the SAME
 * token — the link already in somebody's mailbox must keep working, and a
 * second link for the same conversation is how people end up cancelling the
 * wrong one.
 *
 * Order matters: the new row is inserted FIRST. If the slot has gone, the
 * insert fails and the person still has the booking they had. Cancelling first
 * would leave them with nothing on the losing side of a race.
 *
 * The token cannot be on both rows at once (`token_hash` is UNIQUE), so the
 * hand-over happens inside one transaction: cancel-and-clear the old row's
 * hash, then claim it on the new one. A crash mid-way rolls back to the
 * original booking, intact.
 */
export async function rescheduleBooking(
  token: string,
  slotStartIso: string,
  now: Date = new Date(),
): Promise<RescheduleResult> {
  const booking = await bookingByToken(token);
  if (booking === null) {
    return { ok: false, reason: "unknown" };
  }
  if (booking.cancelledAt !== null) {
    return { ok: false, reason: "already-cancelled" };
  }

  const offered = (await bookableDays(now))
    .flatMap((day) => day.slots)
    .find((slot) => slot.startIso === slotStartIso);
  if (offered === undefined) {
    return { ok: false, reason: "gone" };
  }

  const [existing] = await db
    .select({ requestId: demoBookings.demoRequestId })
    .from(demoBookings)
    .where(eq(demoBookings.id, booking.id))
    .limit(1);
  if (existing === undefined) {
    return { ok: false, reason: "unknown" };
  }

  const newBookingId = newId();
  try {
    await db.transaction(async (tx) => {
      // The old row keeps its history but surrenders the token: a UNIQUE index
      // will not hold the same hash on two rows, and the retired booking has no
      // further use for it.
      await tx
        .update(demoBookings)
        .set({
          cancelledAt: now,
          cancelledBy: "requester",
          tokenHash: `retired:${booking.id}`,
        })
        .where(and(eq(demoBookings.id, booking.id), isNull(demoBookings.cancelledAt)));

      await tx.insert(demoBookings).values({
        id: newBookingId,
        demoRequestId: existing.requestId,
        slotStart: new Date(offered.startIso),
        slotEnd: new Date(offered.endIso),
        tokenHash: hashToken(token),
        confirmedAt: now,
        rescheduledFrom: booking.id,
      });
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      return { ok: false, reason: "taken" };
    }
    throw error;
  }

  return { ok: true, token, slotStart: new Date(offered.startIso) };
}
