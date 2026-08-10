import type { RejectionReason } from "@desiauction/core";
import { auditLog, newId, otpInbox, people, registrations, type Db } from "@desiauction/db";
import { eq, inArray } from "drizzle-orm";

import { env } from "../../env";
import { maySend } from "../messaging/consent";
import {
  SMS_TEMPLATES,
  renderTemplate,
  type MessageTemplate,
  type TemplateKey,
} from "../messaging/templates";

/**
 * DA-35: THE LOOP DID NOT CLOSE. A registrant was rejected with reason
 * "ineligible" and what reached him was nothing — no SMS, no email, and a copy
 * line that admitted it ("Check back here"). The decision, its reason and its
 * audit row all existed; the human did not know.
 *
 * This module is the telling. It rides the SAME adapter idiom as the PX-3 OTP
 * sender — a port, an injected transport, a circuit breaker — because one
 * melted provider must not turn a bulk approval of 400 people into a paid-SMS
 * amplifier. Delivery is BEST EFFORT by construction: the decision has already
 * committed when we get here, and a player who misses a text still has their
 * status page, their Home card and their inbox. A player whose approval was
 * rolled back by a failed text has nothing.
 */

/**
 * What actually goes to a provider: a registered template, the values for its
 * declared slots, and the locally-rendered text.
 *
 * The rendered `body` is NOT what a real gateway sends — under DLT the operator
 * holds the fixed text and renders it from the slots. We keep it for the dev
 * inbox, for previews, and so a human reading a log can see what the recipient
 * would have read. Sending it as the message is precisely the defect this
 * replaces; see server/messaging/templates.ts.
 */
export interface TemplatedSms {
  readonly template: MessageTemplate;
  readonly slots: Readonly<Record<string, string>>;
  readonly body: string;
}

export interface PlayerSmsSender {
  send(phone: string, message: TemplatedSms): Promise<void>;
}

/** Development delivery: messages land in the DB, rendered at /dev/inbox. */
export class DevInboxSmsSender implements PlayerSmsSender {
  constructor(private readonly db: Db) {}

  async send(phone: string, message: TemplatedSms): Promise<void> {
    return this.write(phone, message.body);
  }

  private async write(phone: string, message: string): Promise<void> {
    // `code` is the inbox's message column; a decision notice is not a code, but
    // it is the same "what did this number receive" question a developer asks.
    await this.db.insert(otpInbox).values({ id: newId(), phone, code: message });
  }
}

export interface HttpResponse {
  readonly status: number;
  readonly body: string;
}

export type SmsTransport = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string },
) => Promise<HttpResponse>;

export interface Msg91FlowConfig {
  readonly authKey: string;
  /**
   * Resolves a template to the DLT id registered for THAT shape. There is no
   * single `flowId` any more: one id shared across five message shapes cannot
   * satisfy DLT, which registers one template per shape — and the same id was
   * also being shared with the OTP sender, whose registered text has a code
   * slot and no room for a sentence.
   */
  readonly providerTemplateId: (template: MessageTemplate) => string | undefined;
  readonly apiBase?: string;
  readonly transport?: SmsTransport;
  readonly now?: () => number;
  readonly breakerThreshold?: number;
  readonly breakerCooldownMs?: number;
}

const MSG91_API_BASE = "https://control.msg91.com/api/v5";
const DEFAULT_BREAKER_THRESHOLD = 3;
const DEFAULT_BREAKER_COOLDOWN_MS = 60 * 1000;

export class SmsSendError extends Error {
  constructor(
    message: string,
    readonly breakerOpen: boolean,
  ) {
    super(message);
    this.name = "SmsSendError";
  }
}

const defaultTransport: SmsTransport = async (url, init) => {
  const response = await fetch(url, init);
  return { status: response.status, body: await response.text() };
};

/**
 * MSG91 Flow (v5) transactional SMS: the OTP endpoint sends codes, this one
 * sends messages. Same breaker contract as Msg91OtpSender — N consecutive
 * failures open it, a cooldown passes, the next send is the probe.
 */
export class Msg91FlowSmsSender implements PlayerSmsSender {
  private readonly transport: SmsTransport;
  private readonly now: () => number;
  private readonly threshold: number;
  private readonly cooldownMs: number;
  private consecutiveFailures = 0;
  private openedAt: number | null = null;

  constructor(private readonly config: Msg91FlowConfig) {
    this.transport = config.transport ?? defaultTransport;
    this.now = config.now ?? (() => Date.now());
    this.threshold = config.breakerThreshold ?? DEFAULT_BREAKER_THRESHOLD;
    this.cooldownMs = config.breakerCooldownMs ?? DEFAULT_BREAKER_COOLDOWN_MS;
  }

  breakerIsOpen(): boolean {
    if (this.openedAt === null) {
      return false;
    }
    return this.now() - this.openedAt < this.cooldownMs;
  }

  async send(phone: string, message: TemplatedSms): Promise<void> {
    if (this.breakerIsOpen()) {
      throw new SmsSendError("SMS provider unavailable (breaker open)", true);
    }
    const providerTemplateId = this.config.providerTemplateId(message.template);
    if (providerTemplateId === undefined || providerTemplateId === "") {
      // Not a transport failure and not retryable: this shape has no registered
      // template, so no amount of retrying will deliver it. Name the shape and
      // the env var so the fix is obvious from the log line alone.
      throw new SmsSendError(
        `no DLT template registered for ${message.template.key} (set ${message.template.providerTemplateEnv})`,
        false,
      );
    }
    const base = this.config.apiBase ?? MSG91_API_BASE;
    let failed: string | null = null;
    try {
      const response = await this.transport(`${base}/flow`, {
        method: "POST",
        headers: { authkey: this.config.authKey, "content-type": "application/json" },
        body: JSON.stringify({
          // The id registered for THIS shape, and the slots as named variables.
          // The whole sentence used to travel here as a single `message`
          // variable, which DLT cannot match against a registered template —
          // the gateway scrubs it and the dev inbox never showed the difference.
          template_id: providerTemplateId,
          // Phones are stored E.164 (+91XXXXXXXXXX); MSG91 wants digits only.
          recipients: [{ mobiles: phone.replace(/^\+/, ""), ...message.slots }],
        }),
      });
      if (response.status >= 400 || response.body.includes('"type":"error"')) {
        failed = `provider rejected send (status ${String(response.status)})`;
      }
    } catch {
      failed = "provider unreachable";
    }
    if (failed !== null) {
      this.consecutiveFailures += 1;
      if (this.consecutiveFailures >= this.threshold) {
        this.openedAt = this.now();
      }
      throw new SmsSendError(failed, false);
    }
    this.consecutiveFailures = 0;
    this.openedAt = null;
  }
}

/**
 * One construction point. The real provider is selected only when the platform
 * is already sending real SMS (OTP_PROVIDER=msg91) AND a transactional flow id
 * is configured; otherwise messages land in the dev inbox, where they are
 * VISIBLE rather than silently dropped. There is no third state in which a
 * decision goes untold.
 */
export function createPlayerSmsSender(db: Db): PlayerSmsSender {
  /*
   * The real provider is selected when the platform is sending real SMS AND at
   * least one decision template has a registered DLT id.
   *
   * `MSG91_TEMPLATE_ID` is deliberately NOT consulted here any more. It is the
   * OTP flow's id — its registered text has a code slot and no room for a
   * sentence — and it was being reused for all five decision notices, which is
   * both a DLT mismatch and the reason a decision SMS would arrive as a
   * mangled OTP. Each shape now reads its own env var, named on the template.
   *
   * A shape with no id configured raises a clear, non-retryable error naming
   * the variable, rather than sending against the wrong registration.
   */
  // Read through `env`, never `process.env` — the validated surface is the only
  // one allowed outside env.ts (IP-0_DESIGN §11), and it is also what makes a
  // typo in a variable name a compile error instead of an undelivered message.
  const ids: Readonly<Record<string, string | undefined>> = {
    MSG91_TEMPLATE_REGISTRATION_APPROVED: env.MSG91_TEMPLATE_REGISTRATION_APPROVED,
    MSG91_TEMPLATE_REGISTRATION_WAITLISTED: env.MSG91_TEMPLATE_REGISTRATION_WAITLISTED,
    MSG91_TEMPLATE_REGISTRATION_REJECTED: env.MSG91_TEMPLATE_REGISTRATION_REJECTED,
    MSG91_TEMPLATE_REGISTRATION_WITHDRAWN: env.MSG91_TEMPLATE_REGISTRATION_WITHDRAWN,
    MSG91_TEMPLATE_REGISTRATION_RESTORED: env.MSG91_TEMPLATE_REGISTRATION_RESTORED,
  };
  const registered = (template: MessageTemplate): string | undefined =>
    ids[template.providerTemplateEnv];
  const anyRegistered = Object.values(SMS_TEMPLATES).some(
    (template) => (registered(template) ?? "") !== "",
  );
  if (env.OTP_PROVIDER === "msg91" && anyRegistered) {
    return new Msg91FlowSmsSender({
      authKey: env.MSG91_AUTH_KEY ?? "",
      providerTemplateId: registered,
    });
  }
  return new DevInboxSmsSender(db);
}

// --- The copy ---------------------------------------------------------------

/** What a rejection reason means to the person it happened to. */
export const REASON_TO_PLAYER: Record<RejectionReason, string> = {
  duplicate: "you were already registered for this season",
  ineligible: "you did not meet this season's eligibility rules",
  withdrew: "you asked to withdraw",
  capacity: "the season filled up",
  other: "the organizer did not give a specific reason",
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
  link: string,
  reason: RejectionReason | undefined,
): TemplatedSms | null {
  const template = SMS_TEMPLATES[TEMPLATE_FOR_EVENT[event]];
  const slots: Record<string, string> =
    event === "reject"
      ? { competition: competitionName, reason: REASON_TO_PLAYER[reason ?? "other"], link }
      : { competition: competitionName, link };
  const rendered = renderTemplate(template, slots);
  if (!rendered.ok) {
    return null;
  }
  return { template, slots: rendered.slots, body: rendered.body };
}

/**
 * Tell every affected player, and record whether they were told. The delivery
 * result is written to the ORG-scoped ledger against each registration, so it
 * appears on that player's timeline in the organizer's Details panel: an
 * organizer can see "we told them" or "we could not reach them" and act. The
 * person-scoped inbox notice is written separately by the aggregate.
 */
export async function notifyDecision(
  db: Db,
  input: {
    orgId: string;
    competitionSlug: string;
    competitionName: string;
    registrationIds: readonly string[];
    event: NotifiableEvent;
    reason?: RejectionReason;
    actorId: string;
  },
  sender?: PlayerSmsSender,
): Promise<{ sent: number; failed: number; suppressed: number }> {
  if (input.registrationIds.length === 0) {
    return { sent: 0, failed: 0, suppressed: 0 };
  }
  const link = `${env.PUBLIC_BASE_URL}/seasons/${input.competitionSlug}/register`;
  const body = messageFor(input.event, input.competitionName, link, input.reason);
  if (body === null) {
    return { sent: 0, failed: 0, suppressed: 0 };
  }
  const rows = await db
    .select({ id: registrations.id, phone: people.phone, personId: people.id })
    .from(registrations)
    .innerJoin(people, eq(people.id, registrations.personId))
    .where(inArray(registrations.id, input.registrationIds as string[]));
  const delivery = sender ?? createPlayerSmsSender(db);
  let sent = 0;
  let failed = 0;
  let suppressed = 0;
  for (const row of rows) {
    /*
     * The consent gate, before the send and not after it.
     *
     * A decision notice is transactional — it is the direct consequence of
     * something this person did — so it needs no opt-in. What it must honour is
     * a STOP, and until now there was nothing to honour it with: no
     * suppression list, no opt-out, no STOP handling anywhere in the product.
     *
     * A suppressed person is NOT a failure. Their decision still stands, their
     * status page still shows it, and counting them as failed would send an
     * organizer chasing a delivery problem that does not exist.
     */
    const decision = await maySend(db, {
      contact: row.phone,
      channel: "sms",
      category: body.template.category,
      scope: "registration",
      personId: row.personId,
      // The club's own switch. Passing it is what makes the organizer's
      // Notifications tab do something rather than describe an intention.
      orgId: input.orgId,
    });
    if (!decision.send) {
      suppressed += 1;
      try {
        await db.insert(auditLog).values({
          id: newId(),
          actor: input.actorId,
          action: "registration.notify_suppressed",
          scopeType: "org",
          scopeId: input.orgId,
          subject: row.id,
          // Recorded so "why didn't they get it?" has an answer that is not a
          // shrug. A silent skip is indistinguishable from a bug.
          //
          // The template is named here as well as on the sent and failed rows,
          // so per-shape delivery can be counted across all three outcomes. A
          // suppression rate that is only knowable in aggregate hides the case
          // that matters — one shape being refused far more than the others.
          meta: {
            channel: "sms",
            reason: decision.reason,
            template: `${body.template.key}@${body.template.version}`,
          },
        });
      } catch {
        // Same rule as below: evidence never fails a committed decision.
      }
      continue;
    }
    let error: string | null = null;
    try {
      await delivery.send(row.phone, body);
    } catch (cause) {
      error = cause instanceof Error ? cause.message : "send failed";
    }
    if (error === null) {
      sent += 1;
    } else {
      failed += 1;
    }
    try {
      await db.insert(auditLog).values({
        id: newId(),
        actor: input.actorId,
        action: error === null ? "registration.notified" : "registration.notify_failed",
        scopeType: "org",
        scopeId: input.orgId,
        subject: row.id,
        meta:
          error === null
            ? { channel: "sms", template: `${body.template.key}@${body.template.version}` }
            : { channel: "sms", template: `${body.template.key}@${body.template.version}`, error },
      });
    } catch {
      // Evidence of a notification must never be the thing that fails a
      // decision that has already committed.
    }
  }
  return { sent, failed, suppressed };
}
