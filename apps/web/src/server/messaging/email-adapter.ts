import type { DeliveryPort } from "@desiauction/financial-operations";

/**
 * EMAIL DELIVERY OVER HTTP.
 *
 * The platform ships one email adapter and it writes a `.txt` file into a local
 * directory. That is a correct DEVELOPMENT outbox and it is what production has
 * been running, so "delivery succeeded" has meant "a file exists on a disk
 * nobody reads".
 *
 * This is the real one. Two deliberate choices:
 *
 * NO NEW DEPENDENCY. Every provider on the table — SES, Postmark, Resend,
 * Brevo, MSG91's own — exposes an HTTP API, and `fetch` is built in. Adding
 * nodemailer to reach SMTP would buy nothing this does not already have and
 * would put a mail library in the runtime of a repo that has stayed at twelve
 * dependencies.
 *
 * THE TRANSPORT AND THE REQUEST SHAPE ARE BOTH INJECTED, so choosing a provider
 * is configuration rather than a rewrite. `buildRequest` is the only part that
 * knows a vendor's JSON, and the default is deliberately generic: `to`, `from`,
 * `subject`, `text` is the intersection of every provider listed above.
 *
 * It follows `Msg91FlowSmsSender`'s contract exactly — injected transport,
 * consecutive-failure breaker, a cooldown, and the next send after it as the
 * probe — because one melted provider must not turn a bulk issuance into a
 * retry storm.
 */

export interface EmailHttpResponse {
  readonly status: number;
  readonly body: string;
}

export type EmailTransport = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<EmailHttpResponse>;

export interface EmailMessage {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
}

export interface EmailAdapterConfig {
  readonly endpoint: string;
  readonly apiKey: string;
  readonly from: string;
  /** Header name the provider authenticates with. Bearer is the common case. */
  readonly authHeader?: string;
  readonly authScheme?: string;
  /**
   * Header the provider deduplicates retries on. `Idempotency-Key` is the
   * common spelling (Resend, Postmark and Stripe-shaped APIs); SES uses none.
   *
   * Set to `null` for a provider that has no such header — the send is then
   * at-least-once, which is what it was before this existed, rather than
   * sending a header the provider will reject or ignore.
   */
  readonly idempotencyHeader?: string | null;
  readonly transport?: EmailTransport;
  readonly buildRequest?: (message: EmailMessage, from: string) => unknown;
  readonly now?: () => number;
  readonly breakerThreshold?: number;
  readonly breakerCooldownMs?: number;
}

const DEFAULT_BREAKER_THRESHOLD = 3;
const DEFAULT_BREAKER_COOLDOWN_MS = 60 * 1000;

const defaultTransport: EmailTransport = async (url, init) => {
  const response = await fetch(url, init);
  return { status: response.status, body: await response.text() };
};

/** The intersection of every provider we are choosing between. */
const defaultBuildRequest = (message: EmailMessage, from: string): unknown => ({
  from,
  to: [message.to],
  subject: message.subject,
  text: message.text,
});

/**
 * A subject line for a document dispatch.
 *
 * Derived from the template id rather than the body, because the body is the
 * reproduced document bytes and a subject cut from it would change whenever the
 * document does. A subject that changes under a customer is a subject they
 * cannot search for.
 */
export function subjectFor(templateId: string): string {
  const known: Record<string, string> = {
    "receipt.issued": "Your receipt from DesiAuction",
    "invoice.issued": "Your invoice from DesiAuction",
    "correction.issued": "A corrected document from DesiAuction",
  };
  return known[templateId] ?? "A document from DesiAuction";
}

export class EmailBreaker {
  private consecutiveFailures = 0;
  private openedAt: number | null = null;

  constructor(
    private readonly now: () => number,
    private readonly threshold: number,
    private readonly cooldownMs: number,
  ) {}

  isOpen(): boolean {
    return this.openedAt !== null && this.now() - this.openedAt < this.cooldownMs;
  }

  recordFailure(): void {
    this.consecutiveFailures += 1;
    if (this.consecutiveFailures >= this.threshold) {
      this.openedAt = this.now();
    }
  }

  recordSuccess(): void {
    this.consecutiveFailures = 0;
    this.openedAt = null;
  }
}

/**
 * Resolve a dispatch's recipient to an email address.
 *
 * Returns null when it cannot, and the caller REFUSES rather than confirming —
 * the in-app adapter's original sin was reporting success for a delivery it had
 * not attempted, and repeating it here would be worse, because an email nobody
 * received looks identical to one that arrived.
 */
export type EmailResolver = (recipientRef: string) => Promise<string | null>;

/**
 * Which provider events mean what.
 *
 * `delivered` is the only one that confirms. Everything else is a failure, and
 * the two that matter most are `bounce` and `complaint`: continuing to send to
 * a hard bounce is how a sending domain dies, and a complaint is somebody
 * telling their mail provider we are spam. Both must reach the suppression
 * list, which the route does — the parser's job is only to classify.
 */
const DELIVERED_EVENTS = new Set(["delivered", "delivery", "email.delivered"]);
const FAILED_EVENTS = new Set([
  "bounce",
  "bounced",
  "hard_bounce",
  "complaint",
  "complained",
  "spam",
  "dropped",
  "failed",
  "email.bounced",
  "email.complained",
]);

/** The events that mean "never send to this address again". */
export const SUPPRESSING_EVENTS = new Set([
  "bounce",
  "bounced",
  "hard_bounce",
  "complaint",
  "complained",
  "spam",
  "email.bounced",
  "email.complained",
]);

export interface ParsedCallback {
  readonly event: string;
  readonly dispatchId: string;
  readonly providerEventRef: string;
  readonly recipient: string | null;
}

/**
 * Parse a provider's delivery report without committing to one vendor.
 *
 * `dispatchId` comes back through the providerRef we set on send
 * (`email:<dispatchId>`); every provider on the table can echo a tag, a custom
 * header or a message id. The event ref is the provider's own id, and it is
 * what makes replay idempotent — the platform keys the command on
 * `provider:{providerEventRef}`, so a provider retrying a webhook cannot
 * double-confirm.
 */
export function parseEmailCallback(raw: string): ParsedCallback | null {
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
  const read = (names: readonly string[]): string => {
    for (const name of names) {
      const value = payload[name];
      if (typeof value === "string" && value.trim() !== "") {
        return value;
      }
    }
    return "";
  };
  const event = read(["event", "type", "eventType", "RecordType"]).toLowerCase();
  const ref = read(["providerRef", "tag", "messageId", "message_id", "MessageID"]);
  const eventRef = read(["eventId", "event_id", "id", "ID"]);
  const dispatchId = ref.startsWith("email:") ? ref.slice("email:".length) : "";
  if (event === "" || dispatchId === "") {
    return null;
  }
  return {
    event,
    dispatchId,
    // Fall back to the dispatch and event together rather than to a constant:
    // an idempotency key that is the same for every event would make the second
    // report about a message a no-op.
    providerEventRef: eventRef === "" ? `${dispatchId}:${event}` : eventRef,
    recipient: read(["recipient", "email", "to", "Recipient"]) || null,
  };
}

export function createHttpEmailAdapter(
  config: EmailAdapterConfig,
  resolve: EmailResolver,
): DeliveryPort {
  const transport = config.transport ?? defaultTransport;
  const build = config.buildRequest ?? defaultBuildRequest;
  const breaker = new EmailBreaker(
    config.now ?? (() => Date.now()),
    config.breakerThreshold ?? DEFAULT_BREAKER_THRESHOLD,
    config.breakerCooldownMs ?? DEFAULT_BREAKER_COOLDOWN_MS,
  );
  return {
    channel: "email",
    async send(request) {
      if (breaker.isOpen()) {
        // Retryable: the provider is melted, not the message malformed.
        return { ok: false as const, code: "provider_unavailable", retryable: true };
      }
      const to = await resolve(request.recipientRef);
      if (to === null) {
        /*
         * NOT retryable, and this is the important case rather than an edge one.
         *
         * The product has no email addresses. `people` carries a phone and a
         * name; sign-in is phone-first and an address is never asked for. So a
         * document addressed to a person cannot be emailed to them, and no
         * amount of retrying changes that — it needs a column, a form field and
         * a verification flow, because an unverified address is a liability
         * rather than a channel.
         *
         * Refusing loudly is the point. The filesystem outbox this replaces
         * reported "Succeeded" for a file on a disk nobody reads, which is the
         * same non-delivery wearing a green badge.
         */
        return { ok: false as const, code: "no_email_on_file", retryable: false };
      }
      const headers: Record<string, string> = {
        "content-type": "application/json",
        [config.authHeader ?? "authorization"]:
          `${config.authScheme ?? "Bearer"} ${config.apiKey}`.trim(),
      };
      /*
       * THE ONLY PARTY THAT CAN MAKE THIS SEND EXACTLY-ONCE.
       *
       * `runDispatchSend` calls this and only then commits the `sent`
       * transition, so a crash in between leaves the dispatch `requested` and
       * the retry arrives here again. That window cannot be closed on our side
       * — committing first would instead record documents as sent that nobody
       * received, and this adapter already refuses to tell that particular lie.
       *
       * So we hand the provider a key that is identical on every attempt at
       * this dispatch and let it collapse the duplicate. A provider that
       * honours it makes delivery effectively-once; one that does not behaves
       * as it did before, so this can only help (audit PA-1 §16).
       */
      const idempotencyHeader =
        config.idempotencyHeader === undefined ? "idempotency-key" : config.idempotencyHeader;
      if (idempotencyHeader !== null) {
        headers[idempotencyHeader] = request.idempotencyKey;
      }
      try {
        const response = await transport(config.endpoint, {
          method: "POST",
          headers,
          body: JSON.stringify(
            build({ to, subject: subjectFor(request.templateId), text: request.body }, config.from),
          ),
        });
        if (response.status >= 400) {
          breaker.recordFailure();
          // 4xx is the message; 5xx is the provider. Only one is worth retrying.
          return {
            ok: false as const,
            code: `provider_rejected_${String(response.status)}`,
            retryable: response.status >= 500 || response.status === 429,
          };
        }
        breaker.recordSuccess();
        /*
         * `providerRef`, and NOT `confirmed`.
         *
         * An accepted HTTP call means the provider took the message, not that a
         * mailbox received it. Delivery truth arrives later on the provider's
         * callback. Confirming here would rebuild, on the email channel, exactly
         * the lie the in-app adapter told.
         */
        return {
          ok: true as const,
          providerRef: `email:${request.dispatchId}`,
        };
      } catch {
        breaker.recordFailure();
        return { ok: false as const, code: "provider_unreachable", retryable: true };
      }
    },
    /**
     * The other half of "acceptance is not delivery".
     *
     * `send` returns a providerRef and deliberately does not confirm. This is
     * where the confirmation comes from, and the platform's own
     * `ingestDeliveryCallback` does the rest — it is idempotent on
     * `provider:{providerEventRef}`, refuses late or out-of-order transitions
     * against the frozen state machine, and audits even the attempts it
     * rejects. That ingress has existed, exported and tested, with no caller.
     */
    verifyCallback(raw: string) {
      const parsed = parseEmailCallback(raw);
      if (parsed === null) {
        return { ok: false as const, reason: "unparseable" };
      }
      if (DELIVERED_EVENTS.has(parsed.event)) {
        return {
          ok: true as const,
          dispatchId: parsed.dispatchId,
          providerEventRef: parsed.providerEventRef,
          kind: "delivered" as const,
        };
      }
      if (FAILED_EVENTS.has(parsed.event)) {
        return {
          ok: true as const,
          dispatchId: parsed.dispatchId,
          providerEventRef: parsed.providerEventRef,
          kind: "failed" as const,
          code: parsed.event,
        };
      }
      // Opens, clicks and the rest are not delivery truth. Refusing them keeps
      // the dispatch's state machine about whether the message arrived.
      return { ok: false as const, reason: `unhandled_event:${parsed.event}` };
    },
  };
}
