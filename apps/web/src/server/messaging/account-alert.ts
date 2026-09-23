import { people, type Db } from "@desiauction/db";
import { eq } from "drizzle-orm";

import { maySend } from "./consent";
import { createPlayerSmsSender, type PlayerSmsSender } from "./sms";
import { renderTemplate, SMS_TEMPLATES } from "./templates";
import {
  createWhatsAppSender,
  whatsappOptedIn,
  whatsappParams,
  whatsappTemplateName,
  WhatsAppSendError,
  WHATSAPP_TEMPLATES,
  type PersonalWhatsAppSender,
} from "./whatsapp";

/**
 * THE ACCOUNT ALERTS BY TEXT — "your mobile number was changed", "your sign-in
 * email was changed" — to the account's OWNER.
 *
 * Sent at once, NOT through the outbox, for two reasons the queue cannot meet:
 *
 *   · The phone change warns the number being GIVEN UP. The drain reads the
 *     number when it sends, and by then the account holds the new one — the
 *     very handset a thief would be holding.
 *   · The queue holds texts from 10 pm to 8 am. A takeover at midnight has to
 *     be announced at midnight.
 *
 * WhatsApp only for a person who opted in — Meta requires it for any message
 * the business starts, an alert included — then SMS where a gateway exists,
 * and otherwise no text: the email half of each alert (auth/
 * email-changed-notice.ts) is what reaches everybody else.
 *
 * The gate still applies. Somebody who sent STOP has said they want no
 * messages, and a security notice does not outrank that — the change is on
 * their security ledger either way, which is a place they can look.
 */

export type AccountAlertKey = "security.phone_changed" | "security.email_changed";

export type AccountAlertOutcome =
  | "whatsapp"
  | "sms"
  /** STOP list or the person's own switch. */
  | "suppressed"
  /** No channel: not on WhatsApp, and no SMS for it. */
  | "no_text_channel"
  /** Tried and did not go (or may have: a timeout is never re-sent by SMS). */
  | "failed";

export async function sendAccountAlert(
  db: Db,
  input: {
    readonly personId: string;
    /** Where it goes — for a phone change, the number being given up. */
    readonly phone: string;
    readonly key: AccountAlertKey;
    readonly slots: Readonly<Record<string, string>>;
  },
  channels: {
    readonly whatsapp?: PersonalWhatsAppSender | null;
    readonly whatsappTemplate?: (key: string) => string | undefined;
    readonly sms?: PlayerSmsSender | null;
  } = {},
): Promise<AccountAlertOutcome> {
  const decision = await maySend(db, {
    contact: input.phone,
    channel: "sms",
    category: "transactional",
    scope: "security",
  });
  if (!decision.send) {
    return "suppressed";
  }
  const whatsapp = channels.whatsapp === undefined ? createWhatsAppSender() : channels.whatsapp;
  const name = (channels.whatsappTemplate ?? whatsappTemplateName)(input.key);
  if (whatsapp !== null && name !== undefined) {
    const consent = await whatsappOptedIn(db, input.personId);
    if (consent.optedIn) {
      const [person] = await db
        .select({ name: people.name })
        .from(people)
        .where(eq(people.id, input.personId))
        .limit(1);
      const template = WHATSAPP_TEMPLATES[input.key];
      try {
        await whatsapp.send(input.phone, {
          name,
          template,
          params: whatsappParams(
            template,
            input.slots,
            person?.name?.trim() || "there",
            consent.language,
          ),
          imageUrl: null,
          language: consent.language,
        });
        return "whatsapp";
      } catch (error) {
        // Meta may already have it: an SMS on top is the same alert twice.
        if (error instanceof WhatsAppSendError && error.outcomeUnknown) {
          return "failed";
        }
        // Otherwise it never reached them, and SMS below may.
      }
    }
  }
  // The email change never had an SMS: DLT would need its own registration.
  if (input.key !== "security.phone_changed") {
    return "no_text_channel";
  }
  const sms = channels.sms === undefined ? createPlayerSmsSender(db) : channels.sms;
  if (sms === null) {
    return "no_text_channel";
  }
  const template = SMS_TEMPLATES[input.key];
  const rendered = renderTemplate(template, input.slots);
  if (!rendered.ok) {
    return "failed";
  }
  await sms.send(input.phone, { template, slots: rendered.slots, body: rendered.body });
  return "sms";
}
