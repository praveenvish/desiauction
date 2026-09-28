import { selectedProvider, type MailEnv } from "./mail-provider-config";
import { providerFetch, type ProviderResponse } from "./provider-fetch";
import { signRequest } from "./sigv4";

export {
  mailerConfigured,
  resendConfigured,
  selectedProvider,
  sesConfigured,
  type EmailProviderSetting,
  type MailEnv,
} from "./mail-provider-config";

/**
 * THE WIRE — the one place that knows a mail provider's API.
 *
 * Three senders send email (the code mailer, the transactional mailer, the
 * finops adapter) and each owns what is particular to it: a breaker, an
 * outcome vocabulary, an idempotency key, a retry rule. What they must NOT each
 * own is the provider's request format, because then changing provider is three
 * rewrites. It was — all three built Resend's JSON by hand — and moving to
 * Amazon SES is why this exists.
 *
 * Which provider is configuration (`EMAIL_PROVIDER`, `mailProviderFromEnv`),
 * so going back to Resend is an env edit and a restart, not a deploy.
 *
 * A provider NEVER throws for a refusal: it answers `{ ok: false }` with
 * whether a retry could help, because only it can read its own error format.
 * It DOES throw when the provider could not be reached at all — the callers
 * already tell "unreachable" apart, and keep doing so.
 */

export interface MailAttachment {
  readonly filename: string;
  readonly contentType: string;
  readonly contentBase64: string;
}

export interface MailRequest {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
  readonly html?: string;
  readonly replyTo?: string;
  readonly attachment?: MailAttachment;
  /**
   * Extra message headers — today only List-Unsubscribe and its one-click
   * partner (RFC 8058). Resend takes an object; SES a list of name/value pairs.
   */
  readonly headers?: Readonly<Record<string, string>>;
  /**
   * Labels the provider echoes back on delivery events (SES `EmailTags`).
   * Keys and values are reduced to what SES accepts; Resend ignores them.
   */
  readonly tags?: Readonly<Record<string, string>>;
  /**
   * Same on every attempt at one message, so a provider that honours it can
   * collapse a retry (Resend does; SES has no such header and sends again).
   */
  readonly idempotencyKey?: string;
}

export type MailProviderResult =
  | { readonly ok: true; readonly messageId: string | null }
  | {
      readonly ok: false;
      readonly status: number;
      /** The provider is busy, paused or melted — not the message's fault. */
      readonly retryable: boolean;
      /** Short and recipient-free: an error name or the provider's reason. */
      readonly detail: string;
    };

export interface MailProvider {
  readonly name: "resend" | "ses";
  send(mail: MailRequest): Promise<MailProviderResult>;
}

export type MailTransport = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<ProviderResponse>;

/** 5xx is the provider; 429 is us going too fast. Everything else is the message. */
function retryableStatus(status: number): boolean {
  return status >= 500 || status === 429;
}

// ---------------------------------------------------------------------------
// Resend — the request every sender used to build by hand, unchanged.

export interface ResendProviderConfig {
  readonly endpoint: string;
  readonly apiKey: string;
  readonly from: string;
  /** Header the provider authenticates with. Bearer is the common case. */
  readonly authHeader?: string;
  readonly authScheme?: string;
  /**
   * Header a retry is deduplicated on. `null` for a provider that has none —
   * the send is then at-least-once rather than carrying a header it rejects.
   */
  readonly idempotencyHeader?: string | null;
  readonly transport?: MailTransport;
  /** Escape hatch for a provider that wants a different body. */
  readonly buildRequest?: (mail: MailRequest, from: string) => unknown;
}

/** Resend's shape, which is also the intersection of Postmark and Brevo's. */
export function resendBody(mail: MailRequest, from: string): unknown {
  return {
    from,
    to: [mail.to],
    subject: mail.subject,
    text: mail.text,
    ...(mail.html === undefined ? {} : { html: mail.html }),
    // Omitted rather than sent empty: a blank reply_to is a header some
    // providers reject and every client renders badly.
    ...(mail.replyTo === undefined ? {} : { reply_to: mail.replyTo }),
    ...(mail.headers === undefined ? {} : { headers: mail.headers }),
    ...(mail.attachment === undefined
      ? {}
      : {
          attachments: [
            {
              filename: mail.attachment.filename,
              content: mail.attachment.contentBase64,
              contentType: mail.attachment.contentType,
            },
          ],
        }),
  };
}

export function createResendProvider(config: ResendProviderConfig): MailProvider {
  const transport = config.transport ?? providerFetch;
  const build = config.buildRequest ?? resendBody;
  const idempotencyHeader =
    config.idempotencyHeader === undefined ? "idempotency-key" : config.idempotencyHeader;
  return {
    name: "resend",
    async send(mail) {
      const headers: Record<string, string> = {
        "content-type": "application/json",
        [config.authHeader ?? "authorization"]:
          `${config.authScheme ?? "Bearer"} ${config.apiKey}`.trim(),
      };
      if (mail.idempotencyKey !== undefined && idempotencyHeader !== null) {
        headers[idempotencyHeader] = mail.idempotencyKey;
      }
      const response = await transport(config.endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify(build(mail, config.from)),
      });
      if (response.status >= 400) {
        return {
          ok: false,
          status: response.status,
          retryable: retryableStatus(response.status),
          // The provider's own reason — "domain not verified", "restricted
          // key" — is short and names no recipient. Bounded all the same.
          detail: response.body.slice(0, 200),
        };
      }
      return { ok: true, messageId: readString(response.body, "id") };
    },
  };
}

// ---------------------------------------------------------------------------
// Amazon SES — the v2 `SendEmail` JSON API, signed with SigV4.

export interface SesProviderConfig {
  readonly region: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  readonly from: string;
  /** Applies event publishing and reputation tracking; free, optional. */
  readonly configurationSet?: string;
  /**
   * Where SES emails bounce and complaint reports. The From address is a
   * no-reply on a subdomain with no mailbox, so without this they go nowhere a
   * person reads. Must be a verified SES identity.
   */
  readonly feedbackAddress?: string;
  readonly transport?: MailTransport;
  readonly now?: () => number;
}

/**
 * SES errors that mean "later", not "never". Throttling and a paused account
 * clear by themselves; the daily quota is a rolling 24 hours. Retried through
 * the callers' back-off and breaker, never in a tight loop here.
 */
const SES_RETRYABLE = new Set([
  "TooManyRequestsException",
  "ThrottlingException",
  "Throttling",
  "SendingPausedException",
  "LimitExceededException",
  "ServiceUnavailable",
  "ServiceUnavailableException",
  "InternalFailure",
  "InternalServerErrorException",
]);

/** SES's tag alphabet: ASCII letters, digits, `_` and `-`, at most 256. */
function sesTagText(text: string): string {
  return text.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 256);
}

export function sesBody(mail: MailRequest, config: SesProviderConfig): unknown {
  const utf8 = (data: string) => ({ Data: data, Charset: "UTF-8" });
  const tags = Object.entries(mail.tags ?? {})
    .filter(([name, value]) => name !== "" && value !== "")
    .map(([name, value]) => ({ Name: sesTagText(name), Value: sesTagText(value) }));
  return {
    FromEmailAddress: config.from,
    Destination: { ToAddresses: [mail.to] },
    ...(mail.replyTo === undefined ? {} : { ReplyToAddresses: [mail.replyTo] }),
    Content: {
      Simple: {
        // UTF-8 declared, so a Hindi subject is encoded by SES rather than
        // mangled — the 7-bit rule applies only to a subject without a charset.
        Subject: utf8(mail.subject),
        Body: {
          Text: utf8(mail.text),
          ...(mail.html === undefined ? {} : { Html: utf8(mail.html) }),
        },
        ...(mail.headers === undefined
          ? {}
          : {
              Headers: Object.entries(mail.headers).map(([Name, Value]) => ({ Name, Value })),
            }),
        ...(mail.attachment === undefined
          ? {}
          : {
              Attachments: [
                {
                  FileName: mail.attachment.filename,
                  ContentType: mail.attachment.contentType,
                  ContentDisposition: "ATTACHMENT",
                  RawContent: mail.attachment.contentBase64,
                },
              ],
            }),
      },
    },
    ...(tags.length === 0 ? {} : { EmailTags: tags }),
    ...(config.configurationSet === undefined
      ? {}
      : { ConfigurationSetName: config.configurationSet }),
    ...(config.feedbackAddress === undefined
      ? {}
      : { FeedbackForwardingEmailAddress: config.feedbackAddress }),
  };
}

/** `MessageRejected` from `x-amzn-errortype` or the body, whichever says. */
function sesErrorName(response: ProviderResponse): string {
  const header = response.headers?.["x-amzn-errortype"];
  const named = header ?? readString(response.body, "__type") ?? readString(response.body, "code");
  if (named === null) return "";
  // `MessageRejected:http://internal.amazon.com/...` and `ns#Name` both occur.
  return (named.split(":")[0] ?? "").split("#").pop() ?? "";
}

export function createSesProvider(config: SesProviderConfig): MailProvider {
  const transport = config.transport ?? providerFetch;
  const now = config.now ?? (() => Date.now());
  const url = `https://email.${config.region}.amazonaws.com/v2/email/outbound-emails`;
  return {
    name: "ses",
    async send(mail) {
      // No idempotency header exists on SES: a retry after a lost response
      // sends again. Accepted and documented (docs/EMAIL_INFRASTRUCTURE.md).
      const body = JSON.stringify(sesBody(mail, config));
      const headers = signRequest(
        { method: "POST", url, headers: { "content-type": "application/json" }, body },
        {
          region: config.region,
          service: "ses",
          accessKeyId: config.accessKeyId,
          secretAccessKey: config.secretAccessKey,
        },
        now(),
      );
      // `host` is signed but set by fetch itself from the URL.
      delete headers["host"];
      const response = await transport(url, { method: "POST", headers, body });
      if (response.status >= 400) {
        const name = sesErrorName(response);
        const message =
          readString(response.body, "message") ?? readString(response.body, "Message");
        return {
          ok: false,
          status: response.status,
          retryable: retryableStatus(response.status) || SES_RETRYABLE.has(name),
          detail: [name, message]
            .filter((part) => part !== "" && part !== null)
            .join(": ")
            .slice(0, 200),
        };
      }
      return { ok: true, messageId: readString(response.body, "MessageId") };
    },
  };
}

function readString(body: string, key: string): string | null {
  try {
    const value = (JSON.parse(body) as Record<string, unknown>)[key];
    return typeof value === "string" ? value : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Which one — from the environment, in every tier that sends.

const set = (value: string | undefined): value is string => value !== undefined && value !== "";

/** The provider the settings select, built; null when there is none. */
export function mailProviderFromEnv(
  env: MailEnv,
  options: { readonly transport?: MailTransport } = {},
): MailProvider | null {
  const transport = options.transport === undefined ? {} : { transport: options.transport };
  switch (selectedProvider(env)) {
    case "ses":
      return createSesProvider({
        region: env.SES_REGION ?? "",
        accessKeyId: env.SES_ACCESS_KEY_ID ?? "",
        secretAccessKey: env.SES_SECRET_ACCESS_KEY ?? "",
        from: env.EMAIL_FROM ?? "",
        ...(set(env.SES_CONFIGURATION_SET) ? { configurationSet: env.SES_CONFIGURATION_SET } : {}),
        ...(set(env.SES_FEEDBACK_ADDRESS) ? { feedbackAddress: env.SES_FEEDBACK_ADDRESS } : {}),
        ...transport,
      });
    case "resend":
      return createResendProvider({
        endpoint: env.EMAIL_API_ENDPOINT ?? "",
        apiKey: env.EMAIL_API_KEY ?? "",
        from: env.EMAIL_FROM ?? "",
        ...transport,
      });
    case null:
      return null;
  }
}
