import { people, type Db } from "@desiauction/db";
import type { MessageLanguage } from "@desiauction/messaging/email-templates";
import { and, eq, isNotNull } from "drizzle-orm";

import { env } from "../../env";
import { logger } from "../logger";
import { languageForMail, sendNotificationMail } from "../messaging/notify";
import { renderNotificationEmail, type NotificationMail } from "../messaging/notification-email";
import { requestDetails, type RequestContext } from "../messaging/request-context";
import type { TransactionalMailer } from "../messaging/transactional-mail";

/**
 * THE ACCOUNT'S OWN NOTICES (email programme PR14) — a passkey added or
 * removed, and an account-deletion request from filing to its outcome.
 *
 * Both are `security` in the catalogue: no switch of the person's or a club's
 * stops them, only a platform admin with a written reason. Sent DIRECT to the
 * account's verified email, at once — like "your sign-in email was changed":
 * a passkey added by somebody holding a stolen session is a key they keep,
 * and the owner has to hear it now, not when a queue drains. Best effort: the
 * change has committed, and a provider outage must never undo or fail it.
 */

const BASE = (): string => env.PUBLIC_BASE_URL.replace(/\/$/, "");

type Outcome = "sent" | "skipped" | "failed";

/** The account's verified email, its first name and language — or null. */
async function contactOf(
  db: Db,
  personId: string,
): Promise<{ email: string; name: string; language: MessageLanguage } | null> {
  const [person] = await db
    .select({ email: people.email, name: people.name })
    .from(people)
    .where(and(eq(people.id, personId), isNotNull(people.emailVerifiedAt)))
    .limit(1);
  if (person?.email === null || person?.email === undefined) {
    return null;
  }
  return {
    email: person.email,
    name: person.name?.trim() || "there",
    language: await languageForMail(db, { personId }),
  };
}

async function send(
  db: Db,
  kind: "security.passkey_changed" | "security.account_deletion",
  to: string,
  mail: NotificationMail,
  mailer?: TransactionalMailer,
): Promise<Outcome> {
  try {
    const { outcome } = await sendNotificationMail(db, { kind, to }, mail, mailer);
    return outcome === "sent" ? "sent" : "failed";
  } catch (error) {
    logger().warn({ err: error, kind }, "account_notice.failed");
    return "failed";
  }
}

// --- Passkeys ---------------------------------------------------------------------

export function passkeyChangedCopy(
  change: "added" | "removed",
  passkeyName: string,
  language: MessageLanguage,
  context?: RequestContext,
): Promise<NotificationMail> {
  return renderNotificationEmail(
    "security.passkey_changed",
    language,
    { passkeyName },
    {
      variant: change,
      action: { id: "security", url: `${BASE()}/account?section=security` },
      ...(context === undefined ? {} : { details: requestDetails(context, "change", language) }),
    },
  );
}

export async function notifyPasskeyChanged(
  db: Db,
  input: {
    personId: string;
    change: "added" | "removed";
    passkeyName: string;
    context?: RequestContext;
  },
  mailer?: TransactionalMailer,
): Promise<Outcome> {
  const contact = await contactOf(db, input.personId);
  if (contact === null) {
    return "skipped";
  }
  const mail = await passkeyChangedCopy(
    input.change,
    input.passkeyName,
    contact.language,
    input.context,
  );
  return send(db, "security.passkey_changed", contact.email, mail, mailer);
}

// --- Account deletion ---------------------------------------------------------------

export type DeletionStage = "requested" | "withdrawn" | "declined" | "completed";

export function accountDeletionCopy(
  stage: DeletionStage,
  facts: { name: string; reason?: string | null },
  language: MessageLanguage,
): Promise<NotificationMail> {
  return renderNotificationEmail(
    "security.account_deletion",
    language,
    { name: facts.name, reasonLine: facts.reason?.trim() ?? "" },
    {
      variant: stage,
      action: {
        id: "account",
        // Once deleted there is no account page to open — the help page.
        url: stage === "completed" ? `${BASE()}/support` : `${BASE()}/account?section=data`,
      },
    },
  );
}

/**
 * Tell the person where their deletion request stands. For "completed", pass
 * the contact read BEFORE the erasure — by the time this is sent, the account
 * holds no email to read.
 */
export async function notifyAccountDeletion(
  db: Db,
  input: {
    personId: string;
    stage: DeletionStage;
    reason?: string | null;
    contact?: { email: string; name: string; language: MessageLanguage } | null;
  },
  mailer?: TransactionalMailer,
): Promise<Outcome> {
  const contact = input.contact ?? (await contactOf(db, input.personId));
  if (contact === null) {
    return "skipped";
  }
  const mail = await accountDeletionCopy(
    input.stage,
    { name: contact.name, reason: input.reason ?? null },
    contact.language,
  );
  return send(db, "security.account_deletion", contact.email, mail, mailer);
}

/** The contact, read now, for the "deleted" mail that goes after it is gone. */
export function deletionContactOf(
  db: Db,
  personId: string,
): Promise<{ email: string; name: string; language: MessageLanguage } | null> {
  return contactOf(db, personId);
}
