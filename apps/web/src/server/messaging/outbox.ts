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
import {
  createWhatsAppSender,
  whatsappOptedIn,
  whatsappParams,
  whatsappTemplateName,
  WhatsAppSendError,
  WHATSAPP_TEMPLATES,
  type PersonalWhatsAppSender,
} from "./whatsapp";
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
  /** The picture WhatsApp shows with it (0081) — the player card on a sale. */
  readonly mediaUrl?: string | null;
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
        mediaUrl: text.mediaUrl ?? null,
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
/**
 * A claimed row is invisible to other drains for this long — and every provider
 * call is cut off at PROVIDER_TIMEOUT_MS (ten seconds), so one send can never
 * outlive the lease it was made under. That ratio is the at-most-once rule.
 */
const LEASE_MS = 5 * 60 * 1000;
/** Retries back off 2, 4, 8, 16 minutes — and never further than this. */
const MAX_BACKOFF_MS = 30 * 60 * 1000;
/**
 * How soon a row the breaker turned away is looked at again. Roughly the
 * breakers' own cooldown (a minute): sooner is pointless, later just delays
 * the backlog once the provider recovers.
 */
const BREAKER_RETRY_MS = 2 * 60 * 1000;

function backoffMs(attempts: number): number {
  return Math.min(2 ** attempts * 60 * 1000, MAX_BACKOFF_MS);
}

export interface DrainResult {
  readonly sent: number;
  readonly suppressed: number;
  readonly failed: number;
  readonly retrying: number;
  /** Rows this drain claimed but another drain took over before it got to them. */
  readonly skipped: number;
}

/** What the claim hands back: the row, and the lease it was taken under. */
type ClaimedRow = {
  id: string;
  person_id: string;
  org_id: string | null;
  channel: "email" | "sms";
  subject: string;
  body_text: string;
  body_html: string;
  template_key: string | null;
  slots: Record<string, string> | null;
  media_url: string | null;
  attempts: number;
  /** `next_attempt_at` as epoch microseconds, as text — the claim token. */
  lease: string;
};

/** `next_attempt_at` to the microsecond: exact, so it can be compared for equality. */
const LEASE_TOKEN = sql`(extract(epoch from next_attempt_at) * 1000000)::bigint::text`;

/**
 * Is this row still OURS? Asked immediately before each send, and it renews
 * the lease while it asks.
 *
 * `FOR UPDATE SKIP LOCKED` stops two drains claiming a row AT THE SAME TIME. It
 * says nothing about a drain that claimed fifty rows and is still working
 * through them when their five minutes run out: the next drain claims the
 * stragglers, and without this both would send them. The claim moved
 * `next_attempt_at` and `attempts`; a re-claim moves them again. So "the row
 * still carries the lease I took" is a compare-and-set that exactly one drain
 * can win — the loser skips the row, the winner sends it.
 */
async function stillOurs(db: Db, row: ClaimedRow): Promise<boolean> {
  const renewed = await db.execute<{ lease: string }>(sql`
    update ${messageOutbox}
    set next_attempt_at = now() + ${`${String(LEASE_MS)} milliseconds`}::interval
    where ${messageOutbox.id} = ${row.id}
      and status = 'pending'
      and attempts = ${row.attempts}
      and ${LEASE_TOKEN} = ${row.lease}
    returning ${LEASE_TOKEN} as lease
  `);
  const [fresh] = renewed;
  if (fresh === undefined) {
    return false;
  }
  row.lease = fresh.lease;
  return true;
}

/**
 * The send gate, asked INSIDE the club's own boundary.
 *
 * `maySend` reads `org_messaging_settings` — a club's "don't send" switch —
 * and that table is FORCE ROW LEVEL SECURITY, visible only where `app.org_id`
 * names its club. The drain works across every org on the bare app pool, so in
 * production the read saw no row, and "no row" means "enabled": a club that
 * switched auction mail off kept sending it. Locally the database owner
 * bypasses RLS and the switch worked, which is why no test noticed.
 *
 * So a row that belongs to a club has its consent read in a short transaction
 * scoped to that club, exactly as `withTenantDb` would set it up — and only the
 * reads: the provider call stays outside, so no connection is held across it.
 */
function mayDeliver(
  db: Db,
  row: ClaimedRow,
  input: Omit<Parameters<typeof maySend>[1], "orgId" | "personId">,
): ReturnType<typeof maySend> {
  const gate = { ...input, personId: row.person_id };
  const orgId = row.org_id;
  if (orgId === null) {
    return maySend(db, gate);
  }
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.person_id', ${row.person_id}, true)`);
    await tx.execute(sql`select set_config('app.org_id', ${orgId}, true)`);
    return maySend(tx, { ...gate, orgId });
  });
}

/**
 * A provider's breaker turned the send away without trying it. That is not an
 * attempt — nothing reached the provider — so the claim's increment goes back
 * and the row waits out the cooldown. Counting it was how an outage longer
 * than the back-off ladder (half an hour) failed every queued message for good.
 */
async function waitOutBreaker(db: Db, row: ClaimedRow, now: Date, reason: string): Promise<void> {
  await db
    .update(messageOutbox)
    .set({
      lastError: reason,
      nextAttemptAt: new Date(now.getTime() + BREAKER_RETRY_MS),
      attempts: sql`greatest(${messageOutbox.attempts} - 1, 0)`,
    })
    .where(eq(messageOutbox.id, row.id));
}

/**
 * Claim due rows, then send each. The claim pushes `next_attempt_at` a lease
 * ahead inside one statement (`FOR UPDATE SKIP LOCKED`), so two drains running
 * at once never pick the same row; `stillOurs` re-checks the claim before each
 * send, so a drain that outlived its lease never sends a row another drain has
 * since taken — the at-most-once rule holds under concurrency AND slowness.
 */
export async function drainOutbox(
  options: {
    db?: Db;
    mailer?: TransactionalMailer;
    sms?: PlayerSmsSender;
    /** Omitted: the platform's (null when WhatsApp is not set up). */
    whatsapp?: PersonalWhatsAppSender | null;
    /** The approved template name for a key — injected by tests. */
    whatsappTemplate?: (key: string) => string | undefined;
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
  const claimed = await db.execute<ClaimedRow>(sql`
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
              template_key, slots, media_url, attempts, ${LEASE_TOKEN} as lease
  `);

  let sent = 0;
  let suppressed = 0;
  let failed = 0;
  let retrying = 0;
  let skipped = 0;
  let sms: PlayerSmsSender | null = null;
  const whatsapp: TextChannels["whatsapp"] = {
    sender: options.whatsapp === undefined ? createWhatsAppSender() : options.whatsapp,
    templateName: options.whatsappTemplate ?? whatsappTemplateName,
  };
  for (const row of claimed) {
    if (!(await stillOurs(db, row))) {
      skipped += 1;
      continue;
    }
    if (row.channel === "sms") {
      sms ??= options.sms ?? createPlayerSmsSender(db);
      const result = await sendText(db, row, { sms, whatsapp }, options.now ?? new Date());
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
    const decision = await mayDeliver(db, row, {
      contact: email,
      channel: "email",
      category: "transactional",
      scope: "auction",
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
    } else if (outcome === "breaker-open") {
      await waitOutBreaker(db, row, new Date(), outcome);
      retrying += 1;
    } else if (row.attempts >= MAX_ATTEMPTS) {
      await settle(db, row.id, "failed", outcome);
      failed += 1;
    } else {
      // A timed-out send lands here too and is retried: an email provider that
      // did not answer in ten seconds almost never went on to deliver, and a
      // lost sale notice is the worse error than a rare duplicate one.
      await db
        .update(messageOutbox)
        .set({
          lastError: outcome,
          nextAttemptAt: new Date(Date.now() + backoffMs(row.attempts)),
        })
        .where(eq(messageOutbox.id, row.id));
      retrying += 1;
    }
  }
  return { sent, suppressed, failed, retrying, skipped };
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

interface TextChannels {
  readonly sms: PlayerSmsSender;
  readonly whatsapp: {
    readonly sender: PersonalWhatsAppSender | null;
    readonly templateName: (key: string) => string | undefined;
  };
}

async function sendText(
  db: Db,
  row: ClaimedRow,
  channels: TextChannels,
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
    .select({ phone: people.phone, name: people.name })
    .from(people)
    .where(eq(people.id, row.person_id))
    .limit(1);
  if (person?.phone === null || person?.phone === undefined) {
    await settle(db, row.id, "suppressed", "no phone number");
    return "suppressed";
  }
  const decision = await mayDeliver(db, row, {
    contact: person.phone,
    channel: "sms",
    category: template.category,
    scope: "auction",
  });
  if (!decision.send) {
    await settle(db, row.id, "suppressed", decision.reason);
    return "suppressed";
  }
  /*
   * WHATSAPP INSTEAD, for a player who opted in (founder decision, Phase 3):
   * the same moment, one ping. Only when their latest answer is yes AND Meta
   * has approved this template (its name is configured) AND the account is set
   * up — otherwise it is the SMS below, exactly as before. The STOP list and
   * the "Auction updates" switch above have already been honoured: they are
   * about being messaged at all, whichever app it lands in.
   *
   * A WhatsApp failure is not the end of the moment: it falls straight back to
   * SMS in this same pass (C-19, "SMS when WhatsApp is undeliverable"), and the
   * row keeps the WhatsApp error so the fallback is visible.
   *
   * EXCEPT a timeout. A refusal or a dead connection means Meta never had the
   * message; a call that died on our deadline may well have been accepted and
   * be on the phone already. That is not "undeliverable", it is UNKNOWN — and
   * an SMS on top, or a retry, is the same moment twice. The queue's promise is
   * at most once, so the row stops here, failed with the reason spelled out;
   * the in-app inbox line the caller wrote still carries the moment.
   */
  let whatsappError: string | null = null;
  const waTemplate = WHATSAPP_TEMPLATES[template.key];
  const waName = channels.whatsapp.templateName(template.key);
  if (
    channels.whatsapp.sender !== null &&
    waTemplate !== undefined &&
    waName !== undefined &&
    (await whatsappOptedIn(db, row.person_id))
  ) {
    try {
      await channels.whatsapp.sender.send(person.phone, {
        name: waName,
        template: waTemplate,
        params: whatsappParams(waTemplate, row.slots, person.name?.trim() || "there"),
        imageUrl: row.media_url,
      });
      await db
        .update(messageOutbox)
        .set({ status: "sent", channel: "whatsapp", sentAt: now, lastError: null })
        .where(eq(messageOutbox.id, row.id));
      return "sent";
    } catch (error) {
      if (error instanceof WhatsAppSendError && error.outcomeUnknown) {
        await settle(
          db,
          row.id,
          "failed",
          `WhatsApp: ${error.message} — delivery unknown, not retried or sent by SMS`,
        );
        return "failed";
      }
      whatsappError = `WhatsApp: ${error instanceof Error ? error.message : "send failed"}`;
    }
  }
  try {
    await channels.sms.send(person.phone, { template, slots: row.slots, body: row.body_text });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "send failed";
    if (error instanceof SmsSendError && error.breakerOpen) {
      await waitOutBreaker(db, row, now, reason);
      return "retrying";
    }
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
        nextAttemptAt: new Date(now.getTime() + backoffMs(row.attempts)),
      })
      .where(eq(messageOutbox.id, row.id));
    return "retrying";
  }
  await db
    .update(messageOutbox)
    // A WhatsApp failure that SMS covered stays on the row, so it is seen.
    .set({ status: "sent", sentAt: now, lastError: whatsappError })
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
