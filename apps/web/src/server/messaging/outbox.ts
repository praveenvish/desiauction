import { messageOutbox, newId, type Db } from "@desiauction/db";
import { eq, sql } from "drizzle-orm";
import { after } from "next/server";

import { verifiedEmailOf } from "../auth/email-change";
import { db as appDb } from "../db";
import { maySend } from "./consent";
import { transactionalMailer, type TransactionalMailer } from "./transactional-mail";

/**
 * THE PERSONAL-MESSAGE QUEUE (0079).
 *
 * A moment worth telling somebody about — a sale, an appointment, a squad —
 * is rendered once and WRITTEN here, then delivered by a drain. Two reasons:
 *
 *   · A finished auction tells ninety players and every owner. Ninety provider
 *     calls on the request that closed the auction would hold the conductor's
 *     screen for half a minute, and whatever a restart interrupted would be
 *     gone. Written first, nothing is lost; drained after, nothing waits.
 *   · At most once. `dedupe_key` names the moment (this person, this sale), so
 *     a retried completion or a second "Announce" press is a no-op, not a
 *     second email.
 *
 * The ADDRESS and the CONSENT are decided at send time, not at write time: a
 * person who verifies an email, or switches "Auction updates" off, between the
 * moment and the drain gets what they asked for. No verified email is not a
 * failure — it is `suppressed`, and the in-app inbox (written by the caller)
 * still carries the moment.
 */

export interface QueuedMail {
  readonly personId: string;
  readonly orgId: string | null;
  /** What happened — `auction.sold`, `team.appointed`, … */
  readonly kind: string;
  /** One per person per moment; a repeat is ignored. */
  readonly dedupeKey: string;
  readonly subject: string;
  readonly text: string;
  readonly html: string;
}

/**
 * Queue mails; returns the dedupe keys that were NEW. A repeated moment is not
 * in the list — which is how a caller knows whom it has not told before.
 */
export async function enqueueMail(mails: readonly QueuedMail[], db: Db = appDb): Promise<string[]> {
  if (mails.length === 0) {
    return [];
  }
  const inserted = await db
    .insert(messageOutbox)
    .values(
      mails.map((mail) => ({
        id: newId(),
        personId: mail.personId,
        orgId: mail.orgId,
        kind: mail.kind,
        channel: "email" as const,
        dedupeKey: mail.dedupeKey,
        subject: mail.subject,
        bodyText: mail.text,
        bodyHtml: mail.html,
      })),
    )
    .onConflictDoNothing({ target: messageOutbox.dedupeKey })
    .returning({ dedupeKey: messageOutbox.dedupeKey });
  return inserted.map((row) => row.dedupeKey);
}

/**
 * Deliver what was just queued, after the response. Best effort by design:
 * outside a request (a test, a script) there is no `after`, and the scheduled
 * drain (`/api/jobs/messages`) picks the rows up instead.
 */
export function kickDrain(): void {
  try {
    after(async () => {
      await drainOutbox().catch(() => undefined);
    });
  } catch {
    // Not in a request scope — the scheduled drain will deliver.
  }
}

const MAX_ATTEMPTS = 5;
/** A claimed row is invisible to other drains for this long. */
const LEASE_MS = 5 * 60 * 1000;

export interface DrainResult {
  readonly sent: number;
  readonly suppressed: number;
  readonly failed: number;
  readonly retrying: number;
}

/**
 * Claim due rows, then send each. The claim pushes `next_attempt_at` a lease
 * ahead inside one statement (`FOR UPDATE SKIP LOCKED`), so two drains running
 * at once never pick the same row — the at-most-once rule holds under
 * concurrency, not just under good timing.
 */
export async function drainOutbox(
  options: {
    db?: Db;
    mailer?: TransactionalMailer;
    limit?: number;
    /** Only these people's rows — a test's own, in a shared database. */
    personIds?: readonly string[];
  } = {},
): Promise<DrainResult> {
  const db = options.db ?? appDb;
  const onlyPersons =
    options.personIds === undefined
      ? sql``
      : sql`and person_id in (${sql.join(
          options.personIds.map((id) => sql`${id}`),
          sql`, `,
        )})`;
  const mailer = options.mailer ?? transactionalMailer();
  const limit = options.limit ?? 50;
  const claimed = await db.execute<{
    id: string;
    person_id: string;
    org_id: string | null;
    subject: string;
    body_text: string;
    body_html: string;
    attempts: number;
  }>(sql`
    update ${messageOutbox}
    set next_attempt_at = now() + ${`${String(LEASE_MS)} milliseconds`}::interval,
        attempts = ${messageOutbox.attempts} + 1
    where ${messageOutbox.id} in (
      select id from ${messageOutbox}
      where status = 'pending' and next_attempt_at <= now() ${onlyPersons}
      order by next_attempt_at
      limit ${limit}
      for update skip locked
    )
    returning id, person_id, org_id, subject, body_text, body_html, attempts
  `);

  let sent = 0;
  let suppressed = 0;
  let failed = 0;
  let retrying = 0;
  for (const row of claimed) {
    const email = await verifiedEmailOf(db, row.person_id);
    if (email === null) {
      await settle(db, row.id, "suppressed", "no verified email");
      suppressed += 1;
      continue;
    }
    const decision = await maySend(db, {
      contact: email,
      channel: "email",
      category: "transactional",
      scope: "auction",
      personId: row.person_id,
      ...(row.org_id === null ? {} : { orgId: row.org_id }),
    });
    if (!decision.send) {
      await settle(db, row.id, "suppressed", decision.reason);
      suppressed += 1;
      continue;
    }
    const outcome = await mailer.send({
      to: email,
      subject: row.subject,
      text: row.body_text,
      html: row.body_html,
    });
    if (outcome === "sent") {
      await db
        .update(messageOutbox)
        .set({ status: "sent", sentAt: new Date(), lastError: null })
        .where(eq(messageOutbox.id, row.id));
      sent += 1;
    } else if (outcome === "unconfigured") {
      // No provider yet: nothing will ever send it, so it is not "failing".
      await settle(db, row.id, "suppressed", "email provider not configured");
      suppressed += 1;
    } else if (row.attempts >= MAX_ATTEMPTS) {
      await settle(db, row.id, "failed", outcome);
      failed += 1;
    } else {
      // Back off: 2, 4, 8, 16 minutes.
      await db
        .update(messageOutbox)
        .set({
          lastError: outcome,
          nextAttemptAt: new Date(Date.now() + 2 ** row.attempts * 60 * 1000),
        })
        .where(eq(messageOutbox.id, row.id));
      retrying += 1;
    }
  }
  return { sent, suppressed, failed, retrying };
}

async function settle(
  db: Db,
  id: string,
  status: "suppressed" | "failed",
  reason: string,
): Promise<void> {
  await db.update(messageOutbox).set({ status, lastError: reason }).where(eq(messageOutbox.id, id));
}
