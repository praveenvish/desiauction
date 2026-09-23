import { db, systemDb } from "../db";
import { languageForMail, sendNotificationMail } from "../messaging/notify";
import type { MailOutcome } from "../messaging/transactional-mail";
import { resolveReports } from "./season";
import { reviewAskMail } from "./review-mail";
import {
  askForPlatformReview,
  findPersonByContact,
  isKnownMinor,
  markAskSent,
  moderateReview,
  type ModerationResult,
} from "./reviews";

/**
 * THE REVIEW DESK'S WRITES (FR-1 Phase 2) — outside administration, like
 * `support/report-desk.ts`, so the read-only proofs over `server/admin` hold.
 *
 * Asking is three decisions in order, and each can stop it:
 *
 *   1 · Is there such a person, and are they not a known minor?
 *   2 · Record the ask (or re-issue the one they have) — always, so the
 *       operator has a link to share by hand even when mail cannot go.
 *   3 · Mail it, only if they have an address AND the consent gate allows it.
 */

export type AskOutcome =
  | {
      readonly ok: true;
      readonly link: string;
      readonly personName: string | null;
      readonly created: boolean;
      readonly alreadyReviewed: boolean;
      /** What happened to the mail, in words the desk can show as-is. */
      readonly delivery:
        | "sent"
        | "no-address"
        | "opted-out"
        | "mail-unconfigured"
        | "mail-failed"
        | "skipped-already-reviewed";
    }
  | { readonly ok: false; readonly error: string };

function deliveryFor(outcome: MailOutcome): "sent" | "mail-unconfigured" | "mail-failed" {
  if (outcome === "sent") {
    return "sent";
  }
  return outcome === "unconfigured" ? "mail-unconfigured" : "mail-failed";
}

export async function askByContact(
  query: string,
  operatorId: string,
  now: Date = new Date(),
): Promise<AskOutcome> {
  // The system pool: the date-of-birth fallback reads tenant registrations.
  const person = await findPersonByContact(systemDb, query);
  if (person === null) {
    return { ok: false, error: "Nobody has signed in with that email or number." };
  }
  if (isKnownMinor(person, now)) {
    return { ok: false, error: "That person is under 18 — we don't ask minors for reviews." };
  }

  const ask = await askForPlatformReview(db, {
    personId: person.id,
    source: "manual_admin",
    requestedBy: operatorId,
    now,
  });
  const base = {
    ok: true as const,
    link: ask.link,
    personName: person.name,
    created: ask.created,
    alreadyReviewed: ask.alreadyReviewed,
  };

  if (ask.alreadyReviewed) {
    return { ...base, delivery: "skipped-already-reviewed" };
  }
  if (person.email === null) {
    return { ...base, delivery: "no-address" };
  }
  const { outcome } = await sendNotificationMail(
    db,
    { kind: "review.platform_ask", to: person.email, personId: person.id, now },
    await reviewAskMail(
      person.name,
      ask.link,
      "general",
      await languageForMail(db, { personId: person.id }),
    ),
  );
  if (outcome === "suppressed") {
    return { ...base, delivery: "opted-out" };
  }
  if (outcome === "sent") {
    await markAskSent(db, ask.requestId, person.email, now);
  }
  return { ...base, delivery: deliveryFor(outcome) };
}

/**
 * Publish or hide. Hiding also answers any open reports on the review — the
 * answer to "this should not be up" is that it is not up any more.
 */
export async function moderate(
  reviewId: string,
  status: string,
  operatorId: string,
): Promise<ModerationResult> {
  const result = await moderateReview(db, reviewId, status, operatorId);
  if (result.ok && status === "hidden") {
    await resolveReports(reviewId, operatorId);
  }
  return result;
}

/** Keep the review up and close its reports: somebody objected, we read it, it stays. */
export async function dismissReports(
  reviewId: string,
  operatorId: string,
): Promise<ModerationResult> {
  const count = await resolveReports(reviewId, operatorId);
  return count === 0
    ? { ok: false, error: "There are no open reports on that review." }
    : {
        ok: true,
        summary: count === 1 ? "Report dismissed." : `${String(count)} reports dismissed.`,
      };
}
