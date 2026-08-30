import { demoAvailability, demoBlackouts, newId } from "@desiauction/db";
import { eq } from "drizzle-orm";

import { db } from "../db";
import type { AnswerResult } from "./demo-desk";

/**
 * PUBLISHING THE HOURS SOMEBODY WILL ANSWER A CALL.
 *
 * The writer for the availability desk, living outside `server/admin` for the
 * reason `demo-desk.ts` sets out: administration holds exactly one write, and
 * a source scan over those directories enforces it.
 *
 * THIS IS THE HONESTY MECHANISM FOR THE WHOLE FEATURE. What is published here
 * is what `/schedule-demo` promises: with no windows, the page does not draw an
 * empty calendar — it says a person will come back to you, which is what will
 * actually happen. Nothing else in the product degrades so cleanly, and it is
 * worth keeping that way.
 *
 * Everything arrives from a form as a string and is parsed here. The CHECK
 * constraints in 0032 are the backstop, not the validation: a constraint
 * violation is a 500 where the surface has a sentence it knows how to say.
 */

const MAX_MINUTE = 1440;

function parseMinuteOfDay(raw: string): number | null {
  // `<input type="time">` gives "HH:MM"; a plain number is also accepted so the
  // same function serves an admin form and a test.
  const clock = /^(\d{1,2}):(\d{2})$/.exec(raw);
  if (clock !== null) {
    const hours = Number(clock[1]);
    const minutes = Number(clock[2]);
    if (hours > 23 || minutes > 59) {
      return null;
    }
    return hours * 60 + minutes;
  }
  const asNumber = Number(raw);
  return Number.isInteger(asNumber) && asNumber >= 0 && asNumber <= MAX_MINUTE ? asNumber : null;
}

export async function addAvailabilityWindow(
  input: { weekday: string; startMinute: string; endMinute: string; slotMinutes: string },
  actorId: string,
): Promise<AnswerResult> {
  const weekday = Number(input.weekday);
  if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) {
    return { ok: false, error: "Pick a day of the week." };
  }
  const start = parseMinuteOfDay(input.startMinute);
  const end = parseMinuteOfDay(input.endMinute);
  if (start === null || end === null || start >= end) {
    return { ok: false, error: "The window has to start before it ends." };
  }
  const slot = Number(input.slotMinutes);
  if (!Number.isInteger(slot) || slot < 15 || slot > 240) {
    return { ok: false, error: "A slot is between 15 minutes and four hours." };
  }
  if (end - start < slot) {
    return { ok: false, error: "That window is shorter than one slot, so it would offer nothing." };
  }

  await db.insert(demoAvailability).values({
    id: newId(),
    weekday,
    startMinute: start,
    endMinute: end,
    slotMinutes: slot,
    createdBy: actorId,
  });
  return { ok: true, summary: "Window published." };
}

/**
 * Retiring a window does NOT touch bookings already made inside it. Somebody
 * who has a time agreed keeps it; the window only governs what is offered
 * next, and cancelling a booked call is a separate, deliberate act.
 */
export async function removeAvailabilityWindow(windowId: string): Promise<AnswerResult> {
  const removed = await db
    .delete(demoAvailability)
    .where(eq(demoAvailability.id, windowId))
    .returning({ id: demoAvailability.id });
  return removed.length === 0
    ? { ok: false, error: "That window is already gone." }
    : { ok: true, summary: "Window retired. Existing bookings are untouched." };
}

export async function addBlackout(
  day: string,
  reason: string,
  actorId: string,
): Promise<AnswerResult> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    return { ok: false, error: "Pick a date." };
  }
  try {
    await db.insert(demoBlackouts).values({
      id: newId(),
      blackoutOn: day,
      reason: reason.trim() === "" ? null : reason.trim().slice(0, 200),
      createdBy: actorId,
    });
  } catch {
    // The unique index on the day. Already blacked out is the outcome asked
    // for, so it is not an error.
    return { ok: true, summary: `${day} was already blocked.` };
  }
  return { ok: true, summary: `${day} blocked. Nothing will be offered that day.` };
}

export async function removeBlackout(blackoutId: string): Promise<AnswerResult> {
  const removed = await db
    .delete(demoBlackouts)
    .where(eq(demoBlackouts.id, blackoutId))
    .returning({ id: demoBlackouts.id });
  return removed.length === 0
    ? { ok: false, error: "That block is already gone." }
    : { ok: true, summary: "Unblocked." };
}
