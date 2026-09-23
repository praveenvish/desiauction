import type { Db } from "@desiauction/db";

import { env } from "../../env";
import { maySend } from "../messaging/consent";
import { SUPPORT_EMAIL, renderEmail } from "../messaging/email-layout";
import { transactionalMailer, type TransactionalMailer } from "../messaging/transactional-mail";

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
 * unregistered one. The email is the notice; a text needs its own template.
 */

/** `arjun@example.com` → `a•••@example.com`. */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf("@");
  if (at <= 0) {
    return "•••";
  }
  return `${email.slice(0, 1)}•••${email.slice(at)}`;
}

export function emailChangedCopy(newEmail: string): {
  subject: string;
  text: string;
  html: string;
} {
  const masked = maskEmail(newEmail);
  return {
    subject: "Your DesiAuction sign-in email was changed",
    ...renderEmail({
      preheader: `This account now signs in with ${masked}.`,
      heading: "Your sign-in email was changed",
      paragraphs: [
        `The DesiAuction account that used this address now signs in with ${masked}. Codes and account mail go there from now on, and every other device was signed out.`,
        "If that was you, there is nothing to do.",
      ],
      after: [
        `If it wasn't you, somebody may have reached your account. Write to ${SUPPORT_EMAIL} straight away from this address and we will help you get it back.`,
      ],
      action: { label: "Get help", url: `${env.PUBLIC_BASE_URL}/support` },
      footnote:
        "You received this because this address was the sign-in email on a DesiAuction account until a moment ago.",
    }),
  };
}

/**
 * Send it — best effort, like the phone warning: the change has committed and
 * a provider outage must never undo or fail it.
 *
 * Through the gate for the same reason the phone warning is: a hard
 * suppression (a bounce, a complaint) on that address still means stop. It is
 * transactional, so no marketing opt-out applies and none is needed.
 */
export async function notifyEmailChanged(
  db: Db,
  previousEmail: string | null,
  newEmail: string,
  mailer: TransactionalMailer = transactionalMailer(),
): Promise<"sent" | "skipped" | "refused" | "failed"> {
  if (previousEmail === null || previousEmail === newEmail) {
    return "skipped";
  }
  const decision = await maySend(db, {
    contact: previousEmail,
    channel: "email",
    category: "transactional",
    scope: "security",
  });
  if (!decision.send) {
    return "refused";
  }
  const outcome = await mailer.send({ to: previousEmail, ...emailChangedCopy(newEmail) });
  return outcome === "sent" ? "sent" : "failed";
}
