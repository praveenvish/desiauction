import { newId, otpInbox, type Db } from "@desiauction/db";

import type { MessageLanguage } from "@desiauction/messaging/email-templates";
import {
  createResendProvider,
  mailProviderFromEnv,
  type MailProvider,
  type MailProviderResult,
} from "@desiauction/messaging/mail-provider";

import { env } from "../../env";
import { renderNotificationEmail, type NotificationMail } from "../messaging/notification-email";
import { providerFetch } from "../messaging/provider-fetch";
import { requestDetails, type RequestContext } from "../messaging/request-context";

/**
 * Sending a verification code to a mailbox.
 *
 * A port with two implementations, the same shape `OtpSender` has had since
 * PX-3, and for the same reason: the provider is a founder decision that is
 * still open (SES, Postmark, Brevo, MSG91's own — messaging plan §8 decision 4),
 * and the flow must be complete and testable before that decision lands.
 *
 * The dev implementation writes to the SAME `/dev/inbox` the sign-in codes go
 * to. It is visibly a development path rather than a silent drop: the whole
 * point of the outbox this replaces elsewhere was that "delivered" meant "a
 * file exists on a disk nobody reads", and a verification code that vanishes
 * would leave a person staring at a form that can never be completed.
 */
/**
 * WHAT THE CODE IS FOR, because the message has to say so honestly.
 *
 * Sign-in reused the confirmation mail at first, so a person asking to log in
 * got "Confirm your email for DesiAuction". That is not a cosmetic mismatch:
 * account mail whose subject does not match what you just did is how people
 * learn to ignore account mail, and it hands anyone who can trigger a login
 * code a ready-made cover story.
 */
export type CodeMailPurpose = "email_change" | "login" | "signup";

/** What the provider said about a code mail it accepted. */
export interface CodeMailReceipt {
  readonly providerMessageId: string | null;
}

export interface CodeMailer {
  /**
   * Resolves with the provider's receipt, or null when nothing was sent (the
   * dev inbox). Throws `MailSendError` when a real send failed.
   */
  send(
    email: string,
    code: string,
    purpose: CodeMailPurpose,
    language?: MessageLanguage,
    /** Where and when the code was asked for — shown so a stranger's request is obvious. */
    context?: RequestContext,
  ): Promise<CodeMailReceipt | null>;
}

/**
 * Subject and body per purpose — the only thing that differs between them.
 *
 * The words are the template registry's (`auth.email_code`, one variant per
 * purpose): sign-in codes are never switched off, but their wording may be
 * edited — with the `{{code}}` placeholder and the expiry line locked in
 * (email-template-defaults.ts). A DIFFERENT PERSON reads the sign-up mail:
 * "sign-in code" to somebody who has no account reads as a mistake or a
 * breach, which is why it is a variant of its own and not a word swapped.
 */
export function codeMailCopy(
  code: string,
  purpose: CodeMailPurpose,
  language: MessageLanguage = "en",
  context?: RequestContext,
): Promise<NotificationMail> {
  return renderNotificationEmail(
    "auth.email_code",
    language,
    { code },
    {
      variant: purpose,
      code,
      ...(context === undefined ? {} : { details: requestDetails(context, "code", language) }),
    },
  );
}

export class DevInboxMailer implements CodeMailer {
  constructor(private readonly db: Db) {}

  /*
   * The port's third argument decides the WORDING of a message. The dev inbox
   * stores a code against a contact and sends nothing, so there is no wording
   * to pick — but the signature has to match the port, or the two
   * implementations stop being interchangeable.
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async send(email: string, code: string, _purpose: CodeMailPurpose): Promise<null> {
    // `phone` is the inbox's contact column. It holds an address here, which is
    // honest for a development surface whose question is "what did this contact
    // receive" — and is exactly why the production verification codes live in
    // their own table rather than in `otp_codes`.
    await this.db.insert(otpInbox).values({ id: newId(), phone: email, code });
    return null;
  }
}

export interface MailerHttpResponse {
  readonly status: number;
  readonly body: string;
}

export type MailTransport = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<MailerHttpResponse>;

export class MailSendError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MailSendError";
  }
}

/**
 * The real one, over the provider's HTTP API — no new dependency, the same
 * decision `email-adapter.ts` documents at length. Which provider (SES or
 * Resend) and its request format live in mail-provider.ts; Resend settings are
 * still accepted here directly, which is how the tests spell it.
 */
export class HttpMailer implements CodeMailer {
  private readonly provider: MailProvider;

  constructor(
    config:
      | { readonly provider: MailProvider }
      | { endpoint: string; apiKey: string; from: string; transport?: MailTransport },
  ) {
    this.provider =
      "provider" in config
        ? config.provider
        : createResendProvider({
            endpoint: config.endpoint,
            apiKey: config.apiKey,
            from: config.from,
            // Deadline-bound (provider-fetch.ts) unless a test stands in.
            transport: config.transport ?? providerFetch,
          });
  }

  async send(
    email: string,
    code: string,
    purpose: CodeMailPurpose,
    language: MessageLanguage = "en",
    context?: RequestContext,
  ): Promise<CodeMailReceipt> {
    const copy = await codeMailCopy(code, purpose, language, context);
    let result: MailProviderResult;
    try {
      result = await this.provider.send({
        to: email,
        subject: copy.subject,
        // No link, either purpose. A code the person types back proves the
        // same thing a click does, cannot be followed out of a forwarded
        // message, and does not train people to click links in mail about
        // their account. The branded part is the same mail laid out
        // (email-layout.ts, noLinks) — it carries no link either.
        text: copy.text,
        ...(copy.html === undefined ? {} : { html: copy.html }),
      });
    } catch (error) {
      // The CAUSE is the diagnosis. "unreachable" alone hid a corporate TLS
      // proxy (SELF_SIGNED_CERT_IN_CHAIN) behind "couldn't send" for a whole
      // afternoon. A code or message, never the request (it carries the key).
      const cause =
        error instanceof Error
          ? ((error.cause as { code?: string } | undefined)?.code ?? error.message)
          : "unknown";
      throw new MailSendError(`mail provider unreachable (${cause})`);
    }
    if (!result.ok) {
      // The provider's own reason — "domain not verified", "restricted key",
      // SES's `MessageRejected: …` — short, recipient-free and bounded.
      throw new MailSendError(
        `mail provider rejected send (${String(result.status)}: ${result.detail})`,
      );
    }
    return { providerMessageId: result.messageId };
  }
}

/**
 * One construction point. The real mailer is selected only when the provider
 * `EMAIL_PROVIDER` names is fully configured (mail-provider.ts); otherwise
 * codes land in the dev inbox, VISIBLY, rather than being half-sent by a
 * partly-configured provider.
 */
export function createCodeMailer(db: Db): CodeMailer {
  // Explicit beats inferred. `dev` forces the inbox even when real credentials
  // are present — which is the only way a PRODUCTION-shaped build (the e2e
  // suite) can exercise an email flow without deleting them. `auto` is the
  // historical behaviour and stays the default, so nothing existing moves.
  if (env.EMAIL_PROVIDER === "dev") {
    return new DevInboxMailer(db);
  }
  const provider = mailProviderFromEnv(env);
  if (provider === null) {
    // Named a provider and left it half set up: say so, never fall back.
    if (env.EMAIL_PROVIDER !== "auto") {
      throw new MailSendError(`EMAIL_PROVIDER=${env.EMAIL_PROVIDER} is not fully configured`);
    }
    return new DevInboxMailer(db);
  }
  return new HttpMailer({ provider });
}
