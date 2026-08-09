/**
 * THE MESSAGE TEMPLATE REGISTRY.
 *
 * Every SMS this product sends to a person is a registered template with
 * declared slots. That is not an abstraction we chose — it is what India's DLT
 * regime requires, and the code that came before this could not satisfy it.
 *
 * `registration-notify.ts` used to build a complete English sentence in code and
 * post it to MSG91 as a single variable:
 *
 *     template_id: <one id for everything>,
 *     recipients: [{ mobiles, message: "DesiAuction: You're approved for ..." }]
 *
 * Under DLT an operator registers a header (sender id) and a content template,
 * and the gateway matches the fixed text at delivery time — only declared
 * variable slots may differ. A template whose entire body is one variable is not
 * registrable. So every decision SMS built that way is rejected or scrubbed in
 * production, and the dev inbox hides it completely because the dev sender just
 * writes the string to a table.
 *
 * One id was also shared across five distinct message shapes AND with the OTP
 * sender. DLT needs one registered template per shape.
 *
 * So: the body lives here as fixed text with `{slot}` markers, the provider is
 * given the SLOTS against a per-shape `providerTemplateId`, and the local render
 * exists for the dev inbox, for previews, and for the content digest. The text
 * here must stay character-identical to what is registered with the operator —
 * see `docs/messaging/00-messaging-platform.md`.
 */

/** One message shape. The key is stable; the text is versioned. */
export type TemplateKey =
  | "registration.approved"
  | "registration.waitlisted"
  | "registration.rejected"
  | "registration.withdrawn"
  | "registration.restored";

/**
 * Transactional messages may be delivered to numbers on the DND registry;
 * promotional messages may not, and need a recorded opt-in. Misclassifying is
 * how a sender id gets blocked, so the category is declared per template rather
 * than inferred from whichever code path happens to call the sender.
 */
export type MessageCategory = "transactional" | "promotional";

export interface SlotSpec {
  readonly name: string;
  /**
   * The operator's declared maximum. Overrunning it is a delivery failure at the
   * gateway, not a truncation, so the renderer refuses rather than trims — a
   * silently shortened tournament name is a support ticket, a refusal is a bug
   * report we see first.
   */
  readonly maxLength: number;
}

export interface MessageTemplate {
  readonly key: TemplateKey;
  /** Templates are immutable once used. An edit is a new version. */
  readonly version: string;
  readonly channel: "sms";
  readonly locale: "en-IN";
  readonly category: MessageCategory;
  /** Character-identical to the text registered with the operator. */
  readonly body: string;
  readonly slots: readonly SlotSpec[];
  /**
   * The env var carrying this shape's DLT/MSG91 template id. Read at send time
   * so a missing registration is a clear configuration error naming the shape,
   * not a message that silently goes nowhere.
   */
  readonly providerTemplateEnv: string;
}

const SLOT = /\{([a-z_]+)\}/g;

/**
 * The five decision notices, all transactional: each is the direct consequence
 * of an action the recipient took. None may be sent for marketing.
 *
 * Slot budgets are deliberately tight. An SMS is 160 GSM-7 characters before it
 * splits and starts costing more, and a split transactional message is also
 * more likely to be scrubbed.
 */
export const SMS_TEMPLATES: Readonly<Record<TemplateKey, MessageTemplate>> = {
  "registration.approved": {
    key: "registration.approved",
    version: "1",
    channel: "sms",
    locale: "en-IN",
    category: "transactional",
    body: "DesiAuction: You are approved for {competition}. You are in the player pool for auction day. Details: {link}",
    slots: [
      { name: "competition", maxLength: 60 },
      { name: "link", maxLength: 60 },
    ],
    providerTemplateEnv: "MSG91_TEMPLATE_REGISTRATION_APPROVED",
  },
  "registration.waitlisted": {
    key: "registration.waitlisted",
    version: "1",
    channel: "sms",
    locale: "en-IN",
    category: "transactional",
    body: "DesiAuction: You are on the waitlist for {competition}. The organizer moves waitlisted players up if a place opens. Details: {link}",
    slots: [
      { name: "competition", maxLength: 60 },
      { name: "link", maxLength: 60 },
    ],
    providerTemplateEnv: "MSG91_TEMPLATE_REGISTRATION_WAITLISTED",
  },
  "registration.rejected": {
    key: "registration.rejected",
    version: "1",
    channel: "sms",
    locale: "en-IN",
    category: "transactional",
    // The reason is a slot, not five separate templates: DLT matches the fixed
    // text, and the reasons are a closed set we control (REASON_TO_PLAYER).
    body: "DesiAuction: Your registration for {competition} was not approved - {reason}. Details: {link}",
    slots: [
      { name: "competition", maxLength: 60 },
      { name: "reason", maxLength: 60 },
      { name: "link", maxLength: 60 },
    ],
    providerTemplateEnv: "MSG91_TEMPLATE_REGISTRATION_REJECTED",
  },
  "registration.withdrawn": {
    key: "registration.withdrawn",
    version: "1",
    channel: "sms",
    locale: "en-IN",
    category: "transactional",
    body: "DesiAuction: Your registration for {competition} has been withdrawn. You can register again while intake is open. Details: {link}",
    slots: [
      { name: "competition", maxLength: 60 },
      { name: "link", maxLength: 60 },
    ],
    providerTemplateEnv: "MSG91_TEMPLATE_REGISTRATION_WITHDRAWN",
  },
  "registration.restored": {
    key: "registration.restored",
    version: "1",
    channel: "sms",
    locale: "en-IN",
    category: "transactional",
    body: "DesiAuction: Your registration for {competition} is back under review. Details: {link}",
    slots: [
      { name: "competition", maxLength: 60 },
      { name: "link", maxLength: 60 },
    ],
    providerTemplateEnv: "MSG91_TEMPLATE_REGISTRATION_RESTORED",
  },
};

export type RenderResult =
  | { readonly ok: true; readonly body: string; readonly slots: Record<string, string> }
  | { readonly ok: false; readonly reason: string };

/**
 * Fill a template's slots. Pure, and deliberately strict in both directions: a
 * missing slot and an unknown slot are both refusals, because either means the
 * caller and the registered template have drifted apart — and drift is exactly
 * what the gateway rejects.
 */
export function renderTemplate(
  template: MessageTemplate,
  values: Readonly<Record<string, string>>,
): RenderResult {
  const declared = new Set(template.slots.map((slot) => slot.name));
  for (const name of Object.keys(values)) {
    if (!declared.has(name)) {
      return { ok: false, reason: `template ${template.key} has no slot "${name}"` };
    }
  }
  for (const slot of template.slots) {
    const value = values[slot.name];
    if (value === undefined || value === "") {
      return { ok: false, reason: `template ${template.key} needs slot "${slot.name}"` };
    }
    if (value.length > slot.maxLength) {
      return {
        ok: false,
        reason: `slot "${slot.name}" is ${String(value.length)} characters, over the ${String(slot.maxLength)} the operator registered`,
      };
    }
  }
  const body = template.body.replace(SLOT, (_match, name: string) => values[name] ?? "");
  return { ok: true, body, slots: { ...values } };
}

/**
 * Every `{slot}` the body actually contains. Used by the suite to prove the
 * declared slots and the written text cannot drift — the single most likely way
 * this file stops matching what is registered with the operator.
 */
export function slotsInBody(body: string): string[] {
  return [...body.matchAll(SLOT)].map((match) => match[1] ?? "");
}
