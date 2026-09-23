import { normalizePhone } from "@desiauction/core";

import { NOTIFICATIONS } from "./catalogue";

/**
 * What an admin typed into the suppression search, in the ONE shape the
 * `suppressions` table stores: E.164 for a number (`normalizePhone`, the same
 * rule sign-in uses), lowercased for an address (what the bounce webhook
 * writes). Pure, so the search, the manual add and their tests agree.
 *
 * The search is an EXACT match on that shape — it rides
 * `suppressions_contact_idx` — and never a LIKE over the table: a desk that
 * finds "every address containing 'gmail'" is a directory of who told us to go
 * away, which nobody needs to read.
 */

export type SuppressionChannel = "sms" | "email";

export type ParsedContact =
  | {
      readonly ok: true;
      readonly contact: string;
      /** The one suppression channel this contact is addressed on. WhatsApp
       *  rides the SMS row (catalogue `rowChannelOf`), so a number is `sms`. */
      readonly channel: SuppressionChannel;
    }
  | { readonly ok: false; readonly error: string };

const EMAIL_MAX = 254;

export function parseSuppressionContact(raw: string): ParsedContact {
  const trimmed = raw.trim();
  if (trimmed === "") {
    return { ok: false, error: "Type an email address or a mobile number." };
  }
  if (trimmed.includes("@")) {
    const email = trimmed.toLowerCase();
    const at = email.indexOf("@");
    const valid =
      email.length <= EMAIL_MAX &&
      !/\s/.test(email) &&
      at > 0 &&
      at === email.lastIndexOf("@") &&
      email.slice(at + 1).includes(".");
    return valid
      ? { ok: true, contact: email, channel: "email" }
      : { ok: false, error: "That is not an email address." };
  }
  const phone = normalizePhone(trimmed);
  return phone.ok
    ? { ok: true, contact: phone.phone, channel: "sms" }
    : { ok: false, error: "That is not an Indian mobile number or an email address." };
}

/**
 * The scopes a suppression may carry: everything on the channel, or one topic.
 * Sign-in is not one of them — codes never reach the suppression check (gate.ts)
 * — so a login-scoped row would be a switch wired to nothing.
 */
export const SUPPRESSION_SCOPES: readonly string[] = [
  "global",
  ...new Set(NOTIFICATIONS.map((entry) => entry.topic).filter((topic) => topic !== "login")),
];

export function isSuppressionScope(value: string): boolean {
  return SUPPRESSION_SCOPES.includes(value);
}

/**
 * Reasons whose lift overrides something the PERSON said: a STOP is them
 * asking us not to text, a complaint is them telling their provider we are
 * spam. Lifting either needs an explicit confirmation, enforced on the server
 * (suppression-writer.ts), not only a dialog.
 */
export function liftNeedsConfirmation(reason: string): boolean {
  return reason === "stop" || reason === "complaint";
}
