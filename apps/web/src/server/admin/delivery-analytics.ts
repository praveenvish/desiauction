/**
 * The pure half of /admin/notifications/analytics: the window a URL asks for,
 * and the one short label each outbox reason is grouped under. No database, so
 * the rules are unit-tested on their own (delivery-analytics.test.ts).
 */

/** The windows the page offers. 90 is the cap: every query is bounded by it. */
export const ANALYTICS_WINDOWS = [7, 30, 90] as const;
export type AnalyticsWindow = (typeof ANALYTICS_WINDOWS)[number];
export const DEFAULT_WINDOW: AnalyticsWindow = 30;

/**
 * `?days=` as typed by a person or a stale link. Not a number → the default; a
 * number snaps UP to the nearest offered window and never past the cap, so
 * `?days=3650` is ninety days, not a table scan of every message ever queued.
 */
export function parseWindow(raw: string | string[] | undefined): AnalyticsWindow {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (value === undefined || !/^\d{1,6}$/.test(value.trim())) return DEFAULT_WINDOW;
  const days = Number(value.trim());
  for (const window of ANALYTICS_WINDOWS) {
    if (days <= window) return window;
  }
  return ANALYTICS_WINDOWS[ANALYTICS_WINDOWS.length - 1] as AnalyticsWindow;
}

const MAX_WORDS = 5;
const MAX_LENGTH = 64;

/**
 * Strip what could identify somebody before a reason becomes a label: an
 * address, a long run of digits (a phone number), a URL, anything quoted or in
 * brackets (provider detail, which is where a recipient gets echoed back).
 */
function redact(text: string): string {
  return text
    .replace(/\([^)]*\)|\[[^\]]*\]|"[^"]*"|'[^']*'/g, " ")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/\S+@\S+/g, " ")
    .replace(/\+?\d[\d\s-]{6,}\d/g, " ");
}

function slug(text: string, maxWords: number): string {
  return text
    .toLowerCase()
    .split(/[^a-z0-9_]+/)
    .filter((word) => word !== "")
    .slice(0, maxWords)
    .join("_");
}

/**
 * One outbox `last_error`, as the label it is counted under.
 *
 *   "withheld:opted_out"                              → withheld:opted_out
 *   "admin_disabled"                                  → admin_disabled
 *   "no_text_channel: not opted in to WhatsApp"       → no_text_channel:not_opted_in_to_whatsapp
 *   "no_text_channel: WhatsApp refused the send (…)"  → no_text_channel:whatsapp_refused_the_send
 *   "email provider not configured"                   → email_provider_not_configured
 *
 * The prefix before the first colon is the family; the rest is kept only as far
 * as its first few words, with anything that could name a person removed. The
 * reasons are free text written by this codebase and, in places, a provider's
 * message — so the label is a summary, never the string.
 */
export function normalizeFailureReason(raw: string | null): string {
  if (raw === null) return "unspecified";
  const text = redact(raw).trim();
  const colon = text.indexOf(":");
  const head = slug(colon === -1 ? text : text.slice(0, colon), MAX_WORDS);
  const tail = colon === -1 ? "" : slug(text.slice(colon + 1), MAX_WORDS);
  const label = head === "" ? tail : tail === "" ? head : `${head}:${tail}`;
  return label === "" ? "unspecified" : label.slice(0, MAX_LENGTH);
}

/**
 * A WhatsApp delivery failure (`delivery_error`, written by the webhook as
 * `<code> <title>` and never the details): Meta's numeric code is the useful
 * part, so it survives the redaction a free-text reason gets.
 */
export function normalizeDeliveryError(raw: string | null): string {
  const text = (raw ?? "").trim();
  const match = /^(\d{1,6})\b(.*)$/.exec(text);
  if (match === null) {
    return `whatsapp_delivery:${normalizeFailureReason(text === "" ? null : text).replace(":", "_")}`;
  }
  const title = slug(redact(match[2] ?? ""), MAX_WORDS);
  return `whatsapp_delivery:${match[1] ?? ""}${title === "" ? "" : `_${title}`}`.slice(
    0,
    MAX_LENGTH,
  );
}

/** A share, as the page prints it: one decimal, and a dash for nothing sent. */
export function rate(part: number, whole: number): string {
  if (whole <= 0) return "—";
  return `${((part / whole) * 100).toFixed(1)}%`;
}
