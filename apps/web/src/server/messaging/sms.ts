import { newId, otpInbox, type Db } from "@desiauction/db";

import { env } from "../../env";
import { providerFetch } from "./provider-fetch";
import { SMS_TEMPLATES, type MessageTemplate } from "./templates";

/**
 * THE SMS SENDERS — the port, the MSG91 gateway, the dev inbox.
 *
 * Moved here from competition/registration-notify.ts, which re-exports them:
 * the registration notices now ride the outbox, and the outbox importing the
 * notifier that imports the outbox is the cycle the architecture gate refuses.
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
    /** No retry can deliver it — the shape has no registered template id. */
    readonly permanent = false,
  ) {
    super(message);
    this.name = "SmsSendError";
  }
}

// Deadline-bound (provider-fetch.ts): a stalled provider must not outlive the
// outbox's claim lease, or two drains deliver the same message.
const defaultTransport: SmsTransport = providerFetch;

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
        true,
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

/** The MSG91 template id configured for a template's env var, if any. */
export function templateIdFromEnv(variable: string): string | undefined {
  const value: unknown = (env as Readonly<Record<string, unknown>>)[variable];
  return typeof value === "string" && value !== "" ? value : undefined;
}

/**
 * THE SMS GATEWAY, OR NONE — and which, said out loud.
 *
 * SMS in India needs DLT registration before a single message can go, and
 * that is deferred (founder decision, 2026-09-23): WhatsApp on Meta's Cloud
 * API is the text channel. So there are three states, each visible:
 *
 *   · MSG91 set up — an auth key AND at least one template's DLT id. The real
 *     gateway, whichever provider sends the sign-in codes: codes on WhatsApp
 *     with SMS as the fallback for everything else is a valid deployment.
 *   · OTP_PROVIDER=dev — the dev inbox (/dev/inbox), locally and in the test
 *     harness, where a developer reads what would have gone. env.ts refuses
 *     that value on a production server.
 *   · anything else — NULL. There is no SMS, and the outbox marks a text it
 *     cannot put on WhatsApp `suppressed` with a `no_text_channel` reason
 *     (outbox.ts), while the moment's email still goes.
 *
 * The third state used to be the dev inbox as well: with OTP_PROVIDER=whatsapp
 * on a live server, every "SMS" was written to a table nobody reads and counted
 * as SENT. And the real gateway was chosen only under OTP_PROVIDER=msg91, so
 * the day MSG91 is registered alongside WhatsApp sign-in it would never have
 * been used. Neither is true now: configure MSG91 and the fallback returns.
 */
export function createPlayerSmsSender(
  db: Db,
  /**
   * The DLT id for a template key — the admin mapping, else the env var
   * (provider-templates.ts `templateResolver`). Omitted: the env var alone.
   */
  idFor?: (key: string) => string | undefined,
): PlayerSmsSender | null {
  // Read through `env`, never `process.env` — the validated surface is the only
  // one allowed outside env.ts (IP-0_DESIGN §11). A variable a template names
  // but env.ts does not declare fails templates.test ("names an env var that
  // env.ts actually declares"), not an undelivered message.
  //
  // Every template's id, read by the variable it names — NOT a hand-kept list.
  // The list was five registration shapes long, so the phone-change security
  // alert (sent through this same sender) had no id in production however it
  // was configured, and failed as "no DLT template registered". A template now
  // cannot be added without its id being looked up.
  //
  // `MSG91_TEMPLATE_ID` is deliberately NOT consulted: it is the OTP flow's id,
  // whose registered text has a code slot and no room for a sentence. A shape
  // with no id of its own raises a clear, non-retryable error naming the
  // variable, rather than sending against the wrong registration.
  const registered = (template: MessageTemplate): string | undefined =>
    idFor === undefined ? templateIdFromEnv(template.providerTemplateEnv) : idFor(template.key);
  const anyRegistered = Object.values(SMS_TEMPLATES).some(
    (template) => (registered(template) ?? "") !== "",
  );
  if (env.MSG91_AUTH_KEY !== undefined && anyRegistered) {
    return new Msg91FlowSmsSender({ authKey: env.MSG91_AUTH_KEY, providerTemplateId: registered });
  }
  if (env.OTP_PROVIDER === "dev") {
    return new DevInboxSmsSender(db);
  }
  return null;
}
