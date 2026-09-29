import { isSnsUrl, parseSnsEnvelope, type SnsEnvelope } from "./sns";

/**
 * AMAZON SES DELIVERY EVENTS, arriving through SNS — what each one means here.
 *
 * SES publishes events for every message sent with our configuration set
 * (`SES_CONFIGURATION_SET`) to an SNS topic, and SNS POSTs them to
 * `/api/webhooks/ses`. This module is everything between the verified bytes
 * and the database, with the database injected so it is testable without one.
 *
 *   · Bounce, Permanent  → suppress the address (reason bounce)
 *   · Complaint          → suppress the address (reason complaint)
 *   · Bounce, Transient / Undetermined → nothing: a full mailbox or a
 *                          greylist is not a reason to stop writing to someone
 *   · Delivery / Bounce / Complaint on a RECEIPT (tagged `dispatch=<id>` by
 *     the finops adapter) → reported to the certified platform, which marks
 *     that dispatch delivered or failed
 *   · anything else (Send, Open, Click, DeliveryDelay…) → ignored
 *
 * Both SES shapes are read: event publishing (`eventType`) and the older
 * identity notifications (`notificationType`), so either SNS wiring works.
 */

export type SesAction =
  | {
      readonly kind: "suppress";
      readonly recipient: string;
      readonly reason: "bounce" | "complaint";
      readonly note: string;
    }
  | {
      /** The generic callback JSON `parseEmailCallback` reads. */
      readonly kind: "report";
      readonly raw: string;
    };

interface SesMail {
  readonly messageId?: string;
  readonly destination?: readonly string[];
  readonly tags?: Readonly<Record<string, readonly string[]>>;
}

interface SesEvent {
  readonly eventType?: string;
  readonly notificationType?: string;
  readonly mail?: SesMail;
  readonly bounce?: {
    readonly bounceType?: string;
    readonly bounceSubType?: string;
    readonly bouncedRecipients?: readonly { readonly emailAddress?: string }[];
  };
  readonly complaint?: {
    readonly complaintFeedbackType?: string;
    readonly complainedRecipients?: readonly { readonly emailAddress?: string }[];
  };
  readonly delivery?: { readonly recipients?: readonly string[] };
}

function addresses(list: readonly { readonly emailAddress?: string }[] | undefined): string[] {
  return (list ?? [])
    .map((entry) => entry.emailAddress ?? "")
    .filter((address) => address.includes("@"));
}

/**
 * What one SES event asks of us. Pure: the same event always yields the same
 * actions, and every action is idempotent where it lands (the suppression is
 * deduplicated, the platform keys on the event id).
 */
export function sesEventActions(message: string): { type: string; actions: SesAction[] } {
  let event: SesEvent;
  try {
    event = JSON.parse(message) as SesEvent;
  } catch {
    return { type: "unparseable", actions: [] };
  }
  const type = event.eventType ?? event.notificationType ?? "unknown";
  const messageId = event.mail?.messageId ?? "";
  const dispatchId = event.mail?.tags?.["dispatch"]?.[0] ?? "";
  const actions: SesAction[] = [];

  const report = (event: string, recipient: string): void => {
    if (dispatchId === "" || messageId === "") return;
    actions.push({
      kind: "report",
      raw: JSON.stringify({
        event,
        providerRef: `email:${dispatchId}`,
        // One id per message, event and recipient — replays of the same
        // report collapse on it; a later, different event does not.
        eventId: `ses:${messageId}:${event}:${recipient}`,
        recipient,
      }),
    });
  };

  if (type === "Bounce") {
    const permanent = event.bounce?.bounceType === "Permanent";
    for (const recipient of addresses(event.bounce?.bouncedRecipients)) {
      if (!permanent) continue;
      actions.push({
        kind: "suppress",
        recipient,
        reason: "bounce",
        note: `ses bounce: ${event.bounce?.bounceSubType ?? "Permanent"}`,
      });
      report("bounced", recipient);
    }
  } else if (type === "Complaint") {
    for (const recipient of addresses(event.complaint?.complainedRecipients)) {
      actions.push({
        kind: "suppress",
        recipient,
        reason: "complaint",
        note: `ses complaint: ${event.complaint?.complaintFeedbackType ?? "unspecified"}`,
      });
      report("complained", recipient);
    }
  } else if (type === "Delivery") {
    for (const recipient of event.delivery?.recipients ?? event.mail?.destination ?? []) {
      report("delivered", recipient);
    }
  }
  return { type, actions };
}

export interface SesWebhookDeps {
  /** The configured topic; only its messages are acted on. */
  readonly topicArn: string;
  readonly verify: (envelope: SnsEnvelope) => Promise<boolean>;
  /** GET the SubscribeURL — how a subscription is confirmed. */
  readonly confirm: (url: string) => Promise<boolean>;
  readonly suppress: (action: Extract<SesAction, { kind: "suppress" }>) => Promise<unknown>;
  readonly report: (raw: string) => Promise<unknown>;
  readonly log: (fields: Record<string, unknown>, message: string) => void;
}

export interface SesWebhookResult {
  readonly status: number;
  readonly body: Record<string, unknown> | null;
}

/**
 * One SNS POST, start to finish. The statuses matter to SNS, which retries
 * anything that is not 2xx: forgeries and strangers' topics get a 4xx (no
 * retry is due them); a message we understood but chose to ignore gets 200;
 * only a failure of OUR database is a 5xx, so SNS brings the report back.
 */
export async function handleSesWebhook(
  raw: string,
  deps: SesWebhookDeps,
): Promise<SesWebhookResult> {
  const envelope = parseSnsEnvelope(raw);
  if (envelope === null) {
    return { status: 400, body: null };
  }
  // THE TOPIC FIRST, because it costs nothing to check and verifying the
  // signature does not: `verify` fetches the signing certificate, so with the
  // order reversed any stranger's POST made this server go and fetch a URL
  // (pinned to Amazon's hosts, but still an outbound call on demand) before it
  // was refused. A message for another topic is refused whatever its signature
  // says; one that names OUR topic has proved nothing yet, and is verified
  // next. Both must hold — the order only decides what a stranger can spend.
  if (envelope.TopicArn !== deps.topicArn) {
    deps.log({ type: envelope.Type }, "ses_webhook.foreign_topic");
    return { status: 403, body: null };
  }
  if (!(await deps.verify(envelope))) {
    deps.log({ type: envelope.Type }, "ses_webhook.bad_signature");
    return { status: 403, body: null };
  }

  switch (envelope.Type) {
    case "SubscriptionConfirmation": {
      const url = envelope.SubscribeURL ?? "";
      if (!isSnsUrl(url)) return { status: 400, body: null };
      const confirmed = await deps.confirm(url);
      deps.log({ confirmed }, "ses_webhook.subscription");
      // 5xx on failure so SNS offers the confirmation again.
      return confirmed
        ? { status: 200, body: { status: "confirmed" } }
        : { status: 502, body: null };
    }
    case "UnsubscribeConfirmation":
      deps.log({}, "ses_webhook.unsubscribed");
      return { status: 200, body: { status: "ignored" } };
    case "Notification": {
      const { type, actions } = sesEventActions(envelope.Message);
      // Suppressions first: a fact about an address, kept even if the
      // finops report after it is refused (the delivery-status route's rule).
      for (const action of actions) {
        if (action.kind === "suppress") await deps.suppress(action);
      }
      for (const action of actions) {
        if (action.kind === "report") await deps.report(action.raw);
      }
      deps.log(
        {
          event: type,
          suppressed: actions.filter((a) => a.kind === "suppress").length,
          reported: actions.filter((a) => a.kind === "report").length,
        },
        "ses_webhook.event",
      );
      return { status: 200, body: { status: "ok", event: type } };
    }
    default:
      return { status: 200, body: { status: "ignored" } };
  }
}
