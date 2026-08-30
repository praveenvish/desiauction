import { env } from "../../env";
import { transactionalMailer, type MailOutcome } from "../messaging/transactional-mail";
import type { ValidDemoRequest } from "./demo-requests";

/**
 * WHAT WE SAY BACK.
 *
 * Two messages, and they are different messages on purpose. The requester gets
 * a receipt — what they asked for, what happens next, by when, and how to stop
 * waiting if they would rather just start. The founder gets the lead, with the
 * columns that decide whether to ring first or mail first at the top.
 *
 * NEITHER GOES THROUGH THE CONSENT GATE, and that is correct rather than
 * convenient. `server/messaging/consent.ts` guards MARKETING to a contact we
 * hold a record for. This is a transactional reply to an address a stranger
 * typed into a form thirty seconds ago that says we will use it — the same
 * category as a sign-in code, which is exempt for the same reason. Nothing
 * here may ever be reused to send anything they did not ask for; the day a
 * demo lead gets a newsletter, it goes through the gate like everything else.
 *
 * SMS IS DELIBERATELY ABSENT. A stranger has no consent record, no notification
 * preferences and no suppression history, so the gate would refuse — correctly.
 * Phase 2's reminders may text, because booking is where consent is captured.
 */

const SUPPORT_EMAIL = "support@desiauction.in";

const SIZE_WORDS: Record<string, string> = {
  "under-8": "under 8 teams",
  "8-16": "8–16 teams",
  "16-32": "16–32 teams",
  "over-32": "over 32 teams",
  unsure: "not sure yet",
};

const WINDOW_WORDS: Record<string, string> = {
  "weekday-evening": "weekday evenings",
  "weekend-morning": "weekend mornings",
  "weekend-evening": "weekend evenings",
  any: "any time",
};

export function requesterAcknowledgement(request: ValidDemoRequest): {
  subject: string;
  text: string;
} {
  return {
    subject: "We've got your demo request — DesiAuction",
    text: [
      `Hi ${request.name},`,
      "",
      `Thanks for asking about a demo for ${request.orgName}. We have your request and`,
      "we'll get back to you within one working day to fix a time.",
      "",
      "What you told us:",
      `  Tournament: ${request.orgName} (${SIZE_WORDS[request.tournamentSize] ?? request.tournamentSize})`,
      request.auctionOn === null
        ? "  Auction date: not fixed yet"
        : `  Auction date: ${request.auctionOn}`,
      `  Best time to talk: ${WINDOW_WORDS[request.preferredWindow] ?? request.preferredWindow}`,
      "",
      "The demo is a live walkthrough of a real auction — squads, the bidding, the",
      "gavel, and the money afterwards — on a tournament we've already run, so you",
      "can see the whole night rather than an empty screen.",
      "",
      "In a hurry? You don't have to wait for us. Every tournament gets the full",
      `platform free during beta: ${env.PUBLIC_BASE_URL}/login`,
      "",
      `Reply to this message or write to ${SUPPORT_EMAIL} if anything changes.`,
      "",
      "— DesiAuction",
    ].join("\n"),
  };
}

export function founderNotification(
  request: ValidDemoRequest,
  requestId: string,
): { subject: string; text: string } {
  return {
    subject: `Demo request — ${request.orgName} (${SIZE_WORDS[request.tournamentSize] ?? request.tournamentSize})`,
    text: [
      `${request.name} · ${request.phone}${request.email === null ? "" : ` · ${request.email}`}`,
      `${request.orgName} — ${SIZE_WORDS[request.tournamentSize] ?? request.tournamentSize}`,
      request.auctionOn === null ? "Auction: no date yet" : `Auction: ${request.auctionOn}`,
      `Prefers: ${WINDOW_WORDS[request.preferredWindow] ?? request.preferredWindow}`,
      `Came from: ${request.source}`,
      "",
      request.note === null ? "(no note)" : request.note,
      "",
      `${env.PUBLIC_BASE_URL}/admin/demos#${requestId}`,
    ].join("\n"),
  };
}

/**
 * Fire both, never throw, and hand back what happened so the caller can log it.
 *
 * The requester's copy is skipped when they gave no address — which is a normal
 * outcome, not a failure. The founder's copy goes to the support address, which
 * is the one printed on every public page.
 */
export async function sendDemoRequestMail(
  request: ValidDemoRequest,
  requestId: string,
): Promise<{ requester: MailOutcome | "no-address"; founder: MailOutcome }> {
  const mailer = transactionalMailer();

  const requesterOutcome: MailOutcome | "no-address" =
    request.email === null
      ? "no-address"
      : await mailer.send({ to: request.email, ...requesterAcknowledgement(request) });

  const founderOutcome = await mailer.send({
    to: SUPPORT_EMAIL,
    ...founderNotification(request, requestId),
  });

  return { requester: requesterOutcome, founder: founderOutcome };
}
