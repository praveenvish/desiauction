import type { DeliveryPort, DeliveryRequest } from "@desiauction/financial-operations";

import { EMAIL_TEMPLATES } from "./email-template-defaults";
import { manageEmailsUrl, renderEmail } from "./email-layout";
import { defaultContent, type MessageLanguage, type TemplateFields } from "./email-templates";
import type { GateReason } from "./gate";
import {
  createResendProvider,
  type MailProvider,
  type MailRequest,
  type MailTransport,
  type ResendProviderConfig,
} from "./mail-provider";
import type { ProviderResponse } from "./provider-fetch";

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

export type EmailHttpResponse = ProviderResponse;

export type EmailTransport = MailTransport;

export interface EmailMessage {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
  /** The branded part (email programme PR10). The text part alone is still a complete mail. */
  readonly html?: string;
}

/**
 * The provider: either one already built (`mailProviderFromEnv` — how both
 * tiers wire it, SES or Resend), or Resend's settings, from which one is built
 * here (how the tests and older call sites spell it).
 */
export type EmailAdapterProvider =
  | { readonly provider: MailProvider }
  | (Omit<ResendProviderConfig, "buildRequest"> & {
      readonly buildRequest?: (message: EmailMessage, from: string) => unknown;
    });

export type EmailAdapterConfig = EmailAdapterProvider & {
  /**
   * The subject and text for one dispatch, given who it resolved to. Left out:
   * the English code default (`financeDocumentMail` over the default wording).
   * finance-delivery.ts passes one that reads the owner's language and the
   * published wording (Notification Control Center, Phase 2).
   */
  readonly compose?: (
    request: DeliveryRequest,
    recipient: { readonly to: string; readonly personId: string | null },
  ) => Promise<{ readonly subject: string; readonly text: string; readonly html?: string }>;
  readonly now?: () => number;
  readonly breakerThreshold?: number;
  readonly breakerCooldownMs?: number;
};

const DEFAULT_BREAKER_THRESHOLD = 3;
const DEFAULT_BREAKER_COOLDOWN_MS = 60 * 1000;

/**
 * The provider a config names. Resend settings keep their old meaning exactly:
 * Resend's body (the document's text part, plus its branded html part), Bearer auth, and
 * `Idempotency-Key` unless switched off with `idempotencyHeader: null`.
 */
function providerOf(config: EmailAdapterProvider): MailProvider {
  if ("provider" in config) return config.provider;
  const { buildRequest, ...resend } = config;
  return createResendProvider({
    ...resend,
    ...(buildRequest === undefined
      ? {}
      : { buildRequest: (mail: MailRequest, from: string) => buildRequest(mail, from) }),
  });
}

/**
 * Which wording a document dispatch uses — one variant per document type
 * (email-template-defaults.ts, `finance.document.issued`).
 *
 * Derived from the template id rather than the body, because the body is the
 * reproduced document bytes and a subject cut from it would change whenever the
 * document does. A subject that changes under a customer is a subject they
 * cannot search for.
 */
export function financeVariantFor(templateId: string): string {
  const known: Record<string, string> = {
    "receipt.issued": "receipt",
    "invoice.issued": "invoice",
    "correction.issued": "correction",
  };
  return known[templateId] ?? "other";
}

/**
 * A finance document's email: the (editable) subject, the (editable, empty by
 * default) opening paragraphs, and then the document — always, whole, last.
 * Plain text: the body is the certified document text, reproduced exactly.
 */
const FINANCE_HEADING: Readonly<Record<string, Readonly<Record<MessageLanguage, string>>>> = {
  receipt: { en: "Your receipt", hi: "आपकी रसीद" },
  invoice: { en: "Your invoice", hi: "आपका इनवॉइस" },
  correction: { en: "A corrected document", hi: "सुधारा हुआ दस्तावेज़" },
  other: { en: "A document for your team", hi: "आपकी टीम के लिए एक दस्तावेज़" },
};

const FINANCE_FOOTNOTE: Readonly<Record<MessageLanguage, (club: string | null) => string>> = {
  en: (club) =>
    `You received this because ${club ?? "a club on DesiAuction"} issued this document to your team.`,
  hi: (club) =>
    `आपको यह इसलिए मिला क्योंकि ${club ?? "DesiAuction पर एक क्लब"} ने यह दस्तावेज़ आपकी टीम को जारी किया।`,
};

const MONEY_SUBTITLE: Readonly<Record<MessageLanguage, string>> = {
  en: "Receipts and money",
  hi: "रसीदें और पैसा",
};

const GRAPHEMES = new Intl.Segmenter(undefined, { granularity: "grapheme" });

function initialsOf(name: string): string {
  const first = (word: string) =>
    Array.from(GRAPHEMES.segment(word), (part) => part.segment)[0] ?? "";
  const words = name
    .trim()
    .split(/\s+/)
    .filter((word) => word !== "");
  return (
    words.length >= 2 ? `${first(words[0] ?? "")}${first(words[1] ?? "")}` : first(words[0] ?? "")
  ).toUpperCase();
}

/**
 * A FINANCE DOCUMENT'S EMAIL: the registry's subject and opening lines, then
 * the document itself.
 *
 * The TEXT part is exactly what it always was — the opening lines and the
 * document, as issued — and stays so: the document is the club's record. With
 * `layout` (email programme PR10) there is also a branded HTML part around the
 * same words: the club, a heading, the opening lines, and the document in a
 * monospace panel, reproduced character for character. No wording is added
 * that the text part lacks except the heading and the footer's why.
 */
export function financeDocumentMail(
  fields: TemplateFields,
  body: string,
  layout?: {
    readonly publicBaseUrl: string;
    readonly templateId: string;
    readonly language?: MessageLanguage;
    readonly orgName?: string | null;
  },
): { subject: string; text: string; html?: string } {
  const text = [...fields.paragraphs, body].join("\n\n");
  if (layout === undefined) {
    return { subject: fields.subject, text };
  }
  const language = layout.language ?? "en";
  const club = layout.orgName?.trim() || null;
  const heading = FINANCE_HEADING[financeVariantFor(layout.templateId)] ?? FINANCE_HEADING["other"];
  const { html } = renderEmail(
    {
      preheader: fields.paragraphs[0] ?? fields.subject,
      heading: heading?.[language] ?? fields.subject,
      paragraphs: fields.paragraphs,
      document: body,
      footnote: FINANCE_FOOTNOTE[language](club),
      language,
      manageUrl: manageEmailsUrl(layout.publicBaseUrl),
      ...(club === null
        ? {}
        : {
            band: { title: club, subtitle: MONEY_SUBTITLE[language], monogram: initialsOf(club) },
          }),
    },
    layout.publicBaseUrl,
  );
  return { subject: fields.subject, text, html };
}

function defaultFinanceFields(templateId: string): TemplateFields {
  const content = defaultContent(EMAIL_TEMPLATES["finance.document.issued"], "en");
  const fields = content.variants[financeVariantFor(templateId)] ?? content.variants["other"];
  if (fields === undefined) throw new Error("finance.document.issued has no default wording");
  return fields;
}

/** The English default subject line for a document dispatch. */
export function subjectFor(templateId: string): string {
  return defaultFinanceFields(templateId).subject;
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
 *
 * Or `{ withheld }`: there IS an address, and the notification gate said not
 * to use it — the person switched "Receipts and money" off, the club did, or
 * the address is on the suppression list (gate.ts). Distinct from null because
 * the fix is different: nobody needs to add an address, somebody chose this.
 */
export type EmailResolution =
  | string
  | null
  | { readonly withheld: GateReason }
  /** An address, with the person it belongs to — whose language the mail is in. */
  | { readonly to: string; readonly personId: string };

export type EmailResolver = (
  recipientRef: string,
  context: { readonly orgId: string },
) => Promise<EmailResolution>;

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
  const provider = providerOf(config);
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
      const resolved = await resolve(request.recipientRef, { orgId: request.orgId });
      const to =
        typeof resolved === "object" && resolved !== null && "to" in resolved
          ? resolved.to
          : resolved;
      const personId =
        typeof resolved === "object" && resolved !== null && "personId" in resolved
          ? resolved.personId
          : null;
      if (typeof to === "object" && to !== null) {
        /*
         * WITHHELD, and reported as what it is: a terminal, non-retryable
         * failure of THIS dispatch, with the gate's reason in the code.
         *
         * The certified finops machine has no "suppressed" outcome and is not
         * ours to give one. Its honest neighbours are the two it has: `sent`,
         * which would record a receipt as delivered that nobody received — the
         * one lie this adapter exists not to tell — and `failed`, which is true.
         * Non-retryable because retrying cannot change a person's choice; the
         * desk's Retry (a new dispatch) is the path once they switch it back
         * on. `no_email_on_file` below is the same shape for the same reason.
         */
        return { ok: false as const, code: `withheld:${to.withheld}`, retryable: false };
      }
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
      // Composed before the provider call, outside its try: a failure to read
      // the person's language is not the provider's, so it must not trip the
      // breaker — it throws, and the job retries like any other refused read.
      const mail =
        config.compose === undefined
          ? financeDocumentMail(defaultFinanceFields(request.templateId), request.body)
          : await config.compose(request, { to, personId });
      try {
        const result = await provider.send({
          to,
          subject: mail.subject,
          text: mail.text,
          ...(mail.html === undefined ? {} : { html: mail.html }),
          /*
           * THE ONLY PARTY THAT CAN MAKE THIS SEND EXACTLY-ONCE.
           *
           * `runDispatchSend` calls this and only then commits the `sent`
           * transition, so a crash in between leaves the dispatch `requested`
           * and the retry arrives here again. That window cannot be closed on
           * our side — committing first would instead record documents as sent
           * that nobody received, and this adapter already refuses to tell that
           * particular lie.
           *
           * So we hand the provider a key that is identical on every attempt at
           * this dispatch and let it collapse the duplicate. A provider that
           * honours it (Resend) makes delivery effectively-once; one that does
           * not (SES) behaves as it did before, so this can only help
           * (audit PA-1 §16).
           */
          idempotencyKey: request.idempotencyKey,
          // Echoed on SES delivery events, so a bounce can find its dispatch.
          tags: { dispatch: request.dispatchId },
        });
        if (!result.ok) {
          breaker.recordFailure();
          // The provider decides which of its refusals a retry could fix.
          return {
            ok: false as const,
            code: `provider_rejected_${String(result.status)}`,
            retryable: result.retryable,
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
