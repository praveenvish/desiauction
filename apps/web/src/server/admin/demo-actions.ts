"use server";

import { revalidatePath } from "next/cache";

import {
  answerDemoRequest,
  cancelDemoAsOrganizer,
  type AnswerResult,
} from "../marketing/demo-desk";
import {
  addAvailabilityWindow,
  addBlackout,
  removeAvailabilityWindow,
  removeBlackout,
} from "../marketing/demo-availability";
import { platformDemoGate } from "./authz";

/**
 * THE DEMO DESK'S ACTIONS — the same shape `pass-actions.ts` established.
 *
 * Every verb here is somebody else's function. Nothing under `server/admin` or
 * `app/admin` may contain a mutation verb except the access log, and that is
 * asserted by a SOURCE SCAN over these very files — it greps the text rather
 * than the semantics, deliberately, because a runtime proof only sees the paths
 * it happens to drive. So this module gates, delegates and revalidates, and
 * names no mutation verb at all — not even inside a comment, which is how this
 * paragraph came to be written the long way round.
 *
 * Arguments are typed at the call site and NOT trusted here: a server action's
 * arguments arrive over the wire, so everything is widened to `string` and
 * validated by the domain. An unrecognised value must come back as a refusal
 * the surface can render, never a constraint violation surfacing as a 500.
 */

export async function answerDemoRequestAction(
  requestId: string,
  outcome: string,
): Promise<AnswerResult> {
  const operator = await platformDemoGate();
  if (operator === null) {
    // The same silence as the rest of the console.
    return { ok: false, error: "Not available." };
  }
  const result = await answerDemoRequest(requestId, outcome, operator.personId);
  if (result.ok) {
    revalidatePath("/admin/demos");
  }
  return result;
}

export async function cancelDemoAction(requestId: string): Promise<AnswerResult> {
  const operator = await platformDemoGate();
  if (operator === null) {
    return { ok: false, error: "Not available." };
  }
  const result = await cancelDemoAsOrganizer(requestId);
  if (result.ok) {
    revalidatePath("/admin/demos");
  }
  return result;
}

export async function addAvailabilityAction(
  weekday: string,
  startMinute: string,
  endMinute: string,
  slotMinutes: string,
): Promise<AnswerResult> {
  const operator = await platformDemoGate();
  if (operator === null) {
    return { ok: false, error: "Not available." };
  }
  const result = await addAvailabilityWindow(
    { weekday, startMinute, endMinute, slotMinutes },
    operator.personId,
  );
  if (result.ok) {
    revalidatePath("/admin/demos/availability");
    revalidatePath("/schedule-demo");
  }
  return result;
}

export async function removeAvailabilityAction(windowId: string): Promise<AnswerResult> {
  const operator = await platformDemoGate();
  if (operator === null) {
    return { ok: false, error: "Not available." };
  }
  const result = await removeAvailabilityWindow(windowId);
  if (result.ok) {
    revalidatePath("/admin/demos/availability");
    revalidatePath("/schedule-demo");
  }
  return result;
}

export async function addBlackoutAction(day: string, reason: string): Promise<AnswerResult> {
  const operator = await platformDemoGate();
  if (operator === null) {
    return { ok: false, error: "Not available." };
  }
  const result = await addBlackout(day, reason, operator.personId);
  if (result.ok) {
    revalidatePath("/admin/demos/availability");
  }
  return result;
}

export async function removeBlackoutAction(blackoutId: string): Promise<AnswerResult> {
  const operator = await platformDemoGate();
  if (operator === null) {
    return { ok: false, error: "Not available." };
  }
  const result = await removeBlackout(blackoutId);
  if (result.ok) {
    revalidatePath("/admin/demos/availability");
  }
  return result;
}
