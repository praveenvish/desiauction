import { env } from "../../env";
import { transactionalMailer, type MailOutcome } from "../messaging/transactional-mail";
import { buildInvite, inviteUid } from "./demo-ics";
import { IST_OFFSET_MINUTES, dayLabel, istDayKey, timeLabel } from "./demo-slots";

/**
 * WHAT WE SEND WHEN A TIME IS AGREED.
 *
 * The mail carries the invite as an attachment AND the booking page as a link,
 * which is belt and braces on purpose: attachment support is the one place
 * every mail provider's API shape diverges, and the download at
 * `/demo/{token}/invite.ics` works whatever the provider does with the file.
 * A person who can see the time but cannot get it into their calendar is a
 * person who will miss the call.
 *
 * Transactional, so no consent gate — see `demo-mail.ts` for that argument in
 * full. The 24-hour and 1-hour reminders are a different matter and go through
 * the gate, because by then we are the ones starting the conversation.
 */

const SUPPORT_EMAIL = "support@desiauction.in";
const MINUTE_MS = 60 * 1000;

/** "Tue 9 Sep, 7:00 pm IST" — one string, one timezone, said out loud. */
export function whenWords(at: Date): string {
  const dayKey = istDayKey(at);
  const minutes =
    (at.getTime() + IST_OFFSET_MINUTES * MINUTE_MS - Date.parse(`${dayKey}T00:00:00Z`)) / MINUTE_MS;
  return `${dayLabel(dayKey)}, ${timeLabel(Math.round(minutes))} IST`;
}

export interface BookingMailInput {
  readonly to: string;
  readonly name: string;
  readonly orgName: string;
  readonly requestId: string;
  readonly token: string;
  readonly slotStart: Date;
  readonly slotEnd: Date;
  /** Incremented per reschedule so calendars replace rather than duplicate. */
  readonly sequence: number;
}

function bookingUrl(token: string): string {
  return `${env.PUBLIC_BASE_URL}/demo/${token}`;
}

export async function sendBookingConfirmation(input: BookingMailInput): Promise<MailOutcome> {
  const when = whenWords(input.slotStart);
  const url = bookingUrl(input.token);
  const ics = buildInvite({
    uid: inviteUid(input.requestId),
    start: input.slotStart,
    end: input.slotEnd,
    summary: `DesiAuction demo — ${input.orgName}`,
    description: `A live walkthrough of a real auction. Manage this booking: ${url}`,
    url,
    organizerEmail: SUPPORT_EMAIL,
    sequence: input.sequence,
  });

  return transactionalMailer().send({
    to: input.to,
    subject: `Your DesiAuction demo — ${when}`,
    text: [
      `Hi ${input.name},`,
      "",
      `You're booked in for ${when}.`,
      "",
      "We'll call the number you gave us. Twenty minutes, walking through a real",
      "auction end to end — squads and purses, the bidding, the gavel, and the",
      "settlement afterwards.",
      "",
      `Need to move it or call it off: ${url}`,
      "",
      "The calendar invite is attached.",
      "",
      "— DesiAuction",
    ].join("\n"),
    attachment: {
      filename: "desiauction-demo.ics",
      contentType: "text/calendar",
      contentBase64: Buffer.from(ics, "utf8").toString("base64"),
    },
  });
}

export async function sendBookingCancellation(input: BookingMailInput): Promise<MailOutcome> {
  const when = whenWords(input.slotStart);
  const ics = buildInvite({
    uid: inviteUid(input.requestId),
    start: input.slotStart,
    end: input.slotEnd,
    summary: `DesiAuction demo — ${input.orgName}`,
    description: "Cancelled.",
    url: bookingUrl(input.token),
    organizerEmail: SUPPORT_EMAIL,
    sequence: input.sequence,
    cancelled: true,
  });

  return transactionalMailer().send({
    to: input.to,
    subject: `Cancelled: your DesiAuction demo — ${when}`,
    text: [
      `Hi ${input.name},`,
      "",
      `The demo on ${when} is cancelled and nobody will call.`,
      "",
      `Want another time? ${env.PUBLIC_BASE_URL}/schedule-demo`,
      "",
      "— DesiAuction",
    ].join("\n"),
    attachment: {
      filename: "desiauction-demo.ics",
      contentType: "text/calendar",
      contentBase64: Buffer.from(ics, "utf8").toString("base64"),
    },
  });
}

/**
 * The reminder. Deliberately short — it is read on a phone, probably while
 * doing something else, and its only job is to put a time and a way out in
 * front of somebody.
 */
export async function sendBookingReminder(
  input: BookingMailInput,
  hoursAhead: 24 | 1,
): Promise<MailOutcome> {
  const when = whenWords(input.slotStart);
  return transactionalMailer().send({
    to: input.to,
    subject:
      hoursAhead === 24
        ? `Tomorrow: your DesiAuction demo — ${when}`
        : `In an hour: your DesiAuction demo`,
    text: [
      `Hi ${input.name},`,
      "",
      hoursAhead === 24
        ? `A reminder that we're speaking ${when}. We'll call the number you gave us.`
        : `We're calling in about an hour, at ${when}.`,
      "",
      `Can't make it? ${bookingUrl(input.token)}`,
      "",
      "— DesiAuction",
    ].join("\n"),
  });
}
