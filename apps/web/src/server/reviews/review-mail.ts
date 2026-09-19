import { env } from "../../env";
import { SUPPORT_EMAIL, renderEmail } from "../messaging/email-layout";
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

/**
 * Who the ask is addressed to, so the first line is true. An owner bid in an
 * auction; they did not "run a tournament", and a mail that says they did reads
 * as a mail sent to the wrong person.
 */
export type AskAudience = "organizer" | "owner" | "general";

const OPENING: Record<AskAudience, readonly string[]> = {
  organizer: [
    "You've run a tournament on DesiAuction, and we'd like to know how it went — what",
    "worked, and what got in your way. It takes two minutes:",
  ],
  owner: [
    "You bid for a team in an auction on DesiAuction, and we'd like to know how it went",
    "from your side of the room — what worked, and what got in your way. Two minutes:",
  ],
  general: [
    "You've used DesiAuction, and we'd like to know how it went — what worked, and what",
    "got in your way. It takes two minutes:",
  ],
};

export function reviewAskMail(
  name: string | null,
  link: string,
  audience: AskAudience = "general",
): { subject: string; text: string; html: string } {
  const days = Math.round(REVIEW_LINK_TTL_MS / 86_400_000);
  return {
    subject: "How has DesiAuction worked for you?",
    ...renderEmail({
      preheader: "Two minutes on what worked and what got in your way.",
      heading: "How has DesiAuction worked for you?",
      paragraphs: [name === null ? "Hi," : `Hi ${name},`, OPENING[audience].join(" ")],
      action: { label: "Write your review", url: link },
      actionFirst: true,
      after: [
        `The link is yours and works for ${String(days)} days. Nothing you write is shown to anyone unless you tick the box that says we may quote it.`,
        `Don't want to be asked? Switch off "Feedback requests" in your account settings: ${env.PUBLIC_BASE_URL}/account`,
      ],
      footnote: "You received this because you used DesiAuction recently.",
    }),
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

/**
 * The ask about ONE season (Phase 4). Different from the platform ask in the
 * one way that matters: what they write may be shown on the season's public
 * page, so the mail says so before they click — nobody should learn that from
 * the form.
 */
export function seasonAskMail(input: {
  name: string | null;
  seasonName: string;
  orgName: string;
  role: "player" | "owner";
  link: string;
}): { subject: string; text: string; html: string } {
  const days = Math.round(REVIEW_LINK_TTL_MS / 86_400_000);
  // Season and club names are organizer-typed; keep the subject to one line.
  const season = input.seasonName.replace(/[\r\n]+/g, " ").slice(0, 80);
  return {
    subject: `How was ${season}?`,
    ...renderEmail({
      preheader: `Two minutes on ${season} — for the players and owners deciding on next season.`,
      heading: `How was ${season}?`,
      paragraphs: [
        input.name === null ? "Hi," : `Hi ${input.name},`,
        input.role === "owner"
          ? `You bid for a team in ${season}, run by ${input.orgName}. How did it go? Other players and owners deciding whether to join next time would like to know.`
          : `You played in ${season}, run by ${input.orgName}. How did it go? Other players and owners deciding whether to join next time would like to know.`,
      ],
      action: { label: "Review the season", url: input.link },
      actionFirst: true,
      after: [
        `Once our team has read it, your review may appear on the season's public page. It carries your name only if you tick the box that says so; otherwise it says ${input.role === "owner" ? '"A team owner"' : '"A player"'}.`,
        `The link is yours and works for ${String(days)} days. Don't want to be asked? Switch off "Feedback requests" at ${env.PUBLIC_BASE_URL}/account`,
      ],
      footnote: `You received this because you took part in ${season} on DesiAuction.`,
    }),
  };
}
