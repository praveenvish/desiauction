import type { Db } from "@desiauction/db";

import { env } from "../../env";
import { SUPPORT_EMAIL, renderEmail } from "../messaging/email-layout";
import { sendNotificationMail, type GatedMailOutcome } from "../messaging/notify";
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

const MINUTE_MS = 60 * 1000;

/** "Tue 9 Sep, 7:00 pm IST" — one string, one timezone, said out loud. */
export function whenWords(at: Date): string {
  const dayKey = istDayKey(at);
  const minutes =
    (at.getTime() + IST_OFFSET_MINUTES * MINUTE_MS - Date.parse(`${dayKey}T00:00:00Z`)) / MINUTE_MS;
  return `${dayLabel(dayKey)}, ${timeLabel(Math.round(minutes))} IST`;
}

/*
 * NOTHING THE STRANGER TYPED GOES BACK OUT — the booking half (gate leftover).
 *
 * Booking, cancellation and reminder mail all go to the address on a demo
 * request, which nobody verified; `name` and `orgName` are free text from the
 * same anonymous form. The acknowledgement (`demo-mail.ts`) stopped echoing
 * them; these three and the attached invite used to open "Hi {name}" and title
 * the event with the organisation, which kept the same relay alive one step
 * later. So they greet generically and the invite is just "DesiAuction demo".
 * The fields stay on the input for the founder's side of the booking.
 */
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

/** A composed mail: what the preview gallery renders and the senders send. */
export interface ComposedMail {
  readonly subject: string;
  readonly text: string;
  readonly html: string;
}

export function bookingConfirmationMail(input: BookingMailInput): ComposedMail {
  const when = whenWords(input.slotStart);
  return {
    subject: `Your DesiAuction demo — ${when}`,
    ...renderEmail({
      preheader: `You're booked in for ${when}. The calendar invite is attached.`,
      heading: "Your demo is booked",
      paragraphs: ["Hello,", `You're booked in for ${when}.`],
      details: [
        ["When", when],
        ["How", "We call the number you gave us"],
        ["Length", "About twenty minutes"],
      ],
      after: [
        "We'll walk through a real auction end to end — squads and purses, the bidding, the gavel, and the settlement afterwards. The calendar invite is attached.",
      ],
      action: { label: "Move or cancel", url: bookingUrl(input.token) },
      footnote: "You received this because you booked a DesiAuction demo.",
    }),
  };
}

export function bookingCancellationMail(input: BookingMailInput): ComposedMail {
  const when = whenWords(input.slotStart);
  return {
    subject: `Cancelled: your DesiAuction demo — ${when}`,
    ...renderEmail({
      preheader: `The demo on ${when} is cancelled.`,
      heading: "Your demo is cancelled",
      paragraphs: ["Hello,", `The demo on ${when} is cancelled and nobody will call.`],
      action: { label: "Pick another time", url: `${env.PUBLIC_BASE_URL}/schedule-demo` },
      footnote:
        "You received this because a DesiAuction demo booked with this address was cancelled.",
    }),
  };
}

/**
 * The reminder. Deliberately short — it is read on a phone, probably while
 * doing something else, and its only job is to put a time and a way out in
 * front of somebody.
 */
export function bookingReminderMail(input: BookingMailInput, hoursAhead: 24 | 1): ComposedMail {
  const when = whenWords(input.slotStart);
  return {
    subject:
      hoursAhead === 24
        ? `Tomorrow: your DesiAuction demo — ${when}`
        : `In an hour: your DesiAuction demo`,
    ...renderEmail({
      preheader: hoursAhead === 24 ? `We're speaking ${when}.` : `We're calling in about an hour.`,
      heading: hoursAhead === 24 ? "Your demo is tomorrow" : "Your demo is in an hour",
      paragraphs: [
        "Hello,",
        hoursAhead === 24
          ? `A reminder that we're speaking ${when}. We'll call the number you gave us.`
          : `We're calling in about an hour, at ${when}.`,
      ],
      action: { label: "Can't make it? Move or cancel", url: bookingUrl(input.token) },
      footnote: "You received this because you booked a DesiAuction demo.",
    }),
  };
}

function inviteFile(input: BookingMailInput, cancelled: boolean) {
  const url = bookingUrl(input.token);
  const ics = buildInvite({
    uid: inviteUid(input.requestId),
    start: input.slotStart,
    end: input.slotEnd,
    summary: "DesiAuction demo",
    description: cancelled
      ? "Cancelled."
      : `A live walkthrough of a real auction. Manage this booking: ${url}`,
    url,
    organizerEmail: SUPPORT_EMAIL,
    sequence: input.sequence,
    ...(cancelled ? { cancelled: true } : {}),
  });
  return {
    filename: "desiauction-demo.ics",
    contentType: "text/calendar",
    contentBase64: Buffer.from(ics, "utf8").toString("base64"),
  };
}

/*
 * Every one through the gate (catalogue `demo.booking_*`): the person booking
 * is a stranger with no switch, so what can stop these is a bounce or a
 * complaint on their address — or, from Phase 1, a platform admin.
 */
export async function sendBookingConfirmation(
  db: Db,
  input: BookingMailInput,
): Promise<GatedMailOutcome> {
  const { outcome } = await sendNotificationMail(
    db,
    { kind: "demo.booking_confirmed", to: input.to },
    { ...bookingConfirmationMail(input), attachment: inviteFile(input, false) },
  );
  return outcome;
}

export async function sendBookingCancellation(
  db: Db,
  input: BookingMailInput,
): Promise<GatedMailOutcome> {
  const { outcome } = await sendNotificationMail(
    db,
    { kind: "demo.booking_cancelled", to: input.to },
    { ...bookingCancellationMail(input), attachment: inviteFile(input, true) },
  );
  return outcome;
}

export async function sendBookingReminder(
  db: Db,
  input: BookingMailInput,
  hoursAhead: 24 | 1,
  now?: Date,
): Promise<GatedMailOutcome> {
  const { outcome } = await sendNotificationMail(
    db,
    { kind: "demo.booking_reminder", to: input.to, ...(now === undefined ? {} : { now }) },
    bookingReminderMail(input, hoursAhead),
  );
  return outcome;
}
