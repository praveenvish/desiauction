"use server";

import { revalidatePath } from "next/cache";

import { askByContact, dismissReports, moderate, type AskOutcome } from "../reviews/desk";
import type { ModerationResult } from "../reviews/reviews";
import { platformSupportGate } from "./authz";

/**
 * THE REVIEW DESK'S ACTIONS — gate, delegate, revalidate (FR-1 Phase 2).
 *
 * Same shape as `report-actions.ts`: the verbs live in `server/reviews`, so the
 * source scan over administration keeps holding. Arguments arrive over the wire
 * and are validated by the domain.
 */

export async function askForReviewAction(query: string): Promise<AskOutcome> {
  const operator = await platformSupportGate();
  if (operator === null) {
    return { ok: false, error: "Not available." };
  }
  // Typed at the call site, untyped on the wire: a non-string is a refusal, not a 500.
  if (typeof query !== "string") {
    return { ok: false, error: "Enter an email or mobile number." };
  }
  const result = await askByContact(query.slice(0, 200), operator.personId);
  if (result.ok) {
    revalidatePath("/admin/reviews");
  }
  return result;
}

export async function moderateReviewAction(
  reviewId: string,
  status: string,
): Promise<ModerationResult> {
  const operator = await platformSupportGate();
  if (operator === null) {
    return { ok: false, error: "Not available." };
  }
  if (typeof reviewId !== "string" || typeof status !== "string") {
    return { ok: false, error: "That isn't a status we record." };
  }
  const result = await moderate(reviewId, status, operator.personId);
  if (result.ok) {
    revalidatePath("/admin/reviews");
    // A platform review may be quoted on the landing page; publish or hide,
    // the home page must not keep serving yesterday's answer.
    revalidatePath("/");
  }
  return result;
}

export async function dismissReportsAction(reviewId: string): Promise<ModerationResult> {
  const operator = await platformSupportGate();
  if (operator === null) {
    return { ok: false, error: "Not available." };
  }
  if (typeof reviewId !== "string") {
    return { ok: false, error: "There are no open reports on that review." };
  }
  const result = await dismissReports(reviewId, operator.personId);
  if (result.ok) {
    revalidatePath("/admin/reviews");
  }
  return result;
}
