/**
 * The words beside the WhatsApp opt-in, in one place because they are both
 * rendered (registration, /account) AND stored verbatim on the consent record —
 * what a person agreed to has to survive this copy being edited.
 *
 * Client-safe on purpose: the registration form imports it.
 */
export const WHATSAPP_CONSENT_LABEL =
  "Send my auction and team updates on WhatsApp instead of SMS.";
