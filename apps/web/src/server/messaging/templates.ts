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
  | "registration.restored"
  | "security.phone_changed";

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

/*
 * Digits are allowed in a slot name, and that is not cosmetic.
 *
 * This pattern was `[a-z_]+`, so `{last4}` in a body was not recognised as a
 * slot at all: `renderTemplate` left the literal braces in the message and
 * `slotsInBody` reported none. The suite caught it, which is the system working
 * — but the failure mode is a message that ships with `{last4}` printed in it,
 * and the next person to write a slot with a digit deserves the pattern to just
 * work rather than the trap to be avoided by naming convention.
 */
const SLOT = /\{([a-z0-9_]+)\}/g;

/**
 * The five decision notices, all transactional: each is the direct consequence
 * of an action the recipient took. None may be sent for marketing.
 *
 * WHAT THE SLOT BUDGETS ACTUALLY BUY, measured rather than asserted.
 *
 * An SMS is 160 GSM-7 characters before it splits into 153-character parts,
 * each billed, and a split transactional message is also more likely to be
 * scrubbed. This comment used to say the budgets were "deliberately tight" and
 * the numbers did not support it: `link` was capped at 60 when the longest link
 * this product can build is 27, and at their declared maxima FIVE of six
 * templates ran past 160 — `registration.rejected` reached 246.
 *
 * The caps now describe what can actually arrive:
 *
 *   competition — `NAME_MAX_LENGTH`, the longest season name `validateName`
 *                 accepts. Tied to it by test.
 *   link        — `${PUBLIC_BASE_URL}/home`, which carries no variable part
 *                 since the season came out of it. 40 covers a base URL of 35
 *                 characters; production uses 27.
 *   reason      — the longest sentence in `REASON_TO_PLAYER`. Tied by test.
 *
 * And the residue is a decision rather than an accident. With a season named
 * the way seasons are actually named, every template is ONE segment. With the
 * longest name the product accepts, four become two. Cutting that would mean
 * cutting the sentences that say what a status MEANS — a player told only
 * "you are on the waitlist", without "the organizer moves waitlisted players up
 * if a place opens", reasonably reads it as a rejection. A second segment on a
 * minority of seasons is the cheaper mistake. `templates.test.ts` holds every
 * one of these numbers so the next edit has to justify itself.
 */
export const SMS_TEMPLATES: Readonly<Record<TemplateKey, MessageTemplate>> = {
  "registration.approved": {
    key: "registration.approved",
    version: "1",
    channel: "sms",
    locale: "en-IN",
    category: "transactional",
    body: "DesiAuction: You are approved for {competition}. You are in the player pool for auction day. {link}",
    slots: [
      { name: "competition", maxLength: 60 },
      { name: "link", maxLength: 40 },
    ],
    providerTemplateEnv: "MSG91_TEMPLATE_REGISTRATION_APPROVED",
  },
  "registration.waitlisted": {
    key: "registration.waitlisted",
    version: "1",
    channel: "sms",
    locale: "en-IN",
    category: "transactional",
    body: "DesiAuction: You are on the waitlist for {competition}. The organizer moves waitlisted players up if a place opens. {link}",
    slots: [
      { name: "competition", maxLength: 60 },
      { name: "link", maxLength: 40 },
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
    body: "DesiAuction: Your registration for {competition} was not approved - {reason}. {link}",
    slots: [
      { name: "competition", maxLength: 60 },
      { name: "reason", maxLength: 50 },
      { name: "link", maxLength: 40 },
    ],
    providerTemplateEnv: "MSG91_TEMPLATE_REGISTRATION_REJECTED",
  },
  "registration.withdrawn": {
    key: "registration.withdrawn",
    version: "1",
    channel: "sms",
    locale: "en-IN",
    category: "transactional",
    body: "DesiAuction: Your registration for {competition} has been withdrawn. You can register again while intake is open. {link}",
    slots: [
      { name: "competition", maxLength: 60 },
      { name: "link", maxLength: 40 },
    ],
    providerTemplateEnv: "MSG91_TEMPLATE_REGISTRATION_WITHDRAWN",
  },
  "registration.restored": {
    key: "registration.restored",
    version: "1",
    channel: "sms",
    locale: "en-IN",
    category: "transactional",
    body: "DesiAuction: Your registration for {competition} is back under review. {link}",
    slots: [
      { name: "competition", maxLength: 60 },
      { name: "link", maxLength: 40 },
    ],
    providerTemplateEnv: "MSG91_TEMPLATE_REGISTRATION_RESTORED",
  },
  /*
   * The one message that goes to a number the platform is about to STOP using.
   *
   * Changing the mobile on an account needs a live session plus possession of
   * the new handset, and deliberately not the old one — requiring the old
   * number would leave "I lost my phone" exactly as unrecoverable as it was.
   * This text is the compensating control: the outgoing number is told what
   * happened while it can still be read, so a session-theft takeover announces
   * itself instead of completing in silence.
   *
   * The new number is NOT named in full. Somebody who has taken an account
   * should not be handed a working contact for its owner, and "the last four
   * digits changed to" is enough for the owner to recognise their own handset
   * or fail to.
   */
  "security.phone_changed": {
    key: "security.phone_changed",
    version: "1",
    channel: "sms",
    locale: "en-IN",
    category: "transactional",
    body: "DesiAuction: The mobile number on your account was changed to one ending {last4}. If this was not you, reply to this message or contact your organizer now.",
    slots: [{ name: "last4", maxLength: 4 }],
    providerTemplateEnv: "MSG91_TEMPLATE_SECURITY_PHONE_CHANGED",
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
