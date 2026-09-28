import { emailSends, newId, type Db } from "@desiauction/db";

import { db as appDb } from "../db";
import { logger } from "../logger";
import type { MailOutcome } from "./transactional-mail";

/**
 * THE RECORD OF A DIRECT SEND (0094) — what went, to whom, and the provider's
 * id for it. Never the words and never the address: a sign-in code must not
 * sit in a table, and the recipient's domain is all deliverability needs.
 *
 * NEVER THROWS. The mail has already gone (or been withheld) when this runs;
 * a ledger that could fail a sign-in because it could not write a row would
 * be the tail wagging the dog. A failed write is logged and the send stands.
 *
 * Written on the app pool whatever handle the sender held: the table is
 * platform-level (no RLS), and a sender inside a club's transaction must not
 * lose its record to that transaction rolling back.
 */
export interface EmailSendRecord {
  readonly kind: string;
  readonly to: string;
  readonly outcome: MailOutcome | "suppressed";
  readonly personId?: string | null;
  readonly orgId?: string | null;
  /** Why the gate withheld it. */
  readonly reason?: string | null;
  readonly providerMessageId?: string | null;
}

/** "Arjun@Gmail.com" → "gmail.com". Anything without a domain is "unknown". */
export function recipientDomainOf(address: string): string {
  const at = address.lastIndexOf("@");
  const domain =
    at === -1
      ? ""
      : address
          .slice(at + 1)
          .trim()
          .toLowerCase();
  return domain === "" ? "unknown" : domain.slice(0, 255);
}

export async function recordEmailSend(record: EmailSendRecord, db: Db = appDb): Promise<void> {
  try {
    await db
      .insert(emailSends)
      .values({
        id: newId(),
        kind: record.kind,
        personId: record.personId ?? null,
        orgId: record.orgId ?? null,
        recipientDomain: recipientDomainOf(record.to),
        outcome: record.outcome,
        reason:
          record.reason === undefined || record.reason === null
            ? null
            : record.reason.slice(0, 200),
        providerMessageId: record.providerMessageId ?? null,
      })
      // A provider that answers a retry with the same id: the first row stands.
      .onConflictDoNothing();
  } catch (error) {
    logger().error(
      { err: error, kind: record.kind, outcome: record.outcome },
      "email_send.record_failed",
    );
  }
}
