import { EmailBreaker, type EmailTransport } from "./email-adapter";
import { env } from "../../env";

/**
 * ONE-OFF TRANSACTIONAL MAIL — a receipt for something the person just did.
 *
 * There were two mailers before this and neither fits. `HttpMailer`
 * (auth/email-sender.ts) sends exactly one message, a verification code, with
 * its subject and body baked in. `EmailHttpSender` (email-adapter.ts) is a
 * finops `DeliveryPort`: it takes a dispatch id, resolves a recipient through a
 * port and reports delivery back to the money ledger. Neither can send "we got
 * your demo request" without being bent out of shape.
 *
 * So this is the third, and it is deliberately the SMALLEST of the three: a
 * subject, a body, an address. It reuses `EmailBreaker` rather than growing a
 * fourth copy of the breaker, and it keeps every decision the other two already
 * argued out — no new dependency, injected transport, a request body that is
 * the intersection of every provider on the table.
 *
 * FAILURE IS NOT THE CALLER'S PROBLEM. `send` resolves either way and reports
 * what happened. A provider outage must never cost us a lead that is already
 * safely in the database, and the person has already been told on screen that
 * we have it — which is the contract, precisely because this layer can be down.
 */

export interface OutgoingMail {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
  /**
   * Optional file, in the shape Postmark/Resend/Brevo all accept. Providers
   * that want a different key override `buildRequest`, which is the same escape
   * hatch `email-adapter.ts` documents.
   */
  readonly attachment?: {
    readonly filename: string;
    readonly contentType: string;
    readonly contentBase64: string;
  };
}

export type MailOutcome = "sent" | "unconfigured" | "breaker-open" | "failed";

export interface TransactionalMailer {
  send(mail: OutgoingMail): Promise<MailOutcome>;
}

const BREAKER_THRESHOLD = 3;
const BREAKER_COOLDOWN_MS = 60 * 1000;

const defaultTransport: EmailTransport = async (url, init) => {
  const response = await fetch(url, init);
  return { status: response.status, body: await response.text() };
};

const defaultBuildRequest = (mail: OutgoingMail, from: string, replyTo?: string): unknown => ({
  from,
  to: [mail.to],
  subject: mail.subject,
  text: mail.text,
  // Omitted rather than sent empty: a blank reply_to is a header some
  // providers reject and every client renders badly.
  ...(replyTo === undefined ? {} : { reply_to: replyTo }),
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
});

export interface HttpMailerConfig {
  readonly endpoint: string;
  readonly apiKey: string;
  readonly from: string;
  /** Reply-To. Absent means replies bounce off the no-reply From address. */
  readonly replyTo?: string;
  readonly transport?: EmailTransport;
  readonly buildRequest?: (mail: OutgoingMail, from: string, replyTo?: string) => unknown;
  readonly now?: () => number;
}

export class HttpTransactionalMailer implements TransactionalMailer {
  private readonly breaker: EmailBreaker;

  constructor(private readonly config: HttpMailerConfig) {
    this.breaker = new EmailBreaker(
      config.now ?? (() => Date.now()),
      BREAKER_THRESHOLD,
      BREAKER_COOLDOWN_MS,
    );
  }

  async send(mail: OutgoingMail): Promise<MailOutcome> {
    // One melted provider must not turn a burst of requests into a retry storm
    // — the same reason the finops sender carries a breaker.
    if (this.breaker.isOpen()) {
      return "breaker-open";
    }
    const transport = this.config.transport ?? defaultTransport;
    const build = this.config.buildRequest ?? defaultBuildRequest;
    try {
      const response = await transport(this.config.endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify(build(mail, this.config.from, this.config.replyTo)),
      });
      if (response.status >= 400) {
        this.breaker.recordFailure();
        return "failed";
      }
      this.breaker.recordSuccess();
      return "sent";
    } catch {
      this.breaker.recordFailure();
      return "failed";
    }
  }
}

/** Reports "unconfigured" rather than pretending. Nothing is silently dropped. */
export class UnconfiguredMailer implements TransactionalMailer {
  // Not `async`: there is nothing to await, and the port is what makes it a
  // promise. Marking it async to match the interface's shape would be a lie the
  // linter is right to call out.
  send(): Promise<MailOutcome> {
    return Promise.resolve("unconfigured");
  }
}

let cached: TransactionalMailer | null = null;

/**
 * ONE construction point, and the real mailer is selected only when all three
 * settings are present — the rule `createCodeMailer` and `finopsDeps` both
 * follow. A half-configured provider that silently drops mail is worse than one
 * that says out loud it is not there.
 */
export function transactionalMailer(): TransactionalMailer {
  if (cached !== null) {
    return cached;
  }
  const endpoint = env.EMAIL_API_ENDPOINT;
  const apiKey = env.EMAIL_API_KEY;
  const from = env.EMAIL_FROM;
  // Not part of the three-way check below: a missing Reply-To degrades the
  // mail, it does not make the provider unconfigured.
  const replyTo = env.EMAIL_REPLY_TO;
  cached =
    endpoint === undefined || apiKey === undefined || from === undefined
      ? new UnconfiguredMailer()
      : new HttpTransactionalMailer({
          endpoint,
          apiKey,
          from,
          // Spread rather than passed as undefined: the repo runs
          // exactOptionalPropertyTypes, so absent and undefined differ.
          ...(replyTo === undefined ? {} : { replyTo }),
        });
  return cached;
}

/** Tests inject their own; nothing else may. */
export function setTransactionalMailerForTest(mailer: TransactionalMailer | null): void {
  cached = mailer;
}
