import type { Db } from "@desiauction/db";
import type { MessageLanguage } from "@desiauction/messaging/email-templates";

import { env } from "../../env";
import { SUPPORT_EMAIL } from "../messaging/email-layout";
import { sendNotificationMail, type GatedMailOutcome } from "../messaging/notify";
import { renderNotificationEmail, type NotificationMail } from "../messaging/notification-email";
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

/** The link, the ask's shared variables, and the account page they can stop it from. */
function askVariables(name: string | null) {
  return {
    name: name ?? "",
    ifNoName: name === null,
    days: String(Math.round(REVIEW_LINK_TTL_MS / 86_400_000)),
    accountUrl: `${env.PUBLIC_BASE_URL}/account`,
  };
}

/**
 * The words — one variant per audience, so the first line is true — are the
 * template registry's (`review.platform_ask`); the link is ours.
 */
export function reviewAskMail(
  name: string | null,
  link: string,
  audience: AskAudience = "general",
  language: MessageLanguage = "en",
): Promise<NotificationMail> {
  return renderNotificationEmail("review.platform_ask", language, askVariables(name), {
    variant: audience,
    action: { id: "review", url: link },
  });
}

export function reviewArrivedMail(
  review: ValidReview,
  personName: string | null,
): Promise<NotificationMail> {
  return renderNotificationEmail("staff.review_arrived", "en", {
    rating: String(review.rating),
    personName: personName ?? "a customer",
    personLine: personName ?? "name not on file",
    quoteLine: review.mayQuote
      ? `May quote, signed: ${review.displayName ?? ""}${review.displayOrg === null ? "" : `, ${review.displayOrg}`}`
      : "Not for quoting.",
    wentWell: review.wentWell ?? "(nothing written)",
    improve: review.improve ?? "(nothing written)",
    deskUrl: `${env.PUBLIC_BASE_URL}/admin/reviews`,
  });
}

export async function sendReviewArrived(
  db: Db,
  review: ValidReview,
  personName: string | null,
): Promise<GatedMailOutcome> {
  const { outcome } = await sendNotificationMail(
    db,
    { kind: "staff.review_arrived", to: SUPPORT_EMAIL },
    await reviewArrivedMail(review, personName),
  );
  return outcome;
}

/**
 * The ask about ONE season (Phase 4). Different from the platform ask in the
 * one way that matters: what they write may be shown on the season's public
 * page, so the mail says so before they click — nobody should learn that from
 * the form.
 */
export function seasonAskMail(
  input: {
    name: string | null;
    seasonName: string;
    orgName: string;
    role: "player" | "owner";
    link: string;
  },
  language: MessageLanguage = "en",
): Promise<NotificationMail> {
  // Season and club names are organizer-typed; keep the subject to one line.
  const season = input.seasonName.replace(/[\r\n]+/g, " ").slice(0, 80);
  return renderNotificationEmail(
    "review.season_ask",
    language,
    { ...askVariables(input.name), season, orgName: input.orgName },
    { variant: input.role, action: { id: "review", url: input.link } },
  );
}
