"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { demoBookings, demoRequests } from "@desiauction/db";
import { eq, sql } from "drizzle-orm";

import { db } from "../db";
import { bookSlot, bookingByToken, cancelBooking, rescheduleBooking } from "./demo-booking";
import { sendBookingCancellation, sendBookingConfirmation } from "./demo-booking-mail";

/**
 * THE PUBLIC BOOKING ACTIONS.
 *
 * Everything here is reachable without a session, which is the point — a
 * stranger booking a demo has no account and should not need one. What stands
 * in for authentication is the token (see `demo-booking.ts`), and every action
 * that touches an existing booking takes one.
 *
 * Mail is awaited but never allowed to fail the action: a booking that exists
 * and a confirmation that did not send is recoverable; a booking that was
 * rolled back because a mail provider was down is not.
 */

/**
 * ONE state shape for both slot-choosing actions, because ONE component drives
 * them both — the picker is the same widget whether it is claiming a first time
 * or moving an existing one, and two near-identical state types would force it
 * to be two near-identical components.
 *
 * There is no "booked" variant: booking redirects to the booking's own page.
 */
export type SlotActionState =
  | { readonly status: "idle" }
  | { readonly status: "moved" }
  | { readonly status: "error"; readonly message: string };

/** How many times this request's slot has moved — the invite's SEQUENCE. */
async function sequenceFor(requestId: string): Promise<number> {
  const [row] = (await db
    .select({ count: sql<number>`count(*)::int` })
    .from(demoBookings)
    .where(eq(demoBookings.demoRequestId, requestId))) as [{ count: number }];
  return Math.max(0, row.count - 1);
}

async function mailRecipient(
  requestId: string,
): Promise<{ email: string; name: string; orgName: string } | null> {
  const [row] = await db
    .select({ email: demoRequests.email, name: demoRequests.name, orgName: demoRequests.orgName })
    .from(demoRequests)
    .where(eq(demoRequests.id, requestId))
    .limit(1);
  if (row === undefined || row.email === null) {
    return null;
  }
  return { email: row.email, name: row.name, orgName: row.orgName };
}

export async function bookSlotAction(
  _previous: SlotActionState,
  formData: FormData,
): Promise<SlotActionState> {
  const requestId = formData.get("requestId");
  const slotStart = formData.get("slotStart");
  if (typeof requestId !== "string" || typeof slotStart !== "string") {
    return { status: "error", message: "Pick a time to continue." };
  }

  const result = await bookSlot(requestId, slotStart);
  if (!result.ok) {
    return {
      status: "error",
      message:
        result.reason === "taken" || result.reason === "gone"
          ? "Somebody just took that time. Pick another and we'll hold it."
          : result.reason === "already-booked"
            ? "You already have a demo booked. Use the link in your email to move it."
            : "We couldn't find that request. Start again from the demo page.",
    };
  }

  const recipient = await mailRecipient(requestId);
  if (recipient !== null) {
    const booking = await bookingByToken(result.booking.token);
    if (booking !== null) {
      const outcome = await sendBookingConfirmation({
        to: recipient.email,
        name: recipient.name,
        orgName: recipient.orgName,
        requestId,
        token: result.booking.token,
        slotStart: booking.slotStart,
        slotEnd: booking.slotEnd,
        sequence: await sequenceFor(requestId),
      });
      if (outcome === "failed") {
        // eslint-disable-next-line no-console
        console.error("demo booking confirmation failed", { requestId });
      }
    }
  }

  // Straight to their own booking page, which is the only surface that can
  // show the time AND the way out of it. `redirect` throws by design, so it
  // sits after every await that could still fail.
  redirect(`/demo/${result.booking.token}`);
}

/** Cancelling has its own outcome, and only one surface drives it. */
export type ManageState =
  | { readonly status: "idle" }
  | { readonly status: "cancelled" }
  | { readonly status: "error"; readonly message: string };

export async function cancelBookingAction(
  _previous: ManageState,
  formData: FormData,
): Promise<ManageState> {
  const token = formData.get("token");
  if (typeof token !== "string") {
    return { status: "error", message: "That link is not valid." };
  }

  const booking = await bookingByToken(token);
  const result = await cancelBooking(token, "requester");
  if (!result.ok) {
    return {
      status: "error",
      message:
        result.reason === "already-cancelled"
          ? "That demo was already cancelled."
          : "That link is not valid.",
    };
  }

  if (booking !== null && booking.email !== null) {
    const [request] = await db
      .select({ id: demoRequests.id })
      .from(demoBookings)
      .innerJoin(demoRequests, eq(demoRequests.id, demoBookings.demoRequestId))
      .where(eq(demoBookings.id, booking.id))
      .limit(1);
    if (request !== undefined) {
      await sendBookingCancellation({
        to: booking.email,
        name: booking.name,
        orgName: booking.orgName,
        requestId: request.id,
        token,
        slotStart: booking.slotStart,
        slotEnd: booking.slotEnd,
        sequence: (await sequenceFor(request.id)) + 1,
      });
    }
  }

  revalidatePath(`/demo/${token}`);
  return { status: "cancelled" };
}

export async function rescheduleBookingAction(
  _previous: SlotActionState,
  formData: FormData,
): Promise<SlotActionState> {
  const token = formData.get("token");
  const slotStart = formData.get("slotStart");
  if (typeof token !== "string" || typeof slotStart !== "string") {
    return { status: "error", message: "Pick a new time to continue." };
  }

  const result = await rescheduleBooking(token, slotStart);
  if (!result.ok) {
    return {
      status: "error",
      message:
        result.reason === "taken" || result.reason === "gone"
          ? "Somebody just took that time. Pick another."
          : result.reason === "already-cancelled"
            ? "That demo was cancelled. Book a new one from the demo page."
            : "That link is not valid.",
    };
  }

  const moved = await bookingByToken(token);
  if (moved !== null && moved.email !== null) {
    const [row] = await db
      .select({ requestId: demoBookings.demoRequestId })
      .from(demoBookings)
      .where(eq(demoBookings.id, moved.id))
      .limit(1);
    if (row !== undefined) {
      await sendBookingConfirmation({
        to: moved.email,
        name: moved.name,
        orgName: moved.orgName,
        requestId: row.requestId,
        token,
        slotStart: moved.slotStart,
        slotEnd: moved.slotEnd,
        sequence: await sequenceFor(row.requestId),
      });
    }
  }

  revalidatePath(`/demo/${token}`);
  return { status: "moved" };
}
