import { env } from "../../env";

/**
 * ONE LAYOUT FOR EVERY EMAIL A CUSTOMER RECEIVES.
 *
 * Every mail this product sent was a bare text string: a sign-in code wrapped
 * in a sentence, no brand, no hierarchy, nothing that said at a glance "this
 * is DesiAuction, here is the one thing to do". Mail that does not look like
 * it came from us is also mail that is easier to imitate.
 *
 * `renderEmail` takes CONTENT — a heading, paragraphs, at most one code, at
 * most one button, a few labelled facts — and returns both an HTML body and
 * the plain-text alternative built from the same content, so the two can
 * never disagree. Every dynamic string is escaped.
 *
 * EMAIL V2 (docs/design/email-v2, founder-approved 2026-09-28). The HTML is
 * what every client supports: tables and inline styles, no web fonts, no
 * images but the logo — so the mail reads fully with images blocked AND with
 * the <style> block stripped (some Gmail builds do). That block only ADDS:
 *
 *   · phone width — tighter card padding and a full-width button;
 *   · dark mode — the Floodlight palette under `prefers-color-scheme: dark`
 *     (Apple Mail, iOS Mail, Outlook for Mac). Gmail recolours on its own;
 *     the light palette is chosen to survive that: a gold fill carries ink
 *     text, never white.
 *
 * The `da-*` class names are those hooks and nothing else.
 *
 * The internal team alerts (a new problem report, a new review, a new demo
 * request) stay plain text: nobody outside the team sees them.
 */

export const SUPPORT_EMAIL = "support@desiauction.in";

export type EmailLanguage = "en" | "hi";

export interface EmailContent {
  /** Hidden preview line most inboxes show beside the subject. */
  readonly preheader: string;
  readonly heading: string;
  readonly paragraphs: readonly string[];
  /** A one-time code, shown large and on its own. */
  readonly code?: string;
  /** The ONE thing to do. Placed last — after the facts it acts on. */
  readonly action?: { readonly label: string; readonly url: string };
  /**
   * The button right after the opening paragraphs instead: for a mail whose
   * whole point is the click (a review ask), where what follows is fine print.
   */
  readonly actionFirst?: boolean;
  /** A few labelled facts, e.g. the details of a booking. */
  readonly details?: readonly (readonly [string, string])[];
  /** Paragraphs after the code, button or details. */
  readonly after?: readonly string[];
  /** Why this person received this mail. */
  readonly footnote: string;
  /**
   * No links anywhere, footer included. For one-time-code mail: a typed code
   * cannot be followed out of a forwarded message, a link can.
   */
  readonly noLinks?: boolean;
  /**
   * Leave room for the WhatsApp nudge. Only the personal moments set it (a
   * sale, an appointment, a lineup, a registration decision) — never a
   * security mail or a sign-in code. The drain decides at send time whether
   * the line is shown: see `applyWhatsAppNudge`.
   */
  readonly whatsappNudge?: boolean;
  /**
   * The reader's language: the document's `lang` (screen readers pronounce
   * by it) and the font list (Devanagari first for Hindi). English when
   * omitted.
   */
  readonly language?: EmailLanguage;
  /**
   * "Manage emails" in the footer — only for a mail the reader can switch
   * off themselves (notification-email.ts decides, from the catalogue). A
   * code or a security alert never carries it: there is nothing to manage.
   */
  readonly manageUrl?: string;
}

export interface RenderedEmail {
  readonly html: string;
  readonly text: string;
}

// The design tokens (packages/ui/tokens), as literals: mail clients ignore CSS
// variables. Daylight for the mail itself, Floodlight for its dark mode.
const CANVAS = "#F7F6F2"; // chalk-50
const CARD = "#FFFFFF";
const SUNKEN = "#F0EEE8"; // chalk-100
const RULE = "#E7E4DC"; // chalk-200
const INK = "#1A1814"; // chalk-800 — headings
const TEXT = "#2B2822"; // chalk-700
const MUTED = "#58534A"; // chalk-600 — AA on the card, the sunken fill and the canvas
const GOLD = "#F0B43C"; // gold-400 — a FILL, never text
const GOLD_EDGE = "#B57F14"; // gold-700 — the fill's rim
const GOLD_TEXT = "#865D12"; // gold-800 — gold as text, on light
const ON_GOLD = "#070A0F"; // ink-950 — text on a gold fill (white on gold is 1.9:1)

const DARK = {
  canvas: "#070A0F", // ink-950
  card: "#101623", // ink-850
  sunken: "#0B1018", // ink-900
  rule: "#1F2A3D", // ink-700
  heading: "#E8EEF9", // ink-100
  text: "#C9D4E8", // ink-200
  muted: "#9FB0CC", // ink-300
  goldText: "#F3D078", // gold-300
} as const;

const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
// Devanagari first: without one of these, Windows falls back to a face whose
// matras collide with the line above.
const FONT_HI =
  "'Noto Sans Devanagari', 'Kohinoor Devanagari', 'Nirmala UI', Mangal, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif";
/** The footer's own words — the only words the layout writes itself. */
export const FOOTER_WORDS: Readonly<Record<EmailLanguage, { manage: string; help: string }>> = {
  en: { manage: "Manage emails", help: "Help" },
  hi: { manage: "ईमेल सेटिंग", help: "मदद" },
};

const MONO = "ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace";

function escape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function base(): string {
  return env.PUBLIC_BASE_URL.replace(/\/$/, "");
}

/** An absolute URL on our own host, for the logo. */
function asset(path: string): string {
  return `${base()}${path}`;
}

function paragraph(text: string, font: string): string {
  return `<p class="da-text" style="margin:0 0 16px;font:16px/26px ${font};color:${TEXT};">${escape(text)}</p>`;
}

/** Big, alone, and copied as the digits only — the spacing is letter-spacing, not spaces. */
function codeBlock(code: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:6px 0 24px;"><tr><td align="center" class="da-sunken" style="background:${SUNKEN};border:1px solid ${RULE};border-radius:14px;padding:22px 12px;"><div class="da-heading" style="font:700 40px/48px ${MONO};letter-spacing:12px;padding-left:12px;color:${INK};">${escape(code)}</div></td></tr></table>`;
}

function button(action: { label: string; url: string }, font: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" class="da-btn-wrap" style="margin:8px 0 24px;"><tr><td align="center" style="background:${GOLD};border:1px solid ${GOLD_EDGE};border-radius:10px;"><a class="da-btn" href="${escape(action.url)}" style="display:inline-block;padding:14px 28px;font:700 16px/20px ${font};color:${ON_GOLD};text-decoration:none;border-radius:10px;">${escape(action.label)}</a></td></tr></table>`;
}

function detailsTable(details: readonly (readonly [string, string])[], font: string): string {
  const rows = details
    .map(([label, value], i) => {
      const rule = i === 0 ? "" : `border-top:1px solid ${RULE};`;
      return `<tr><td class="da-muted da-rule" style="padding:11px 16px 11px 0;${rule}font:14px/20px ${font};color:${MUTED};vertical-align:top;">${escape(label)}</td><td class="da-heading da-rule" align="right" style="padding:11px 0;${rule}font:600 14px/20px ${font};color:${INK};text-align:right;vertical-align:top;font-variant-numeric:tabular-nums;">${escape(value)}</td></tr>`;
    })
    .join("");
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" class="da-sunken" style="margin:4px 0 24px;background:${SUNKEN};border-radius:12px;"><tr><td style="padding:4px 18px;"><table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">${rows}</table></td></tr></table>`;
}

/**
 * Progressive only: everything it styles is already a complete light mail.
 * Between the markers so a preview can show the dark rendering on any device.
 */
const STYLE = `<style>
body { margin:0; padding:0; -webkit-text-size-adjust:100%; }
@media (max-width: 520px) {
  .da-outer { padding:20px 12px 28px !important; }
  .da-body { padding:26px 22px 8px !important; }
  .da-btn-wrap { width:100% !important; }
  .da-btn { display:block !important; }
}
/*da:dark*/
@media (prefers-color-scheme: dark) {
  .da-canvas { background:${DARK.canvas} !important; }
  .da-card { background:${DARK.card} !important; border-color:${DARK.rule} !important; }
  .da-sunken { background:${DARK.sunken} !important; border-color:${DARK.rule} !important; }
  .da-heading { color:${DARK.heading} !important; }
  .da-text { color:${DARK.text} !important; }
  .da-muted { color:${DARK.muted} !important; }
  .da-gold-text { color:${DARK.goldText} !important; }
  .da-rule { border-color:${DARK.rule} !important; }
}
/*/da:dark*/
</style>`;

/** The same document with its dark rules unconditional — what a dark Apple Mail shows. */
export function forceDarkEmail(html: string): string {
  return html.replace(
    /\/\*da:dark\*\/\s*@media \(prefers-color-scheme: dark\) \{([\s\S]*?)\}\s*\/\*\/da:dark\*\//,
    "$1",
  );
}

export function renderEmail(content: EmailContent): RenderedEmail {
  const language = content.language ?? "en";
  const font = language === "hi" ? FONT_HI : FONT;
  const action = content.action === undefined ? "" : button(content.action, font);
  const first = content.actionFirst === true;
  const manage = content.noLinks === true ? undefined : content.manageUrl;
  const words = FOOTER_WORDS[language];
  const body = [
    ...content.paragraphs.map((p) => paragraph(p, font)),
    content.code === undefined ? "" : codeBlock(content.code),
    first ? action : "",
    content.details === undefined || content.details.length === 0
      ? ""
      : detailsTable(content.details, font),
    ...(content.after ?? []).map((p) => paragraph(p, font)),
    first ? "" : action,
    content.whatsappNudge === true ? WHATSAPP_NUDGE_MARK : "",
  ].join("");

  const footerLink = (label: string, href: string) =>
    `<a class="da-muted" href="${escape(href)}" style="color:${MUTED};text-decoration:underline;">${escape(label)}</a>`;
  const footerLine =
    content.noLinks === true
      ? `DesiAuction &middot; ${escape(words.help)}: ${SUPPORT_EMAIL}`
      : [
          "DesiAuction",
          footerLink("desiauction.in", env.PUBLIC_BASE_URL),
          ...(manage === undefined ? [] : [footerLink(words.manage, manage)]),
          `${escape(words.help)}: ${footerLink(SUPPORT_EMAIL, `mailto:${SUPPORT_EMAIL}`)}`,
        ].join(" &middot; ");

  // The zero-width run after the preheader keeps inboxes from padding the
  // preview line with the first words of the body.
  const html = `<!doctype html>
<html lang="${language}" dir="ltr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${escape(content.heading)}</title>
${STYLE}
</head>
<body class="da-canvas" style="margin:0;padding:0;background:${CANVAS};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;">${escape(content.preheader)}${"&#8199;&#847; ".repeat(30)}</div>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" class="da-canvas" style="background:${CANVAS};">
<tr><td align="center" class="da-outer" style="padding:36px 16px 40px;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:580px;">
<tr><td style="padding:0 8px 18px;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
<td style="vertical-align:middle;"><img src="${escape(asset("/brand/mark.png"))}" width="32" height="32" alt="" style="display:block;border:0;border-radius:8px;"></td>
<td class="da-heading" style="vertical-align:middle;padding-left:10px;font:700 18px/24px ${FONT};color:${INK};letter-spacing:-0.2px;">Desi<span class="da-gold-text" style="color:${GOLD_TEXT};">Auction</span></td>
</tr></table>
</td></tr>
<tr><td>
<table role="article" aria-roledescription="email" aria-label="${escape(content.heading)}" lang="${language}" cellpadding="0" cellspacing="0" border="0" width="100%" class="da-card" style="background:${CARD};border:1px solid ${RULE};border-radius:16px;">
<tr><td class="da-body" style="padding:32px 36px 12px;">
<h1 class="da-heading" style="margin:0 0 16px;font:700 24px/32px ${font};color:${INK};letter-spacing:-0.3px;">${escape(content.heading)}</h1>
${body}
</td></tr>
</table>
</td></tr>
<tr><td class="da-muted" style="padding:22px 8px 0;font:13px/20px ${font};color:${MUTED};">
<p style="margin:0 0 8px;">${escape(content.footnote)}</p>
<p style="margin:0;">${footerLine}</p>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;

  const actionLine =
    content.action === undefined ? [] : [`${content.action.label}: ${content.action.url}`, ""];
  const text = [
    content.heading,
    "",
    ...content.paragraphs.flatMap((p) => [p, ""]),
    ...(content.code === undefined ? [] : [`    ${content.code}`, ""]),
    ...(first ? actionLine : []),
    ...(content.details === undefined
      ? []
      : [...content.details.map(([label, value]) => `  ${label}: ${value}`), ""]),
    ...(content.after ?? []).flatMap((p) => [p, ""]),
    ...(first ? [] : actionLine),
    "—",
    content.footnote,
    ...(manage === undefined ? [] : [`${words.manage}: ${manage}`]),
    content.noLinks === true
      ? `DesiAuction · ${words.help}: ${SUPPORT_EMAIL}`
      : `DesiAuction · ${env.PUBLIC_BASE_URL} · ${words.help}: ${SUPPORT_EMAIL}`,
  ].join("\n");

  return { html, text };
}

/** Where "Manage emails" goes: the notification switches on /account. */
export function manageEmailsUrl(): string {
  return `${base()}/account?section=notifications`;
}

/**
 * THE WHATSAPP NUDGE — one quiet line under a personal moment, for a person
 * who has not turned WhatsApp on: "Get these on WhatsApp — turn it on in your
 * account".
 *
 * Decided when the mail GOES, not when it was written, like the address and the
 * consent (outbox.ts): somebody who switched WhatsApp on between the auction
 * and the drain must not be asked to do what they just did. So the layout
 * leaves an invisible mark where the line belongs, and the drain either fills
 * it or leaves it — an HTML comment, which renders as nothing either way.
 */
export const WHATSAPP_NUDGE_MARK = "<!--da:whatsapp-nudge-->";

export function whatsappNudgeUrl(): string {
  return `${base()}/account#whatsapp`;
}

export function hasWhatsAppNudge(html: string): boolean {
  return html.includes(WHATSAPP_NUDGE_MARK);
}

/**
 * Fill the mark with the line (`show`), or leave the mail as written. A mail
 * without the mark is returned untouched whatever `show` says — which is how a
 * security mail can never carry it.
 */
export function applyWhatsAppNudge(
  mail: { readonly text: string; readonly html: string },
  show: boolean,
): { text: string; html: string } {
  if (!show || !hasWhatsAppNudge(mail.html)) {
    return { text: mail.text, html: mail.html };
  }
  const url = whatsappNudgeUrl();
  const html = mail.html.replace(
    WHATSAPP_NUDGE_MARK,
    `<p class="da-muted" style="margin:0 0 16px;font:14px/20px ${FONT};color:${MUTED};">Get these on WhatsApp — <a class="da-gold-text" href="${escape(url)}" style="color:${GOLD_TEXT};">turn it on in your account</a>.</p>`,
  );
  // The plain part: the line goes just above the footer rule ("—"), where the
  // HTML puts it — after the button, before the fine print.
  const line = `Get these on WhatsApp — turn it on in your account: ${url}`;
  const rule = mail.text.lastIndexOf("\n—\n");
  const text =
    rule === -1
      ? `${mail.text}\n\n${line}`
      : `${mail.text.slice(0, rule)}\n${line}\n${mail.text.slice(rule)}`;
  return { text, html };
}
