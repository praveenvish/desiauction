import { newId, otpInbox, type Db } from "@desiauction/db";

// The ED-1 port: RC-1's real SMS provider becomes a second implementation
// of this interface — auth logic never changes (IP-2_DESIGN D3).
export interface OtpSender {
  send(phone: string, code: string): Promise<void>;
}

/** Development delivery: codes land in the DB, rendered at /dev/inbox. */
export class DevInboxSender implements OtpSender {
  constructor(private readonly db: Db) {}

  async send(phone: string, code: string): Promise<void> {
    await this.db.insert(otpInbox).values({ id: newId(), phone, code });
  }
}

// --- Production delivery (PX-3) ----------------------------------------------
// MSG91 OTP adapter behind the same port, in the platform's adapter idiom
// (razorpay.ts): NO SDK, an INJECTED transport, complete and testable without
// live credentials or network. A second SMS provider is another class here.

export interface HttpResponse {
  readonly status: number;
  readonly body: string;
}

export type SmsTransport = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string },
) => Promise<HttpResponse>;

export interface Msg91Config {
  readonly authKey: string;
  readonly templateId: string;
  readonly apiBase?: string;
  readonly transport?: SmsTransport;
  readonly now?: () => number;
  /** Circuit breaker: consecutive failures before opening (default 3). */
  readonly breakerThreshold?: number;
  /** How long the breaker stays open before a probe send (default 60s). */
  readonly breakerCooldownMs?: number;
}

const MSG91_API_BASE = "https://control.msg91.com/api/v5";
const DEFAULT_BREAKER_THRESHOLD = 3;
const DEFAULT_BREAKER_COOLDOWN_MS = 60 * 1000;

/** Send failed at the provider (or the breaker is open). The caller shows an
 * honest "couldn't send" — the code row is unusable and the user retries. */
export class OtpSendError extends Error {
  constructor(
    message: string,
    readonly breakerOpen: boolean,
  ) {
    super(message);
    this.name = "OtpSendError";
  }
}

const defaultTransport: SmsTransport = async (url, init) => {
  const response = await fetch(url, init);
  return { status: response.status, body: await response.text() };
};

/**
 * MSG91 Send-OTP (v5): POST /otp?template_id=…&mobile=91XXXXXXXXXX with the
 * code as a template variable; `authkey` header carries the credential.
 * The SMS-pumping circuit breaker (RC-4 condition 2) opens after N consecutive
 * provider failures and fails fast for a cooldown window — one melted provider
 * must not turn the login form into a paid-SMS amplifier.
 */
export class Msg91OtpSender implements OtpSender {
  private readonly transport: SmsTransport;
  private readonly now: () => number;
  private readonly threshold: number;
  private readonly cooldownMs: number;
  private consecutiveFailures = 0;
  private openedAt: number | null = null;

  constructor(private readonly config: Msg91Config) {
    this.transport = config.transport ?? defaultTransport;
    this.now = config.now ?? (() => Date.now());
    this.threshold = config.breakerThreshold ?? DEFAULT_BREAKER_THRESHOLD;
    this.cooldownMs = config.breakerCooldownMs ?? DEFAULT_BREAKER_COOLDOWN_MS;
  }

  /** Exposed for the ops surface: is the breaker currently refusing sends? */
  breakerIsOpen(): boolean {
    if (this.openedAt === null) {
      return false;
    }
    if (this.now() - this.openedAt >= this.cooldownMs) {
      // Half-open: the next send is the probe.
      return false;
    }
    return true;
  }

  async send(phone: string, code: string): Promise<void> {
    if (this.breakerIsOpen()) {
      throw new OtpSendError("SMS provider unavailable (breaker open)", true);
    }
    // Phones are stored E.164 (+91XXXXXXXXXX); MSG91 wants digits only.
    const mobile = phone.replace(/^\+/, "");
    const base = this.config.apiBase ?? MSG91_API_BASE;
    const url = `${base}/otp?template_id=${encodeURIComponent(this.config.templateId)}&mobile=${encodeURIComponent(mobile)}&otp=${encodeURIComponent(code)}&otp_expiry=5`;
    let failed: string | null = null;
    try {
      const response = await this.transport(url, {
        method: "POST",
        headers: { authkey: this.config.authKey, "content-type": "application/json" },
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
      throw new OtpSendError(failed, false);
    }
    this.consecutiveFailures = 0;
    this.openedAt = null;
  }
}

// --- WhatsApp Cloud API, direct to Meta (no BSP) -----------------------------
//
// THE SAME PORT, A CHEAPER AND BETTER CHANNEL.
//
// Doc C-19 has always said "WhatsApp OTP first with SMS fallback", and this is
// that first half. It talks to Meta's Cloud API DIRECTLY rather than through a
// Business Solution Provider, which matters twice over:
//
//   · COST. Meta hosts the Cloud API and charges no subscription or setup fee —
//     you pay only the per-message rate (India authentication: ₹0.1150 + GST).
//     Every BSP resells that exact rate with 10–30% on top plus a monthly
//     platform fee, so going direct is the floor. There is nothing cheaper to
//     move to later.
//   · DELIVERABILITY. A WhatsApp message is not subject to DND registries or
//     carrier filtering, which is what actually loses OTPs in India.
//
// Written in the platform's adapter idiom (razorpay.ts, and Msg91OtpSender
// above): NO SDK, an INJECTED transport, complete and testable with no live
// credentials and no network. It shares `SmsTransport`, `OtpSendError` and the
// breaker semantics with MSG91 on purpose — the auth flow cannot tell the two
// apart, which is what makes SMS a real fallback rather than a rewrite.

export interface WhatsAppCloudConfig {
  /** Meta phone number ID (NOT the phone number itself) from the WABA. */
  readonly phoneNumberId: string;
  /** Permanent system-user access token. */
  readonly accessToken: string;
  /** Approved AUTHENTICATION template name. */
  readonly templateName: string;
  /** Template locale as registered with Meta, e.g. "en" or "en_US". */
  readonly templateLanguage?: string;
  readonly apiBase?: string;
  readonly transport?: SmsTransport;
  readonly now?: () => number;
  readonly breakerThreshold?: number;
  readonly breakerCooldownMs?: number;
}

/**
 * Pinned, because Meta dates its Graph versions and an unpinned call silently
 * follows whatever they promote to "latest". An OTP path must not change shape
 * because a vendor shipped on a Tuesday.
 */
const WHATSAPP_API_BASE = "https://graph.facebook.com/v21.0";
const DEFAULT_TEMPLATE_LANGUAGE = "en";

/**
 * Meta Cloud API, authentication template.
 *
 * An authentication template takes the code TWICE: once as the body variable
 * that renders in the bubble, and once as the copy-code button's payload. Both
 * are positional, and sending only one is the commonest way this returns 200
 * with a message nobody can act on.
 */
export class WhatsAppCloudOtpSender implements OtpSender {
  private readonly transport: SmsTransport;
  private readonly now: () => number;
  private readonly threshold: number;
  private readonly cooldownMs: number;
  private consecutiveFailures = 0;
  private openedAt: number | null = null;

  constructor(private readonly config: WhatsAppCloudConfig) {
    this.transport = config.transport ?? defaultTransport;
    this.now = config.now ?? (() => Date.now());
    this.threshold = config.breakerThreshold ?? DEFAULT_BREAKER_THRESHOLD;
    this.cooldownMs = config.breakerCooldownMs ?? DEFAULT_BREAKER_COOLDOWN_MS;
  }

  /** Exposed for the ops surface: is the breaker currently refusing sends? */
  breakerIsOpen(): boolean {
    if (this.openedAt === null) {
      return false;
    }
    if (this.now() - this.openedAt >= this.cooldownMs) {
      // Half-open: the next send is the probe.
      return false;
    }
    return true;
  }

  async send(phone: string, code: string): Promise<void> {
    if (this.breakerIsOpen()) {
      throw new OtpSendError("WhatsApp provider unavailable (breaker open)", true);
    }
    // Phones are stored E.164 (+91XXXXXXXXXX); Meta wants digits, no plus.
    const to = phone.replace(/^\+/, "");
    const base = this.config.apiBase ?? WHATSAPP_API_BASE;
    const url = `${base}/${encodeURIComponent(this.config.phoneNumberId)}/messages`;
    const payload = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to,
      type: "template",
      template: {
        name: this.config.templateName,
        language: { code: this.config.templateLanguage ?? DEFAULT_TEMPLATE_LANGUAGE },
        components: [
          // The code as it renders in the message body.
          { type: "body", parameters: [{ type: "text", text: code }] },
          // And again as the copy-code button's payload. Meta requires the
          // button component on an authentication template; omitting it is
          // accepted and produces a message with a dead button.
          {
            type: "button",
            sub_type: "url",
            index: "0",
            parameters: [{ type: "text", text: code }],
          },
        ],
      },
    };

    let failed: string | null = null;
    try {
      const response = await this.transport(url, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.config.accessToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(payload),
      });
      /*
       * Meta answers 200 with an `error` object for some rejections rather than
       * an HTTP error status, so the body is read as well as the status — the
       * same defensive shape `Msg91OtpSender` uses for `"type":"error"`. A send
       * that is accepted-but-refused must count as a failure, or the breaker
       * never trips and the login form keeps paying for undelivered messages.
       */
      if (response.status >= 400 || response.body.includes('"error"')) {
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
      throw new OtpSendError(failed, false);
    }
    this.consecutiveFailures = 0;
    this.openedAt = null;
  }
}

export interface OtpSenderEnv {
  OTP_PROVIDER: "dev" | "msg91" | "whatsapp";
  MSG91_AUTH_KEY?: string | undefined;
  MSG91_TEMPLATE_ID?: string | undefined;
  WHATSAPP_PHONE_NUMBER_ID?: string | undefined;
  WHATSAPP_ACCESS_TOKEN?: string | undefined;
  WHATSAPP_TEMPLATE_NAME?: string | undefined;
  WHATSAPP_TEMPLATE_LANGUAGE?: string | undefined;
}

/** One construction point (used by auth actions): env picks the adapter. */
export function createOtpSenderFromEnv(env: OtpSenderEnv, db: Db): OtpSender {
  if (env.OTP_PROVIDER === "whatsapp") {
    // As with msg91: env.ts refuses to boot when whatsapp is selected without
    // credentials, so these fallbacks are unreachable rather than lenient.
    return new WhatsAppCloudOtpSender({
      phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID ?? "",
      accessToken: env.WHATSAPP_ACCESS_TOKEN ?? "",
      templateName: env.WHATSAPP_TEMPLATE_NAME ?? "",
      ...(env.WHATSAPP_TEMPLATE_LANGUAGE !== undefined
        ? { templateLanguage: env.WHATSAPP_TEMPLATE_LANGUAGE }
        : {}),
    });
  }
  if (env.OTP_PROVIDER === "msg91") {
    // env.ts refuses to boot when msg91 is selected without credentials,
    // so the non-null assertions here are guarded by validation.
    return new Msg91OtpSender({
      authKey: env.MSG91_AUTH_KEY ?? "",
      templateId: env.MSG91_TEMPLATE_ID ?? "",
    });
  }
  return new DevInboxSender(db);
}
