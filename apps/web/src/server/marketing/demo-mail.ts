import type { Db } from "@desiauction/db";

import { env } from "../../env";
import { SUPPORT_EMAIL } from "../messaging/email-layout";
import { sendNotificationMail, type GatedMailOutcome } from "../messaging/notify";
import { renderNotificationEmail, type NotificationMail } from "../messaging/notification-email";
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

/**
 * NOTHING THE STRANGER TYPED GOES BACK OUT (gate P2).
 *
 * This mail goes to an address nobody has verified, typed by somebody with no
 * session, from our domain. It used to open "Hi {name}" and repeat the
 * organisation name — two free-text fields — so the form was a way to have
 * DesiAuction deliver any sentence you liked ("Hi Your account is locked,
 * visit …") to any inbox you liked, under our reputation. So the receipt
 * carries only what the form offered as CHOICES (a size band, a date, a time
 * window) and greets generically. The founder's copy below still has
 * everything; it goes to our own address.
 */
export function requesterAcknowledgement(request: ValidDemoRequest): Promise<NotificationMail> {
  // A stranger has no account and so no language: English, always. Only the
  // form's CHOICES go into the table, never a word they typed.
  return renderNotificationEmail(
    "demo.request_received",
    "en",
    {},
    {
      details: [
        ["Tournament size", SIZE_WORDS[request.tournamentSize] ?? "not sure yet"],
        ["Auction date", request.auctionOn ?? "not fixed yet"],
        ["Best time to talk", WINDOW_WORDS[request.preferredWindow] ?? "any time"],
      ],
      action: { id: "start", url: `${env.PUBLIC_BASE_URL}/login` },
    },
  );
}

/** Our own copy: everything they sent, to the support mailbox (plain text, English). */
export function founderNotification(
  request: ValidDemoRequest,
  requestId: string,
): Promise<NotificationMail> {
  const size = SIZE_WORDS[request.tournamentSize] ?? request.tournamentSize;
  return renderNotificationEmail("staff.demo_request", "en", {
    name: request.name,
    phone: request.phone,
    emailClause: request.email === null ? "" : ` · ${request.email}`,
    orgName: request.orgName,
    size,
    auctionLine:
      request.auctionOn === null ? "Auction: no date yet" : `Auction: ${request.auctionOn}`,
    window: WINDOW_WORDS[request.preferredWindow] ?? request.preferredWindow,
    source: request.source,
    note: request.note === null ? "(no note)" : request.note,
    deskUrl: `${env.PUBLIC_BASE_URL}/admin/demos#${requestId}`,
  });
}

/**
 * Fire both, never throw, and hand back what happened so the caller can log it.
 *
 * The requester's copy is skipped when they gave no address — which is a normal
 * outcome, not a failure. The founder's copy goes to the support address, which
 * is the one printed on every public page.
 */
export async function sendDemoRequestMail(
  db: Db,
  request: ValidDemoRequest,
  requestId: string,
  options: {
    /**
     * False when the platform-wide hourly cap on acknowledgements is spent
     * (`acknowledgementsSpent`). The lead is still recorded and the founder
     * still told — only the mail to the unverified address is withheld.
     */
    acknowledge?: boolean;
  } = {},
): Promise<{
  requester: GatedMailOutcome | "no-address" | "capped";
  founder: GatedMailOutcome;
}> {
  // Through the gate: a requester whose address bounced or complained (the
  // suppression list) is not mailed again, and there is no switch of theirs
  // to read — they are a stranger with no account (catalogue `demo.*`).
  const requesterOutcome: GatedMailOutcome | "no-address" | "capped" =
    request.email === null
      ? "no-address"
      : options.acknowledge === false
        ? "capped"
        : (
            await sendNotificationMail(
              db,
              { kind: "demo.request_received", to: request.email },
              await requesterAcknowledgement(request),
            )
          ).outcome;

  const { outcome: founderOutcome } = await sendNotificationMail(
    db,
    { kind: "staff.demo_request", to: SUPPORT_EMAIL },
    await founderNotification(request, requestId),
  );

  return { requester: requesterOutcome, founder: founderOutcome };
}
