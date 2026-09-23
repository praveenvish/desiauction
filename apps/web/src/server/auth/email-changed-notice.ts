import type { Db } from "@desiauction/db";
import type { MessageLanguage } from "@desiauction/messaging/email-templates";

import { env } from "../../env";
import { languageForMail, sendNotificationMail } from "../messaging/notify";
import { renderNotificationEmail, type NotificationMail } from "../messaging/notification-email";
import type { TransactionalMailer } from "../messaging/transactional-mail";

/**
 * "YOUR SIGN-IN EMAIL WAS CHANGED" — told to the address that just lost it.
 *
 * The phone change has warned the outgoing number since it shipped; the email
 * change warned nobody (gate P1-6). Since email-first sign-in, the address IS
 * the credential: somebody holding a stolen session could move it to their own
 * mailbox, every other session would be signed out (the confirm step's own
 * rule), and the owner would learn of it only by failing to sign in. The old
 * inbox is the one place the owner is still reading, so that is where this
 * goes, the moment the change commits.
 *
 * The new address is NOT named in full, for the phone template's reason: a
 * warning must not hand whoever reads it a working contact for the account.
 * "a•••@example.com" is enough for the owner to recognise their own move.
 *
 * NO SMS alongside it. The one registered security text says "mobile number
 * was changed" and cannot be bent into this sentence, and DLT will not carry an
 * unregistered one. It has a WhatsApp template of its own
 * (`security.email_changed`), sent to the account's phone for an owner who
 * opted in (messaging/account-alert.ts) — the one channel a thief who moved
 * the address does not also hold.
 */

/** `arjun@example.com` → `a•••@example.com`. */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf("@");
  if (at <= 0) {
    return "•••";
  }
  return `${email.slice(0, 1)}•••${email.slice(at)}`;
}

export function emailChangedCopy(
  newEmail: string,
  language: MessageLanguage = "en",
): Promise<NotificationMail> {
  // The "if it wasn't you" line is LOCKED in the template: an admin can reword
  // the rest, never remove the one sentence that tells the owner what to do.
  return renderNotificationEmail(
    "security.email_changed",
    language,
    { maskedEmail: maskEmail(newEmail) },
    { action: { id: "help", url: `${env.PUBLIC_BASE_URL}/support` } },
  );
}

/**
 * Send it — best effort, like the phone warning: the change has committed and
 * a provider outage must never undo or fail it.
 *
 * Through the gate for the same reason the phone warning is: a hard
 * suppression (a bounce, a complaint) on that address still means stop. It is
 * `security` in the catalogue, so no switch of the person's or a club's
 * applies — only a platform admin may stop it, with a written reason.
 */
export async function notifyEmailChanged(
  db: Db,
  previousEmail: string | null,
  newEmail: string,
  mailer?: TransactionalMailer,
  /** Whose account moved — the warning is written in their language. */
  personId?: string,
): Promise<"sent" | "skipped" | "refused" | "failed"> {
  if (previousEmail === null || previousEmail === newEmail) {
    return "skipped";
  }
  const language = await languageForMail(db, { personId: personId ?? null });
  const { outcome } = await sendNotificationMail(
    db,
    { kind: "security.email_changed", to: previousEmail },
    await emailChangedCopy(newEmail, language),
    mailer,
  );
  return outcome === "suppressed" ? "refused" : outcome === "sent" ? "sent" : "failed";
}

/**
 * "YOUR MOBILE NUMBER WAS CHANGED" — the email half of the phone-change alert.
 *
 * The text goes to the number being given up (auth/actions.ts), but only on
 * WhatsApp for somebody who opted in, and SMS is deferred — so for most owners
 * the only warning is this one, to the verified address on the account. The
 * new number is not named: "ending 4321" is enough to recognise, and not
 * enough to use.
 */
export function phoneChangedCopy(
  last4: string,
  language: MessageLanguage = "en",
): Promise<NotificationMail> {
  return renderNotificationEmail(
    "security.phone_changed",
    language,
    { last4 },
    { action: { id: "help", url: `${env.PUBLIC_BASE_URL}/support` } },
  );
}

/** Best effort, through the gate — `notifyEmailChanged`'s rules exactly. */
export async function notifyPhoneChangedByEmail(
  db: Db,
  email: string | null,
  newPhone: string,
  mailer?: TransactionalMailer,
  personId?: string,
): Promise<"sent" | "skipped" | "refused" | "failed"> {
  if (email === null) {
    return "skipped";
  }
  const language = await languageForMail(db, { personId: personId ?? null, email });
  const { outcome } = await sendNotificationMail(
    db,
    { kind: "security.phone_changed", to: email },
    await phoneChangedCopy(newPhone.slice(-4), language),
    mailer,
  );
  return outcome === "suppressed" ? "refused" : outcome === "sent" ? "sent" : "failed";
}
