/**
 * WHAT A TEXT DOES WHEN IT CANNOT GO ON WHATSAPP — pure, so every branch is a
 * unit test rather than a database fixture.
 *
 * Founder decision, 2026-09-23: SMS (MSG91, DLT) is deferred and WhatsApp is
 * the text channel. A person who has not opted in to WhatsApp gets the email
 * alone, never a WhatsApp message they did not ask for. So when WhatsApp is not
 * possible there are two worlds:
 *
 *   · AN SMS GATEWAY IS CONFIGURED — the text goes by SMS, exactly as it did
 *     before WhatsApp existed. Nothing below applies; configuring MSG91 brings
 *     this back without a code change.
 *   · THERE IS NO SMS — the text has no channel. That is a decision, not a
 *     fault: it is `suppressed` with a reason that starts `no_text_channel:`,
 *     so it is never retried forever and never counted as a failure, and the
 *     moment's email row (a separate row) is untouched.
 *
 * TWO EXCEPTIONS, both about WhatsApp being down rather than not wanted:
 *
 *   · Breaker open. Our own breaker turned the send away without calling Meta.
 *     That is an outage of a minute or two, the person DID ask for WhatsApp,
 *     and suppressing would lose their message to a blip. It waits out the
 *     cooldown the way the email and SMS breakers do (outbox.ts
 *     `waitOutBreaker`), which does not spend an attempt.
 *   · Unavailable (unreachable, 5xx, 429). Nothing was accepted, and later may
 *     work, so it backs off like any other retry — and when the attempts run
 *     out it is suppressed as no channel rather than failed: the email carried
 *     the moment, and "failed" would send somebody chasing a provider fault.
 *
 * A REFUSAL is suppressed at once: Meta said no to this message (the number is
 * not on WhatsApp, the template was paused), and asking again gets the same
 * answer. A TIMEOUT never reaches this function — Meta may have the message,
 * and the drain fails it as "delivery unknown" rather than risk a second one.
 */

export type WhatsAppBlock =
  /** No Cloud API account configured. */
  | { readonly kind: "unconfigured" }
  /** Meta has not approved this moment's template (its name env var is unset). */
  | { readonly kind: "template_unset" }
  /** The person's latest answer is not yes. */
  | { readonly kind: "not_opted_in" }
  /**
   * A platform admin switched WhatsApp off — for this kind, or everywhere
   * (/admin/notifications). SMS carries the text where a gateway exists, the
   * same as any other WhatsApp that cannot be used; where none does, the row
   * is suppressed with the admin's reason, so the grid's counts say why.
   */
  | { readonly kind: "platform_off"; readonly reason: "admin_disabled" | "channel_disabled" }
  | { readonly kind: "breaker_open"; readonly error: string }
  | { readonly kind: "unavailable"; readonly error: string }
  | { readonly kind: "refused"; readonly error: string };

export type TextFallback =
  /** Send it by SMS; `note` is the WhatsApp error to keep on the row, if any. */
  | { readonly action: "sms"; readonly note: string | null }
  /** Settle it `suppressed` with this reason. */
  | { readonly action: "suppress"; readonly reason: string }
  /** Put the attempt back and look again after the breaker's cooldown. */
  | { readonly action: "wait_breaker"; readonly reason: string }
  /** An ordinary retry on the back-off ladder. */
  | { readonly action: "retry"; readonly reason: string };

export const NO_TEXT_CHANNEL = "no_text_channel";

function note(block: WhatsAppBlock): string | null {
  return "error" in block ? `WhatsApp: ${block.error}` : null;
}

export function textFallback(
  block: WhatsAppBlock,
  input: {
    /** An SMS gateway (or, locally, the dev inbox) exists. */
    readonly smsAvailable: boolean;
    /** Attempts made so far, this one included. */
    readonly attempts: number;
    readonly maxAttempts: number;
  },
): TextFallback {
  if (input.smsAvailable) {
    return { action: "sms", note: note(block) };
  }
  switch (block.kind) {
    case "unconfigured":
      return { action: "suppress", reason: `${NO_TEXT_CHANNEL}: WhatsApp is not set up` };
    case "template_unset":
      return { action: "suppress", reason: `${NO_TEXT_CHANNEL}: WhatsApp template not approved` };
    case "not_opted_in":
      return { action: "suppress", reason: `${NO_TEXT_CHANNEL}: not opted in to WhatsApp` };
    case "platform_off":
      return { action: "suppress", reason: block.reason };
    case "breaker_open":
      return { action: "wait_breaker", reason: `WhatsApp: ${block.error}` };
    case "unavailable":
      return input.attempts >= input.maxAttempts
        ? {
            action: "suppress",
            reason: `${NO_TEXT_CHANNEL}: WhatsApp unavailable (${block.error})`,
          }
        : { action: "retry", reason: `WhatsApp: ${block.error}` };
    case "refused":
      return {
        action: "suppress",
        reason: `${NO_TEXT_CHANNEL}: WhatsApp refused the send (${block.error})`,
      };
  }
}
