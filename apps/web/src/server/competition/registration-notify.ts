import type { RejectionReason } from "@desiauction/core";
import { auditLog, newId, people, registrations, type Db } from "@desiauction/db";
import { eq, inArray } from "drizzle-orm";

import { messageLanguagesOf } from "@desiauction/messaging/language";

import {
  drainOutbox,
  enqueueMail,
  enqueueSms,
  outboxOutcomes,
  type QueuedMail,
  type QueuedSms,
} from "../messaging/outbox";
import { registrationDecisionMail } from "../messaging/player-mail";
import type { PlayerSmsSender, TemplatedSms } from "../messaging/sms";
import {
  SMS_TEMPLATES,
  smsSeasonName,
  renderTemplate,
  type TemplateKey,
} from "../messaging/templates";
import type { TransactionalMailer } from "../messaging/transactional-mail";
import type { PersonalWhatsAppSender } from "../messaging/whatsapp";

/**
 * DA-35: THE LOOP DID NOT CLOSE. A registrant was rejected with reason
 * "ineligible" and what reached him was nothing — no SMS, no email, and a copy
 * line that admitted it ("Check back here"). The decision, its reason and its
 * audit row all existed; the human did not know.
 *
 * This module is the telling. It rides the personal-message queue (0079) like
 * every other moment — WhatsApp for a person who opted in, SMS where a gateway
 * exists, and an email for a verified address — so a decision obeys the same
 * opt-in, the same three-layer send gate and the same no-SMS rule as a sale
 * (messaging/outbox.ts, messaging/text-route.ts). Delivery is BEST EFFORT by
 * construction: the decision has already committed when we get here, and a
 * player who misses a message still has their status page, their Home card and
 * their inbox. A player whose approval was rolled back by a failed text has
 * nothing.
 */

/*
 * The SMS senders moved to messaging/sms.ts (the outbox needs them, and the
 * outbox importing this module that imports the outbox is a cycle). Re-exported
 * so every existing import of them from here still works.
 */
export {
  createPlayerSmsSender,
  DevInboxSmsSender,
  Msg91FlowSmsSender,
  SmsSendError,
  templateIdFromEnv,
  type HttpResponse,
  type Msg91FlowConfig,
  type PlayerSmsSender,
  type SmsTransport,
  type TemplatedSms,
} from "../messaging/sms";

// --- The copy ---------------------------------------------------------------

/** What a rejection reason means to the person it happened to. */
// Each fits one DLT variable (30 characters, templates.ts) — they are the only
// values that ever fill the rejection notice's {reason}, and the player's
// registration page shows the same words.
export const REASON_TO_PLAYER: Record<RejectionReason, string> = {
  duplicate: "you were already registered",
  ineligible: "eligibility rules were not met",
  withdrew: "you asked to withdraw",
  capacity: "the season is full",
  other: "no reason was given",
};

export type NotifiableEvent = "approve" | "reject" | "waitlist" | "withdraw" | "restore";

const TEMPLATE_FOR_EVENT: Readonly<Record<NotifiableEvent, TemplateKey>> = {
  approve: "registration.approved",
  waitlist: "registration.waitlisted",
  reject: "registration.rejected",
  withdraw: "registration.withdrawn",
  restore: "registration.restored",
};

/**
 * Choose the registered template and fill its slots.
 *
 * This used to build the whole sentence here. It does not any more: the text
 * belongs to the registry, because under DLT it belongs to the operator. What
 * is decided here is only WHICH shape and WHAT goes in the slots — and a slot
 * that will not fit is refused rather than truncated, because a silently
 * shortened tournament name is a support ticket and a refusal is a bug report.
 */
function messageFor(
  event: NotifiableEvent,
  competitionName: string,
  reason: RejectionReason | undefined,
): TemplatedSms | null {
  const template = SMS_TEMPLATES[TEMPLATE_FOR_EVENT[event]];
  // Shortened to one DLT variable rather than refused: a long season name
  // must never cost the player their notice.
  const competition = smsSeasonName(competitionName);
  const slots: Record<string, string> =
    event === "reject"
      ? { competition, reason: REASON_TO_PLAYER[reason ?? "other"] }
      : { competition };
  const rendered = renderTemplate(template, slots);
  if (!rendered.ok) {
    return null;
  }
  return { template, slots: rendered.slots, body: rendered.body };
}

/** What became of one person's notice, across its text and its email. */
export type NoticeOutcome =
  | { readonly state: "sent"; readonly channels: readonly string[] }
  | { readonly state: "failed"; readonly error: string }
  | { readonly state: "suppressed"; readonly reason: string }
  /** Still queued: a text held for the morning, or a retry. The drain finishes it. */
  | { readonly state: "pending" };

/**
 * One person's rows, read back after the drain, as one outcome. Pure.
 *
 * TOLD beats everything: a person whose text had no channel but whose email
 * went WAS told, and the organizer's timeline should say so rather than
 * "suppressed". Pending beats failed (it may yet go). And suppressed is only
 * the answer when nothing went and nothing will — the reason is the text's,
 * because that is the channel an organizer expects.
 */
export function noticeOutcome(
  rows: readonly {
    readonly channel: string;
    readonly status: string;
    readonly lastError: string | null;
  }[],
): NoticeOutcome {
  const sent = rows.filter((row) => row.status === "sent").map((row) => row.channel);
  if (sent.length > 0) {
    return { state: "sent", channels: sent };
  }
  if (rows.some((row) => row.status === "pending")) {
    return { state: "pending" };
  }
  const failed = rows.find((row) => row.status === "failed");
  if (failed !== undefined) {
    return { state: "failed", error: failed.lastError ?? "send failed" };
  }
  const text = rows.find((row) => row.channel !== "email") ?? rows[0];
  return { state: "suppressed", reason: text?.lastError ?? "nothing to send to" };
}

/** Injected by tests; omitted, the platform's own — as the drain would use. */
export interface NoticeChannels {
  readonly sms?: PlayerSmsSender | null;
  readonly whatsapp?: PersonalWhatsAppSender | null;
  readonly whatsappTemplate?: (key: string) => string | undefined;
  readonly mailer?: TransactionalMailer;
  /**
   * The pool the queue is written and drained on — the app pool, like every
   * other moment, and never the caller's org-scoped transaction: the drain
   * sets up its own tenant scope per row (outbox.ts `mayDeliver`).
   */
  readonly outboxDb?: Db;
  /** The drain's clock — the text window (no texts 10 pm – 8 am IST) reads it. */
  readonly now?: Date;
}

/**
 * Tell every affected player, and record whether they were told. The delivery
 * result is written to the ORG-scoped ledger against each registration, so it
 * appears on that player's timeline in the organizer's Details panel: an
 * organizer can see "we told them" or "we could not reach them" and act. The
 * person-scoped inbox notice is written separately by the aggregate.
 *
 * THROUGH THE QUEUE, delivered at once. Each person gets a text row (WhatsApp
 * or SMS, decided when it goes) and an email row, written to the outbox and
 * then drained right here for just these rows — so the ledger can still say
 * what happened, and this already runs after the organizer's response
 * (`notifyLater`). What the drain could not finish (a text held until 8 am, a
 * retry) is `pending`, and the scheduled drain completes it.
 */
export async function notifyDecision(
  db: Db,
  input: {
    orgId: string;
    competitionName: string;
    registrationIds: readonly string[];
    event: NotifiableEvent;
    reason?: RejectionReason;
    actorId: string;
  },
  channels: NoticeChannels = {},
): Promise<{ sent: number; failed: number; suppressed: number; pending: number }> {
  if (input.registrationIds.length === 0) {
    return { sent: 0, failed: 0, suppressed: 0, pending: 0 };
  }
  /*
   * THE LINK CARRIES NO SEASON, AND THAT IS THE FIX.
   *
   * This was `${PUBLIC_BASE_URL}/seasons/${slug}/register`, and the `{link}`
   * slot the operator gets is capped at 60 characters. Season slugs are
   * `slugifyName(name)` (sliced to 40) plus a four-character id suffix, so the
   * deep link ran to 85 characters at worst and 71 for a name as ordinary as
   * "Bandra Premier League 2027". Over the cap `renderTemplate` refuses,
   * `messageFor` returns null, and this function used to answer
   * `{sent: 0, failed: 0, suppressed: 0}` — so approving forty players told
   * forty nobody and reported it as nothing to do.
   *
   * A SHORTER DEEP LINK DOES NOT FIX IT, which is why the season is gone
   * rather than abbreviated. Every shape that carries the slug can still
   * overflow at the slug's own maximum: even `desiauction.in/c/<slug>` with no
   * scheme reaches 62. Only a link with no variable part in it is safe BY
   * CONSTRUCTION, and that is the property worth having here — a cap breach is
   * invisible from the organizer's side, so it must be impossible rather than
   * unlikely.
   *
   * The cost is one tap. `/home` lists the reader's registrations
   * (`myRegistrations`), and the message has already named the season in
   * `{competition}` — which was the whole complaint DA-35 made about the old
   * bare login wall, and it is answered by the SMS itself rather than by the
   * page it points at.
   */
  // v2: the link is fixed text in every template (templates.ts SMS_LINK).
  const body = messageFor(input.event, input.competitionName, input.reason);
  if (body === null) {
    /*
     * UNRENDERABLE IS A FAILURE, NOT A NO-OP.
     *
     * Returning zeros here is what made the bug above invisible: the organizer
     * read "0 notified, 0 failed" as "nobody needed telling". These people
     * needed telling and were not told, so they are counted FAILED — the one
     * number the organizer's toast already surfaces.
     *
     * Deliberately NOT `suppressed`. That word means "we decided not to text
     * this person" — they sent STOP, or they have no number — and it is a
     * settled state nobody needs to chase. This is the opposite: a template we
     * could not compose, which is ours to fix and nobody else's to notice.
     *
     * So it is also reported. A slot overrun is a configuration fault that no
     * amount of retrying clears, and it would otherwise reach us only as an
     * organizer wondering why their players are quiet.
     */
    const Sentry = await import("@sentry/nextjs");
    Sentry.captureException(
      new Error(`registration notice for "${input.event}" could not be rendered`),
      {
        tags: { area: "messaging", template: TEMPLATE_FOR_EVENT[input.event] },
        extra: { competitionNameLength: input.competitionName.length },
      },
    );
    return { sent: 0, failed: input.registrationIds.length, suppressed: 0, pending: 0 };
  }
  const rows = await db
    .select({
      id: registrations.id,
      phone: people.phone,
      personId: people.id,
      name: people.name,
    })
    .from(registrations)
    .innerJoin(people, eq(people.id, registrations.personId))
    .where(inArray(registrations.id, input.registrationIds as string[]));
  const kind = body.template.key;
  const templateRef = `${body.template.key}@${body.template.version}`;
  /*
   * One key per decision, not per registration: a player can be approved,
   * withdrawn and approved again, and the second approval is a new moment. The
   * key still makes this call's rows exactly-once in the queue — and is how
   * the drain below is pointed at them and nothing else.
   */
  const decision = newId();
  const keyOf = (registrationId: string) => `${kind}:${registrationId}:${decision}`;
  /*
   * NO PHONE, NO TEXT — and that is not a failure either.
   *
   * Since 0062 a person can be anchored by email alone, so `people.phone` can
   * be null. They get no text row; their email row, if they have a verified
   * address, still tells them, and if neither exists they are suppressed —
   * the decision still stands and their status page still shows it.
   *
   * (A player must supply a phone to register, so in practice this is the
   * organizer who added a row by hand for somebody who has not registered
   * yet — not a gap in player notification.)
   */
  const texts: QueuedSms[] = rows
    .filter((row) => row.phone !== null)
    .map((row) => ({
      personId: row.personId,
      orgId: input.orgId,
      kind,
      dedupeKey: `sms:${keyOf(row.id)}`,
      templateKey: kind,
      slots: body.slots,
    }));
  const languages = await messageLanguagesOf(
    db,
    rows.map((row) => row.personId),
  );
  const mails: QueuedMail[] = await Promise.all(
    rows.map(async (row) => ({
      personId: row.personId,
      orgId: input.orgId,
      kind,
      dedupeKey: keyOf(row.id),
      ...(await registrationDecisionMail(
        {
          name: row.name?.trim() || "there",
          season: input.competitionName.trim(),
          decision: input.event,
          ...(input.event === "reject"
            ? { reason: REASON_TO_PLAYER[input.reason ?? "other"] }
            : {}),
        },
        languages.get(row.personId) ?? "en",
      )),
    })),
  );
  // Undefined falls through to the queue's own default, the app pool.
  const outboxDb = channels.outboxDb;
  await enqueueSms(texts, outboxDb);
  await enqueueMail(mails, outboxDb);
  const keys = [...texts.map((text) => text.dedupeKey), ...mails.map((mail) => mail.dedupeKey)];
  /*
   * The consent gate is the drain's, not ours: STOP list, the person's topic
   * switch and the club's own switch, read inside the club's boundary
   * (`mayDeliver`), for the "registration" topic — the same three layers that
   * used to be checked here, now checked once, where every channel is decided.
   */
  await drainOutbox({
    ...(outboxDb === undefined ? {} : { db: outboxDb }),
    dedupeKeys: keys,
    limit: keys.length,
    ...(channels.sms === undefined ? {} : { sms: channels.sms }),
    ...(channels.whatsapp === undefined ? {} : { whatsapp: channels.whatsapp }),
    ...(channels.whatsappTemplate === undefined
      ? {}
      : { whatsappTemplate: channels.whatsappTemplate }),
    ...(channels.mailer === undefined ? {} : { mailer: channels.mailer }),
    ...(channels.now === undefined ? {} : { now: channels.now }),
  });
  const settled = await outboxOutcomes(keys, outboxDb);
  let sent = 0;
  let failed = 0;
  let suppressed = 0;
  let pending = 0;
  for (const row of rows) {
    const own = settled.filter(
      (message) =>
        message.dedupeKey === keyOf(row.id) || message.dedupeKey === `sms:${keyOf(row.id)}`,
    );
    const outcome = noticeOutcome(own);
    if (outcome.state === "pending") {
      // Nothing to write yet: the scheduled drain delivers it, and the queue
      // row is the record until then.
      pending += 1;
      continue;
    }
    if (outcome.state === "sent") sent += 1;
    else if (outcome.state === "failed") failed += 1;
    else suppressed += 1;
    try {
      await db.insert(auditLog).values({
        id: newId(),
        actor: input.actorId,
        action:
          outcome.state === "sent"
            ? "registration.notified"
            : outcome.state === "failed"
              ? "registration.notify_failed"
              : "registration.notify_suppressed",
        scopeType: "org",
        scopeId: input.orgId,
        subject: row.id,
        // Recorded so "why didn't they get it?" has an answer that is not a
        // shrug. A silent skip is indistinguishable from a bug.
        //
        // The template is named on every outcome, so per-shape delivery can be
        // counted across all three (admin/views.ts). A suppression rate that is
        // only knowable in aggregate hides the case that matters — one shape
        // being refused far more than the others.
        meta:
          outcome.state === "sent"
            ? { channel: outcome.channels.join("+"), template: templateRef }
            : outcome.state === "failed"
              ? { channel: "text", template: templateRef, error: outcome.error }
              : { channel: "text", reason: outcome.reason, template: templateRef },
      });
    } catch {
      // Evidence of a notification must never be the thing that fails a
      // decision that has already committed.
    }
  }
  return { sent, failed, suppressed, pending };
}
