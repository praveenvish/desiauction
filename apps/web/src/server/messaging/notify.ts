import type { Db } from "@desiauction/db";

import { createCodeMailer, type CodeMailPurpose } from "../auth/email-sender";
import type { NotificationKind } from "./catalogue";
import { notificationGate, type GateDecision } from "./gate";
import {
  transactionalMailer,
  type MailOutcome,
  type OutgoingMail,
  type TransactionalMailer,
} from "./transactional-mail";

/**
 * THE DIRECT SENDS, GATED.
 *
 * Most messages ride the outbox, whose drain asks the gate. The rest — a code,
 * a receipt for a demo request, a security warning, a staff notice — go at
 * once, and each used to hold its own mailer and decide for itself whether to
 * ask `maySend` first. Eighteen of them did not.
 *
 * So a direct send is now ONE call that names its catalogue entry, asks the
 * gate and only then touches the mailer. The guard test
 * (notification-guard.test.ts) fails the build if a module outside this one
 * and the outbox reaches for a mailer itself, so the next direct send cannot
 * quietly skip the gate the way these did.
 */

export type GatedMailOutcome = MailOutcome | "suppressed";

export interface MailTarget {
  readonly kind: NotificationKind;
  readonly to: string;
  /** Who it is for, when they have an account — what their switches hang off. */
  readonly personId?: string;
  /** The club it is sent on behalf of; `db` must be scoped to it (gate.ts). */
  readonly orgId?: string;
  readonly now?: Date;
}

/**
 * Gate, then send. Resolves either way, like the mailer: a provider outage or a
 * switch-off must never fail the action that caused the message.
 * `decision` is returned for callers that record WHY something was withheld.
 */
export async function sendNotificationMail(
  db: Db,
  target: MailTarget,
  mail: Omit<OutgoingMail, "to">,
  mailer: TransactionalMailer = transactionalMailer(),
): Promise<{ outcome: GatedMailOutcome; decision: GateDecision }> {
  const decision = await notificationGate(db, {
    kind: target.kind,
    channel: "email",
    recipient: {
      contact: target.to,
      ...(target.personId === undefined ? {} : { personId: target.personId }),
    },
    ...(target.orgId === undefined ? {} : { orgId: target.orgId }),
    ...(target.now === undefined ? {} : { now: target.now }),
  });
  if (!decision.send) {
    return { outcome: "suppressed", decision };
  }
  return { outcome: await mailer.send({ ...mail, to: target.to }), decision };
}

/**
 * A sign-in, sign-up or confirm-this-address code. LOCKED in the catalogue, so
 * the gate always says yes — it is asked anyway, so that there is one place
 * every send is visible from and the Phase 1 admin grid can show this row as
 * the one nobody can turn off. Throws `MailSendError` exactly as the code
 * mailer always has: the caller tells the person on screen.
 */
export async function sendSignInCodeMail(
  db: Db,
  email: string,
  code: string,
  purpose: CodeMailPurpose,
): Promise<void> {
  const decision = await notificationGate(db, {
    kind: "auth.email_code",
    channel: "email",
    recipient: { contact: email },
  });
  if (!decision.send) {
    // Unreachable while the entry is locked; a refusal here would mean somebody
    // unlocked it, and a silent drop would leave a person waiting for a code.
    throw new Error(`sign-in code refused by the notification gate: ${decision.reason}`);
  }
  await createCodeMailer(db).send(email, code, purpose);
}
