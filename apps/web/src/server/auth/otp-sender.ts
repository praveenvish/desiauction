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

export interface OtpSenderEnv {
  OTP_PROVIDER: "dev" | "msg91";
  MSG91_AUTH_KEY?: string | undefined;
  MSG91_TEMPLATE_ID?: string | undefined;
}

/** One construction point (used by auth actions): env picks the adapter. */
export function createOtpSenderFromEnv(env: OtpSenderEnv, db: Db): OtpSender {
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
