import { env } from "../../env";
import { transactionalMailer, type MailOutcome } from "../messaging/transactional-mail";
import { REVIEW_LINK_TTL_MS, type ValidReview } from "./reviews";

/**
 * WHAT WE SAY WHEN WE ASK, AND WHO HEARS WHEN SOMEBODY ANSWERS (FR-1 Phase 2).
 *
 * The ask is short, says who is asking and why, names how long the link lasts,
 * and says where to switch these off. It does not flatter, does not offer an
 * incentive, and does not suggest a rating — a review we nudged is a review we
 * cannot quote honestly.
 *
 * It goes through the consent gate (see `desk.ts`) under the `feedback` topic,
 * which is on /account, so "stop asking me" is one switch.
 */

const SUPPORT_EMAIL = "support@desiauction.in";

export function reviewAskMail(
  name: string | null,
  link: string,
): { subject: string; text: string } {
  const days = Math.round(REVIEW_LINK_TTL_MS / 86_400_000);
  return {
    subject: "How has DesiAuction worked for you?",
    text: [
      name === null ? "Hi," : `Hi ${name},`,
      "",
      "You've run a tournament on DesiAuction, and we'd like to know how it went — what",
      "worked, and what got in your way. It takes two minutes:",
      "",
      `  ${link}`,
      "",
      `The link is yours and works for ${String(days)} days. Nothing you write is shown to`,
      "anyone unless you tick the box that says we may quote it.",
      "",
      `Don't want to be asked? Switch off "Feedback requests" in your account settings:`,
      `${env.PUBLIC_BASE_URL}/account`,
      "",
      `Questions: ${SUPPORT_EMAIL}`,
      "",
      "— DesiAuction",
    ].join("\n"),
  };
}

export function reviewArrivedMail(
  review: ValidReview,
  personName: string | null,
): { subject: string; text: string } {
  return {
    subject: `[Review] ${String(review.rating)}/5 from ${personName ?? "a customer"}`,
    text: [
      `${String(review.rating)}/5 — ${personName ?? "name not on file"}`,
      review.mayQuote
        ? `May quote, signed: ${review.displayName ?? ""}${review.displayOrg === null ? "" : `, ${review.displayOrg}`}`
        : "Not for quoting.",
      "",
      "What went well:",
      review.wentWell ?? "(nothing written)",
      "",
      "What to improve:",
      review.improve ?? "(nothing written)",
      "",
      `${env.PUBLIC_BASE_URL}/admin/reviews`,
    ].join("\n"),
  };
}

export async function sendReviewArrived(
  review: ValidReview,
  personName: string | null,
): Promise<MailOutcome> {
  return transactionalMailer().send({
    to: SUPPORT_EMAIL,
    ...reviewArrivedMail(review, personName),
  });
}
