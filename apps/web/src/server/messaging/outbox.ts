import { messageOutbox, newId, people, type Db } from "@desiauction/db";
import { eq, sql } from "drizzle-orm";
import { after } from "next/server";

import { verifiedEmailOf } from "../auth/email-change";
import {
  createPlayerSmsSender,
  SmsSendError,
  type PlayerSmsSender,
} from "../competition/registration-notify";
import { db as appDb } from "../db";
import { maySend } from "./consent";
import { renderTemplate, SMS_TEMPLATES, type TemplateKey } from "./templates";
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
 *
 * SMS rides the same queue (0080): one DLT-registered line for the big
 * moments, because most players sign up by phone and never verify an email.
 * The row carries the template and its slots — what the gateway is given — and
 * the number and consent are decided at send time like an email's.
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

/** One line of SMS on a registered template (templates.ts). */
export interface QueuedSms {
  readonly personId: string;
  readonly orgId: string | null;
  readonly kind: string;
  /** Its own key, apart from the email's: `sms:` + the moment. */
  readonly dedupeKey: string;
  readonly templateKey: TemplateKey;
  readonly slots: Readonly<Record<string, string>>;
}

/**
 * Queue texts; returns the dedupe keys that were NEW. A text whose slots do not
 * render against its template is dropped here — never queued to fail later —
 * and the caller's email and inbox line still carry the moment.
 */
export async function enqueueSms(texts: readonly QueuedSms[], db: Db = appDb): Promise<string[]> {
  const rows = texts.flatMap((text) => {
    const rendered = renderTemplate(SMS_TEMPLATES[text.templateKey], text.slots);
    if (!rendered.ok) {
      return [];
    }
    return [
      {
        id: newId(),
        personId: text.personId,
        orgId: text.orgId,
        kind: text.kind,
        channel: "sms" as const,
        dedupeKey: text.dedupeKey,
        subject: "",
        bodyText: rendered.body,
        bodyHtml: "",
        templateKey: text.templateKey,
        slots: rendered.slots,
      },
    ];
  });
  if (rows.length === 0) {
    return [];
  }
  const inserted = await db
    .insert(messageOutbox)
    .values(rows)
    .onConflictDoNothing({ target: messageOutbox.dedupeKey })
    .returning({ dedupeKey: messageOutbox.dedupeKey });
  return inserted.map((row) => row.dedupeKey);
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
    sms?: PlayerSmsSender;
    now?: Date;
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
    channel: "email" | "sms";
    subject: string;
    body_text: string;
    body_html: string;
    template_key: string | null;
    slots: Record<string, string> | null;
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
    returning id, person_id, org_id, channel, subject, body_text, body_html,
              template_key, slots, attempts
  `);

  let sent = 0;
  let suppressed = 0;
  let failed = 0;
  let retrying = 0;
  let sms: PlayerSmsSender | null = null;
  for (const row of claimed) {
    if (row.channel === "sms") {
      sms ??= options.sms ?? createPlayerSmsSender(db);
      const result = await sendText(db, row, sms, options.now ?? new Date());
      if (result === "sent") sent += 1;
      else if (result === "suppressed") suppressed += 1;
      else if (result === "failed") failed += 1;
      else if (result === "retrying") retrying += 1;
      continue;
    }
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

type TextResult = "sent" | "suppressed" | "failed" | "retrying" | "deferred";

/**
 * NOBODY IS WOKEN BY A TEXT. An auction that ends at 11:40 pm must not buzz
 * ninety phones at midnight: an SMS due between 10 pm and 8 am IST waits for
 * 8 am. Transactional messages are exempt from TRAI's hours, and the email and
 * inbox line go at once — this is manners, not compliance. Deferral is only
 * possible because the queue exists (consent.ts named the missing scheduler).
 */
const QUIET_FROM_HOUR = 22;
const QUIET_UNTIL_HOUR = 8;
const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;

/** When a text due at `now` may go: `now`, or the next 8 am IST. */
export function textWindowOpensAt(now: Date): Date {
  const ist = new Date(now.getTime() + IST_OFFSET_MS);
  const hour = ist.getUTCHours();
  if (hour >= QUIET_UNTIL_HOUR && hour < QUIET_FROM_HOUR) {
    return now;
  }
  const opens = new Date(ist);
  opens.setUTCHours(QUIET_UNTIL_HOUR, 0, 0, 0);
  if (hour >= QUIET_FROM_HOUR) {
    opens.setUTCDate(opens.getUTCDate() + 1);
  }
  return new Date(opens.getTime() - IST_OFFSET_MS);
}

async function sendText(
  db: Db,
  row: {
    id: string;
    person_id: string;
    org_id: string | null;
    body_text: string;
    template_key: string | null;
    slots: Record<string, string> | null;
    attempts: number;
  },
  sender: PlayerSmsSender,
  now: Date,
): Promise<TextResult> {
  const opens = textWindowOpensAt(now);
  if (opens.getTime() > now.getTime()) {
    // Not an attempt: put the claim's increment back and wait for morning.
    await db
      .update(messageOutbox)
      .set({ nextAttemptAt: opens, attempts: sql`${messageOutbox.attempts} - 1` })
      .where(eq(messageOutbox.id, row.id));
    return "deferred";
  }
  const template =
    row.template_key !== null && row.template_key in SMS_TEMPLATES
      ? SMS_TEMPLATES[row.template_key as TemplateKey]
      : null;
  if (template === null || row.slots === null) {
    await settle(db, row.id, "failed", `unknown template ${row.template_key ?? "(none)"}`);
    return "failed";
  }
  const [person] = await db
    .select({ phone: people.phone })
    .from(people)
    .where(eq(people.id, row.person_id))
    .limit(1);
  if (person?.phone === null || person?.phone === undefined) {
    await settle(db, row.id, "suppressed", "no phone number");
    return "suppressed";
  }
  const decision = await maySend(db, {
    contact: person.phone,
    channel: "sms",
    category: template.category,
    scope: "auction",
    personId: row.person_id,
    ...(row.org_id === null ? {} : { orgId: row.org_id }),
  });
  if (!decision.send) {
    await settle(db, row.id, "suppressed", decision.reason);
    return "suppressed";
  }
  try {
    await sender.send(person.phone, { template, slots: row.slots, body: row.body_text });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "send failed";
    // A template with no registered DLT id will never deliver: fail it once,
    // naming the variable, instead of retrying five times into the same wall.
    if ((error instanceof SmsSendError && error.permanent) || row.attempts >= MAX_ATTEMPTS) {
      await settle(db, row.id, "failed", reason);
      return "failed";
    }
    await db
      .update(messageOutbox)
      .set({
        lastError: reason,
        nextAttemptAt: new Date(now.getTime() + 2 ** row.attempts * 60 * 1000),
      })
      .where(eq(messageOutbox.id, row.id));
    return "retrying";
  }
  await db
    .update(messageOutbox)
    .set({ status: "sent", sentAt: now, lastError: null })
    .where(eq(messageOutbox.id, row.id));
  return "sent";
}

async function settle(
  db: Db,
  id: string,
  status: "suppressed" | "failed",
  reason: string,
): Promise<void> {
  await db.update(messageOutbox).set({ status, lastError: reason }).where(eq(messageOutbox.id, id));
}
