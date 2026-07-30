import type { RejectionReason } from "@desiauction/core";
import { auditLog, newId, otpInbox, people, registrations, type Db } from "@desiauction/db";
import { eq, inArray } from "drizzle-orm";

import { env } from "../../env";

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

export interface PlayerSmsSender {
  send(phone: string, message: string): Promise<void>;
}

/** Development delivery: messages land in the DB, rendered at /dev/inbox. */
export class DevInboxSmsSender implements PlayerSmsSender {
  constructor(private readonly db: Db) {}

  async send(phone: string, message: string): Promise<void> {
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
  readonly flowId: string;
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

  async send(phone: string, message: string): Promise<void> {
    if (this.breakerIsOpen()) {
      throw new SmsSendError("SMS provider unavailable (breaker open)", true);
    }
    const base = this.config.apiBase ?? MSG91_API_BASE;
    let failed: string | null = null;
    try {
      const response = await this.transport(`${base}/flow`, {
        method: "POST",
        headers: { authkey: this.config.authKey, "content-type": "application/json" },
        body: JSON.stringify({
          template_id: this.config.flowId,
          // Phones are stored E.164 (+91XXXXXXXXXX); MSG91 wants digits only.
          recipients: [{ mobiles: phone.replace(/^\+/, ""), message }],
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
  // The credential pair env.ts already validates. MSG91_TEMPLATE_ID must point
  // at a TRANSACTIONAL template for decision notices — see the beta checklist;
  // an OTP-only template will render the code slot, not the message.
  if (env.OTP_PROVIDER === "msg91" && env.MSG91_TEMPLATE_ID !== undefined) {
    return new Msg91FlowSmsSender({
      authKey: env.MSG91_AUTH_KEY ?? "",
      flowId: env.MSG91_TEMPLATE_ID,
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

function messageFor(
  event: NotifiableEvent,
  competitionName: string,
  link: string,
  reason: RejectionReason | undefined,
): string | null {
  switch (event) {
    case "approve":
      return `DesiAuction: You're approved for ${competitionName}. You're in the player pool for auction day. Details: ${link}`;
    case "waitlist":
      return `DesiAuction: You're on the waitlist for ${competitionName}. If a place opens the organizer moves waitlisted players up. Details: ${link}`;
    case "reject":
      return `DesiAuction: Your registration for ${competitionName} was not approved — ${REASON_TO_PLAYER[reason ?? "other"]}. Details: ${link}`;
    case "withdraw":
      return `DesiAuction: Your registration for ${competitionName} has been withdrawn. You can register again while intake is open. Details: ${link}`;
    case "restore":
      return `DesiAuction: Your registration for ${competitionName} is back under review. Details: ${link}`;
    default:
      return null;
  }
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
): Promise<{ sent: number; failed: number }> {
  if (input.registrationIds.length === 0) {
    return { sent: 0, failed: 0 };
  }
  const link = `${env.PUBLIC_BASE_URL}/seasons/${input.competitionSlug}/register`;
  const body = messageFor(input.event, input.competitionName, link, input.reason);
  if (body === null) {
    return { sent: 0, failed: 0 };
  }
  const rows = await db
    .select({ id: registrations.id, phone: people.phone })
    .from(registrations)
    .innerJoin(people, eq(people.id, registrations.personId))
    .where(inArray(registrations.id, input.registrationIds as string[]));
  const delivery = sender ?? createPlayerSmsSender(db);
  let sent = 0;
  let failed = 0;
  for (const row of rows) {
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
        meta: error === null ? { channel: "sms" } : { channel: "sms", error },
      });
    } catch {
      // Evidence of a notification must never be the thing that fails a
      // decision that has already committed.
    }
  }
  return { sent, failed };
}
