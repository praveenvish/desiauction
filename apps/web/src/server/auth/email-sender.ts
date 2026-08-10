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
export interface CodeMailer {
  send(email: string, code: string): Promise<void>;
}

export class DevInboxMailer implements CodeMailer {
  constructor(private readonly db: Db) {}

  async send(email: string, code: string): Promise<void> {
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

  async send(email: string, code: string): Promise<void> {
    const transport = this.config.transport ?? defaultTransport;
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
          subject: "Confirm your email for DesiAuction",
          // No link. A code the person types back proves the same thing a
          // click does, cannot be followed out of a forwarded message, and
          // does not train people to click links in mail about their account.
          text: `Your DesiAuction confirmation code is ${code}. It expires in 15 minutes. If you did not ask for this, ignore this message.`,
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
  const endpoint = env.EMAIL_API_ENDPOINT;
  const apiKey = env.EMAIL_API_KEY;
  const from = env.EMAIL_FROM;
  if (endpoint === undefined || apiKey === undefined || from === undefined) {
    return new DevInboxMailer(db);
  }
  return new HttpMailer({ endpoint, apiKey, from });
}
