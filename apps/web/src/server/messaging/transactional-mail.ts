import { mailProviderFromEnv, type MailProvider } from "@desiauction/messaging/mail-provider";

import { EmailBreaker } from "./email-adapter";
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
  /** The branded HTML part (email-layout.ts). Plain text alone is still valid mail. */
  readonly html?: string;
  /** Optional file; each provider puts it where its API wants (mail-provider.ts). */
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

export interface HttpMailerConfig {
  /** SES or Resend (mail-provider.ts) — the request format lives there. */
  readonly provider: MailProvider;
  /** Reply-To. Absent means replies bounce off the no-reply From address. */
  readonly replyTo?: string;
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
    try {
      const result = await this.config.provider.send({
        ...mail,
        // Spread rather than passed as undefined: exactOptionalPropertyTypes.
        ...(this.config.replyTo === undefined ? {} : { replyTo: this.config.replyTo }),
      });
      if (!result.ok) {
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
 * ONE construction point, and the real mailer is selected only when the
 * provider `EMAIL_PROVIDER` names is fully configured (mail-provider.ts) — the
 * rule `createCodeMailer` and `finopsDeps` both follow. A half-configured
 * provider that silently drops mail is worse than one that says out loud it is
 * not there.
 */
export function transactionalMailer(): TransactionalMailer {
  if (cached !== null) {
    return cached;
  }
  const provider = mailProviderFromEnv(env);
  // Not part of "configured": a missing Reply-To degrades the mail, it does
  // not make the provider unconfigured.
  const replyTo = env.EMAIL_REPLY_TO;
  cached =
    provider === null
      ? new UnconfiguredMailer()
      : new HttpTransactionalMailer({
          provider,
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
