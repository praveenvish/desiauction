import { messageOutbox, newId, people, type Db } from "@desiauction/db";
import { eq, inArray, sql } from "drizzle-orm";
import { after } from "next/server";

import { verifiedEmailOf } from "../auth/email-change";
import { db as appDb } from "../db";
import { isNotificationKind, type NotificationKind } from "./catalogue";
import { notificationGate, type GateDecision, type GateInput } from "./gate";
import { platformVerdict } from "./platform-switches";
import { applyWhatsAppNudge, hasWhatsAppNudge } from "./email-layout";
import type { NotificationMail } from "./notification-email";
import { createPlayerSmsSender, SmsSendError, type PlayerSmsSender } from "./sms";
import { renderTemplate, SMS_TEMPLATES, type TemplateKey } from "./templates";
import { textFallback, type WhatsAppBlock } from "./text-route";
import {
  createWhatsAppSender,
  whatsappOptedIn,
  whatsappParams,
  whatsappTemplateName,
  WhatsAppSendError,
  META_MISSING_TRANSLATION,
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
 *
 * WHATSAPP FIRST (2026-09-23). SMS is deferred; a text row goes on WhatsApp to
 * a person who opted in, by SMS where a gateway exists, and otherwise nowhere —
 * `suppressed` as `no_text_channel`, the email row beside it unaffected
 * (text-route.ts has every branch).
 */

/**
 * A mail to queue: the moment, and words that came from the template registry
 * (`NotificationMail` — nothing else can construct one, so a queued subject
 * cannot have been written anywhere but notification-email.ts). Rendered in the
 * person's language when it is queued.
 */
export interface QueuedMail extends NotificationMail {
  readonly personId: string;
  readonly orgId: string | null;
  /** What happened — its catalogue entry (`auction.sold`, `team.appointed`, …). */
  readonly kind: NotificationKind;
  /** One per person per moment; a repeat is ignored. */
  readonly dedupeKey: string;
}

/** One line of SMS on a registered template (templates.ts). */
export interface QueuedSms {
  readonly personId: string;
  readonly orgId: string | null;
  readonly kind: NotificationKind;
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
        bodyHtml: mail.html ?? "",
      })),
    )
    .onConflictDoNothing({ target: messageOutbox.dedupeKey })
    .returning({ dedupeKey: messageOutbox.dedupeKey });
  return inserted.map((row) => row.dedupeKey);
}

/**
 * What became of these rows — for a caller that queued a moment and drained it
 * at once, and wants to record the outcome (competition/registration-notify.ts).
 */
export async function outboxOutcomes(
  dedupeKeys: readonly string[],
  db: Db = appDb,
): Promise<{ dedupeKey: string; channel: string; status: string; lastError: string | null }[]> {
  if (dedupeKeys.length === 0) {
    return [];
  }
  return db
    .select({
      dedupeKey: messageOutbox.dedupeKey,
      channel: messageOutbox.channel,
      status: messageOutbox.status,
      lastError: messageOutbox.lastError,
    })
    .from(messageOutbox)
    .where(inArray(messageOutbox.dedupeKey, [...dedupeKeys]));
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
  kind: string;
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
 * The gate reads `org_messaging_settings` — a club's "don't send" switch —
 * and that table is FORCE ROW LEVEL SECURITY, visible only where `app.org_id`
 * names its club. The drain works across every org on the bare app pool, so in
 * production the read saw no row, and "no row" means "enabled": a club that
 * switched auction mail off kept sending it. Locally the database owner
 * bypasses RLS and the switch worked, which is why no test noticed.
 *
 * So a row that belongs to a club has its consent read in a short transaction
 * scoped to that club, exactly as `withTenantDb` would set it up — and only the
 * reads: the provider call stays outside, so no connection is held across it.
 *
 * WHICH SWITCH STOPS A ROW is the catalogue's answer now, not a prefix test on
 * the kind: `scopeOf` here used to send everything that was not `registration.*` to
 * "auction", which would have filed the next kind anybody queued under the
 * wrong switch. A kind the catalogue does not know is refused, never guessed.
 */
function mayDeliver(
  db: Db,
  row: ClaimedRow,
  input: { contact: string; channel: GateInput["channel"] },
): Promise<GateDecision> {
  if (!isNotificationKind(row.kind)) {
    return Promise.resolve({ send: false, reason: "kind_not_catalogued" });
  }
  const gate: GateInput = {
    kind: row.kind,
    channel: input.channel,
    recipient: { personId: row.person_id, contact: input.contact },
  };
  const orgId = row.org_id;
  if (orgId === null) {
    return notificationGate(db, gate);
  }
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.person_id', ${row.person_id}, true)`);
    await tx.execute(sql`select set_config('app.org_id', ${orgId}, true)`);
    return notificationGate(tx, { ...gate, orgId });
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
    /**
     * Omitted: the platform's SMS gateway — which is null where there is none
     * (sms.ts), and then a text that cannot go on WhatsApp has no channel.
     */
    sms?: PlayerSmsSender | null;
    /** Omitted: the platform's (null when WhatsApp is not set up). */
    whatsapp?: PersonalWhatsAppSender | null;
    /** The approved template name for a key — injected by tests. */
    whatsappTemplate?: (key: string) => string | undefined;
    now?: Date;
    limit?: number;
    /** Only these people's rows — a test's own, in a shared database. */
    personIds?: readonly string[];
    /**
     * Only these rows: a caller delivering what it just queued, now, so it can
     * read back what became of each (competition/registration-notify.ts).
     */
    dedupeKeys?: readonly string[];
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
  const onlyKeys =
    options.dedupeKeys === undefined
      ? sql``
      : options.dedupeKeys.length === 0
        ? sql`and false`
        : sql`and dedupe_key in (${sql.join(
            options.dedupeKeys.map((key) => sql`${key}`),
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
      where status = 'pending' and next_attempt_at <= now() ${onlyPersons} ${onlyKeys}
      order by next_attempt_at
      limit ${limit}
      for update skip locked
    )
    returning id, person_id, org_id, kind, channel, subject, body_text, body_html,
              template_key, slots, media_url, attempts, ${LEASE_TOKEN} as lease
  `);

  let sent = 0;
  let suppressed = 0;
  let failed = 0;
  let retrying = 0;
  let skipped = 0;
  // Built on the first text row, once: `undefined` is "not asked yet", null is
  // "asked, and there is no SMS".
  let sms: PlayerSmsSender | null | undefined = options.sms;
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
      if (sms === undefined) sms = createPlayerSmsSender(db);
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
    const decision = await mayDeliver(db, row, { contact: email, channel: "email" });
    if (!decision.send) {
      await settle(db, row.id, "suppressed", decision.reason);
      suppressed += 1;
      continue;
    }
    /*
     * The WhatsApp nudge, decided now: a personal moment's mail (the layout
     * left a mark for it) carries "Get these on WhatsApp" for a person who has
     * not turned it on — and only where WhatsApp is actually set up, because
     * a switch that turns on nothing is not an offer worth making.
     */
    const nudge =
      whatsapp.sender !== null &&
      hasWhatsAppNudge(row.body_html) &&
      !(await whatsappOptedIn(db, row.person_id)).optedIn;
    const body = applyWhatsAppNudge({ text: row.body_text, html: row.body_html }, nudge);
    const outcome = await mailer.send({
      to: email,
      subject: row.subject,
      text: body.text,
      html: body.html,
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
  /** Null: no SMS gateway — see text-route.ts for what a text does then. */
  readonly sms: PlayerSmsSender | null;
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
  /*
   * Asked once for the TEXT, before the app is chosen: WhatsApp and SMS are one
   * row at the suppression, person and club layers (catalogue `rowChannelOf`),
   * because "stop texting me about auctions" means both apps. The category now
   * comes from the catalogue entry rather than the DLT template — the two agree
   * for every template today, and the catalogue is the one the admin edits.
   *
   * THE PLATFORM'S SWITCHES are per app, though (/admin/notifications): the
   * text is asked for as WhatsApp while the admin lets this kind out on
   * WhatsApp, and as SMS otherwise — so it is refused outright only when BOTH
   * apps are switched off, and an SMS fallback below asks for SMS again.
   */
  const whatsappVerdict = await platformVerdict(db, row.kind, "whatsapp");
  const decision = await mayDeliver(db, row, {
    contact: person.phone,
    channel: whatsappVerdict.enabled ? "whatsapp" : "sms",
  });
  if (!decision.send) {
    await settle(db, row.id, "suppressed", decision.reason);
    return "suppressed";
  }
  /*
   * WHATSAPP FIRST, for a person who opted in: the same moment, one ping. Only
   * when their latest answer is yes AND Meta has approved this template (its
   * name is configured) AND the account is set up. The STOP list and the topic
   * switches above have already been honoured: they are about being messaged
   * at all, whichever app it lands in.
   *
   * A WhatsApp that cannot be used is not the end of the moment: text-route.ts
   * decides — SMS in this same pass where a gateway exists (the row keeps the
   * WhatsApp error so the fallback is visible), and where none does, a
   * `no_text_channel` suppression, a wait for the breaker, or a retry.
   *
   * EXCEPT a timeout. A refusal or a dead connection means Meta never had the
   * message; a call that died on our deadline may well have been accepted and
   * be on the phone already. That is not "undeliverable", it is UNKNOWN — and
   * an SMS on top, or a retry, is the same moment twice. The queue's promise is
   * at most once, so the row stops here, failed with the reason spelled out;
   * the in-app inbox line the caller wrote still carries the moment.
   */
  const waTemplate = WHATSAPP_TEMPLATES[template.key];
  const waName = channels.whatsapp.templateName(template.key);
  let block: WhatsAppBlock;
  if (!whatsappVerdict.enabled) {
    block = { kind: "platform_off", reason: whatsappVerdict.reason };
  } else if (channels.whatsapp.sender === null) {
    block = { kind: "unconfigured" };
  } else if (waName === undefined) {
    block = { kind: "template_unset" };
  } else {
    const consent = await whatsappOptedIn(db, row.person_id);
    if (!consent.optedIn) {
      block = { kind: "not_opted_in" };
    } else {
      // Bound here, where they are narrowed: the closure below cannot see that.
      const sender = channels.whatsapp.sender;
      const phone = person.phone;
      const slots = row.slots;
      try {
        const sendIn = (language: typeof consent.language) =>
          sender.send(phone, {
            name: waName,
            template: waTemplate,
            params: whatsappParams(waTemplate, slots, person.name?.trim() || "there", language),
            imageUrl: row.media_url,
            language,
          });
        let receipt;
        try {
          receipt = await sendIn(consent.language);
        } catch (error) {
          // A Hindi reader whose template Meta has approved in English but not
          // yet in Hindi: send the English version rather than nothing. Meta
          // refused outright, so nothing went — this is not a duplicate.
          if (
            consent.language !== "en" &&
            error instanceof WhatsAppSendError &&
            error.failure === "refused" &&
            error.metaCode === META_MISSING_TRANSLATION
          ) {
            receipt = await sendIn("en");
          } else {
            throw error;
          }
        }
        // The wamid is what Meta's delivery callbacks name, so it is stored in
        // the same write that marks the row sent: a callback that arrives a
        // moment later always finds its row (/api/webhooks/whatsapp).
        await db
          .update(messageOutbox)
          .set({
            status: "sent",
            channel: "whatsapp",
            sentAt: now,
            lastError: null,
            providerMessageId: receipt.messageId,
            deliveryStatus: "sent",
          })
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
        const message = error instanceof Error ? error.message : "send failed";
        const failure = error instanceof WhatsAppSendError ? error.failure : "unavailable";
        block =
          failure === "breaker"
            ? { kind: "breaker_open", error: message }
            : failure === "refused"
              ? { kind: "refused", error: message }
              : { kind: "unavailable", error: message };
      }
    }
  }
  const route = textFallback(block, {
    smsAvailable: channels.sms !== null,
    attempts: row.attempts,
    maxAttempts: MAX_ATTEMPTS,
  });
  if (route.action === "suppress") {
    await settle(db, row.id, "suppressed", route.reason);
    return "suppressed";
  }
  if (route.action === "wait_breaker") {
    await waitOutBreaker(db, row, now, route.reason);
    return "retrying";
  }
  if (route.action === "retry") {
    await db
      .update(messageOutbox)
      .set({
        lastError: route.reason,
        nextAttemptAt: new Date(now.getTime() + backoffMs(row.attempts)),
      })
      .where(eq(messageOutbox.id, row.id));
    return "retrying";
  }
  // "sms" is only ever answered when a gateway exists; the check is for the
  // compiler, and settles honestly if that ever stops being true.
  const gateway = channels.sms;
  if (gateway === null) {
    await settle(db, row.id, "suppressed", "no_text_channel: no SMS gateway");
    return "suppressed";
  }
  // The text passed the gate as WhatsApp; SMS is its own switch.
  const smsVerdict = await platformVerdict(db, row.kind, "sms");
  if (!smsVerdict.enabled) {
    await settle(db, row.id, "suppressed", smsVerdict.reason);
    return "suppressed";
  }
  try {
    await gateway.send(person.phone, { template, slots: row.slots, body: row.body_text });
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
    .set({ status: "sent", sentAt: now, lastError: route.note })
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
