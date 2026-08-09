import { consentRecords, newId, suppressions, type Db } from "@desiauction/db";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";

import type { MessageCategory } from "./templates";

/**
 * THE GATE EVERY SEND PASSES THROUGH.
 *
 * Before this existed, the product texted people with no opt-in record, no
 * opt-out and no STOP handling — a grep for "opt.?out|unsubscribe|STOP to"
 * across the app and packages returned one incidental hit. Under the DPDP Act
 * and the DLT regime we have to be able to show what someone agreed to, and we
 * have to honour a STOP.
 *
 * The order is deliberate: suppression first, category second. A STOP outranks
 * everything, including a category we would otherwise be entitled to send. That
 * is both the legally safer order and the one a person expects — someone who
 * texts STOP does not care how we classify our own messages.
 *
 * Sign-in codes are the one exception and they are exempt by NOT coming through
 * here: the OTP sender is its own path. If they ever route through this module
 * they must stay exempt, because "turn off SMS" locking a person out of their
 * own account is a worse outcome than an unwanted message.
 */

export type SendDecision =
  { readonly send: true } | { readonly send: false; readonly reason: "suppressed" | "no_consent" };

/**
 * May we send this category to this contact right now?
 *
 * `scope` lets a person stop one topic without stopping the rest; a `global`
 * suppression stops everything on that channel.
 */
export async function maySend(
  db: Db,
  input: {
    contact: string;
    channel: "sms" | "email";
    category: MessageCategory;
    scope: string;
    personId?: string;
  },
): Promise<SendDecision> {
  const blocked = await db
    .select({ id: suppressions.id })
    .from(suppressions)
    .where(
      and(
        eq(suppressions.contact, input.contact),
        eq(suppressions.channel, input.channel),
        // A global suppression stops every topic; a scoped one stops its own.
        inArray(suppressions.scope, ["global", input.scope]),
        // A lifted row is evidence of a past STOP, not a live one.
        isNull(suppressions.liftedAt),
      ),
    )
    .limit(1);
  if (blocked.length > 0) {
    return { send: false, reason: "suppressed" };
  }
  if (input.category === "transactional") {
    // Transactional messages are the direct consequence of something the person
    // did, and the DLT regime allows them to numbers on the DND registry. They
    // need no opt-in — only the absence of a STOP, checked above.
    return { send: true };
  }
  if (input.personId === undefined) {
    // Promotional to a contact we cannot tie to a person is unsendable: there
    // is nobody whose consent we could have recorded.
    return { send: false, reason: "no_consent" };
  }
  const [latest] = await db
    .select({ granted: consentRecords.granted })
    .from(consentRecords)
    .where(
      and(
        eq(consentRecords.personId, input.personId),
        eq(consentRecords.purpose, `${input.channel}.promotional`),
      ),
    )
    // DESCENDING. The table is append-only, so a withdrawal is a newer row
    // rather than an edit — ascending order would read the original opt-in for
    // ever and keep sending to someone who had already said stop.
    .orderBy(desc(consentRecords.createdAt))
    .limit(1);
  return latest?.granted === true ? { send: true } : { send: false, reason: "no_consent" };
}

/**
 * Record what someone agreed to. Append-only — a withdrawal is a new row with
 * `granted: false`, never an update, so "had they agreed when we sent it?"
 * stays answerable.
 */
export async function recordConsent(
  db: Db,
  input: {
    personId: string;
    purpose: string;
    granted: boolean;
    source: "registration" | "account" | "sms_stop" | "sms_start" | "import" | "support";
    evidence?: Record<string, unknown>;
    requestIp?: string | null;
    userAgent?: string | null;
  },
): Promise<void> {
  await db.insert(consentRecords).values({
    id: newId(),
    personId: input.personId,
    purpose: input.purpose,
    granted: input.granted,
    source: input.source,
    evidence: input.evidence ?? {},
    requestIp: input.requestIp ?? null,
    userAgent: input.userAgent ?? null,
  });
}

/**
 * Stop sending to a contact. Used by STOP handling, and by bounce and complaint
 * webhooks — continuing to send to a hard bounce is how a sending domain dies.
 */
export async function suppress(
  db: Db,
  input: {
    contact: string;
    channel: "sms" | "email";
    scope?: string;
    reason: "stop" | "bounce" | "complaint" | "manual" | "unreachable";
    note?: string;
  },
): Promise<void> {
  await db.insert(suppressions).values({
    id: newId(),
    contact: input.contact,
    channel: input.channel,
    scope: input.scope ?? "global",
    reason: input.reason,
    note: input.note ?? null,
  });
}

/**
 * Reverse a STOP (someone texts START). The rows stay and are marked lifted
 * rather than deleted, so the history of what we were told, and when, survives.
 */
export async function liftSuppression(
  db: Db,
  input: { contact: string; channel: "sms" | "email"; at?: Date },
): Promise<void> {
  await db
    .update(suppressions)
    .set({ liftedAt: input.at ?? new Date() })
    .where(
      and(
        eq(suppressions.contact, input.contact),
        eq(suppressions.channel, input.channel),
        isNull(suppressions.liftedAt),
      ),
    );
}
