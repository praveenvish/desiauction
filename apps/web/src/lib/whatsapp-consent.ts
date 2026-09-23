/**
 * The words beside the WhatsApp opt-in, in one place because they are both
 * rendered (registration, /account) AND stored verbatim on the consent record —
 * what a person agreed to has to survive this copy being edited.
 *
 * It said "…on WhatsApp instead of SMS" while SMS was the default. SMS is
 * deferred (2026-09-23) and WhatsApp now carries registration decisions and
 * account alerts as well, so the words say what the tick now covers — an
 * opt-in has to name what it is for.
 *
 * Client-safe on purpose: the registration form imports it.
 */
export const WHATSAPP_CONSENT_LABEL =
  "Send my registration, auction and team updates, and account alerts, on WhatsApp.";

/**
 * The languages every WhatsApp template is approved in. Meta's language codes,
 * which are also what is stored on the consent record.
 */
export const WHATSAPP_LANGUAGES = ["en", "hi"] as const;

export type WhatsAppLanguage = (typeof WHATSAPP_LANGUAGES)[number];

/** Each language named in itself — a Hindi reader looks for हिन्दी, not "Hindi". */
export const WHATSAPP_LANGUAGE_LABELS: Readonly<
  Record<WhatsAppLanguage, { readonly label: string; readonly lang: string }>
> = {
  en: { label: "English", lang: "en" },
  hi: { label: "हिन्दी", lang: "hi" },
};

export function parseWhatsAppLanguage(value: unknown): WhatsAppLanguage | undefined {
  return value === "en" || value === "hi" ? value : undefined;
}
