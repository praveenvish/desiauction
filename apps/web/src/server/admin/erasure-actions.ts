"use server";

import { revalidatePath } from "next/cache";

import { declineForRequest, eraseForRequest, type DeskResult } from "../privacy/desk";
import { platformPrivacyGate } from "./authz";

/**
 * THE PRIVACY DESK'S ACTIONS — gate, delegate, revalidate; the same shape as
 * `demo-actions.ts`. The acts themselves live in `server/privacy`, outside
 * administration, so the source-level proof that administration holds no write
 * keeps holding over this file.
 *
 * Arguments arrive over the wire and are re-checked here: an erasure needs the
 * operator to have typed the exact confirmation, server-side, not only in the
 * dialog.
 */

/** What the operator must type. Short, unambiguous, impossible to hit by habit. */
const CONFIRMATION = "ERASE";

export async function eraseAccountAction(
  requestId: string,
  confirmation: string,
  note: string,
): Promise<DeskResult> {
  const operator = await platformPrivacyGate();
  if (operator === null) {
    return { ok: false, error: "Not available." };
  }
  if (confirmation.trim() !== CONFIRMATION) {
    return { ok: false, error: `Type ${CONFIRMATION} to confirm. This cannot be undone.` };
  }
  const trimmed = note.trim();
  const result = await eraseForRequest(
    operator.personId,
    requestId,
    trimmed === "" ? null : trimmed,
  );
  if (result.ok) {
    revalidatePath("/admin/erasure");
  }
  return result;
}

export async function declineErasureAction(requestId: string, note: string): Promise<DeskResult> {
  const operator = await platformPrivacyGate();
  if (operator === null) {
    return { ok: false, error: "Not available." };
  }
  const result = await declineForRequest(operator.personId, requestId, note);
  if (result.ok) {
    revalidatePath("/admin/erasure");
  }
  return result;
}
