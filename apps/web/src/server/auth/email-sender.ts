import { newId, otpInbox, type Db } from "@desiauction/db";

import { env } from "../../env";

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
export type CodeMailPurpose = "email_change" | "login";

export interface CodeMailer {
  send(email: string, code: string, purpose: CodeMailPurpose): Promise<void>;
}

/** Subject and body per purpose — the only thing that differs between them. */
export function codeMailCopy(
  code: string,
  purpose: CodeMailPurpose,
): { subject: string; text: string } {
  if (purpose === "login") {
    return {
      subject: "Your DesiAuction sign-in code",
      // Names the action, and tells somebody who did NOT do it what it means:
      // not "ignore this" — that is advice for spam — but that their address is
      // known to someone. Their account is not at risk without this code.
      text: `Your DesiAuction sign-in code is ${code}. It expires in 15 minutes.\n\nIf you did not try to sign in, someone entered your address on our sign-in page. Your account is safe as long as you do not share this code.`,
    };
  }
  return {
    subject: "Confirm your email for DesiAuction",
    text: `Your DesiAuction confirmation code is ${code}. It expires in 15 minutes. If you did not ask for this, ignore this message.`,
  };
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
  async send(email: string, code: string, _purpose: CodeMailPurpose): Promise<void> {
    // `phone` is the inbox's contact column. It holds an address here, which is
    // honest for a development surface whose question is "what did this contact
    // receive" — and is exactly why the production verification codes live in
    // their own table rather than in `otp_codes`.
    await this.db.insert(otpInbox).values({ id: newId(), phone: email, code });
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
 * decision `email-adapter.ts` documents at length. The request body is the
 * intersection of every provider on the table.
 */
export class HttpMailer implements CodeMailer {
  constructor(
    private readonly config: {
      endpoint: string;
      apiKey: string;
      from: string;
      transport?: MailTransport;
    },
  ) {}

  async send(email: string, code: string, purpose: CodeMailPurpose): Promise<void> {
    const transport = this.config.transport ?? defaultTransport;
    const copy = codeMailCopy(code, purpose);
    let response: MailerHttpResponse;
    try {
      response = await transport(this.config.endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify({
          from: this.config.from,
          to: [email],
          subject: copy.subject,
          // No link, either purpose. A code the person types back proves the
          // same thing a click does, cannot be followed out of a forwarded
          // message, and does not train people to click links in mail about
          // their account.
          text: copy.text,
        }),
      });
    } catch {
      throw new MailSendError("mail provider unreachable");
    }
    if (response.status >= 400) {
      throw new MailSendError(`mail provider rejected send (${String(response.status)})`);
    }
  }
}

const defaultTransport: MailTransport = async (url, init) => {
  const response = await fetch(url, init);
  return { status: response.status, body: await response.text() };
};

/**
 * One construction point. The real mailer is selected only when all three
 * settings are present; otherwise codes land in the dev inbox, VISIBLY, rather
 * than being half-sent by a partly-configured provider.
 */
export function createCodeMailer(db: Db): CodeMailer {
  // Explicit beats inferred. `dev` forces the inbox even when real credentials
  // are present — which is the only way a PRODUCTION-shaped build (the e2e
  // suite) can exercise an email flow without deleting them. `auto` is the
  // historical behaviour and stays the default, so nothing existing moves.
  if (env.EMAIL_PROVIDER === "dev") {
    return new DevInboxMailer(db);
  }
  const endpoint = env.EMAIL_API_ENDPOINT;
  const apiKey = env.EMAIL_API_KEY;
  const from = env.EMAIL_FROM;
  if (endpoint === undefined || apiKey === undefined || from === undefined) {
    if (env.EMAIL_PROVIDER === "http") {
      throw new MailSendError("EMAIL_PROVIDER=http without endpoint, key and from address");
    }
    return new DevInboxMailer(db);
  }
  return new HttpMailer({ endpoint, apiKey, from });
}
