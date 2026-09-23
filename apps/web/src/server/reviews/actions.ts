"use server";

import { db } from "../db";
import { logger } from "../logger";
import { sendReviewArrived } from "./review-mail";
import { reviewPageState, submitReview, validateReview, type ReviewField } from "./reviews";

/**
 * WRITING A REVIEW (FR-1 Phase 2) — the one public action behind a review link.
 *
 * The token is the only authority, and it is re-checked here rather than
 * trusted from the render: the link may have expired, or an operator may have
 * published the review, since the form loaded. Nothing about WHO is taken from
 * the form — the person is whoever the token's request names.
 */

export interface ReviewFormValues {
  readonly rating: number | null;
  readonly wentWell: string;
  readonly improve: string;
  readonly mayQuote: boolean;
  readonly displayName: string;
  readonly displayOrg: string;
}

export interface ReviewFormState {
  readonly error?: string;
  readonly field?: ReviewField;
  readonly saved?: boolean;
  readonly firstTime?: boolean;
  readonly closed?: boolean;
  /**
   * What was sent, echoed back. React resets a form's uncontrolled fields once
   * its action settles, so without this the page thanked the person for their
   * review and showed them an empty form — measured in the browser, and a
   * "Save changes" from that state would have been a rating-less submit.
   */
  readonly values?: ReviewFormValues;
  /** Changes on every settle, so the form remounts with `values` as defaults. */
  readonly version?: number;
}

function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

export async function submitReviewAction(
  _previous: ReviewFormState,
  formData: FormData,
): Promise<ReviewFormState> {
  const token = field(formData, "token");
  const rating = Number(field(formData, "rating"));
  const values: ReviewFormValues = {
    rating: Number.isInteger(rating) && rating >= 1 && rating <= 5 ? rating : null,
    wentWell: field(formData, "wentWell").slice(0, 2000),
    improve: field(formData, "improve").slice(0, 2000),
    mayQuote: field(formData, "mayQuote") === "yes",
    displayName: field(formData, "displayName").slice(0, 80),
    displayOrg: field(formData, "displayOrg").slice(0, 120),
  };
  const version = Date.now();
  const validated = validateReview({
    rating: field(formData, "rating"),
    wentWell: field(formData, "wentWell"),
    improve: field(formData, "improve"),
    mayQuote: field(formData, "mayQuote") === "yes",
    displayName: field(formData, "displayName"),
    displayOrg: field(formData, "displayOrg"),
  });
  if (!validated.ok) {
    return { error: validated.message, field: validated.field, values, version };
  }

  const result = await submitReview(db, token, validated.value);
  if (!result.ok) {
    return result.reason === "closed"
      ? { closed: true }
      : {
          error: "This link has expired. Ask us for a new one at support@desiauction.in.",
          values,
          version,
        };
  }

  // Operators hear about a new review, not about every edit of one.
  if (result.firstTime) {
    const state = await reviewPageState(db, token);
    const name = state.kind === "open" ? state.personName : null;
    const outcome = await sendReviewArrived(db, validated.value, name);
    if (outcome === "failed") {
      logger().error({ reviewId: result.reviewId }, "reviews.arrived_mail_failed");
    }
  }
  return { saved: true, firstTime: result.firstTime, values, version };
}
