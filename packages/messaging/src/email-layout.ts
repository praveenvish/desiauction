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
 *
 * IN THIS PACKAGE, NOT THE WEB APP (email programme PR10): the finops runner
 * sends receipts and invoices and must lay them out the same way, so the one
 * layout lives where both can reach it. The site's address is a parameter —
 * apps/web binds its own (server/messaging/email-layout.ts), the runner its.
 */

export const SUPPORT_EMAIL = "support@desiauction.in";

export type EmailLanguage = "en" | "hi";

/** Whose mail this is: the season and club, shown above everything we say. */
export interface EmailBand {
  /** "Malad Premier League 2026" */
  readonly title: string;
  /** "Malad Cricket Club · Cricket" */
  readonly subtitle: string;
  /** Two letters for the crest ("MC") — clubs have no logo yet. */
  readonly monogram: string;
}

/** One step of the player's season: done, where they are now, or still ahead. */
export interface EmailStep {
  readonly label: string;
  readonly state: "done" | "now" | "next";
}

/**
 * The auction-night stage: a Floodlight panel at the top of the card, dark in
 * BOTH themes — the room's own look — for the moment a player is sold.
 */
export interface EmailStage {
  /** "SOLD" */
  readonly kicker: string;
  /** Initials in the ring — a player photo is a signed, expiring URL, never mailed. */
  readonly monogram: string;
  /** "Arjun → Cup Kings" */
  readonly title: string;
  /** "₹75,000" — the one number, large and gold. */
  readonly figure: string;
  /** "3× your base · 7 bids · 3 teams" */
  readonly line: string;
}

/** A calendar leaf: the date is the whole point of a reminder or a time change. */
export interface EmailDateLeaf {
  /** "OCT" / "अक्टू॰" */
  readonly month: string;
  /** "4" */
  readonly day: string;
  /** "SAT" / "शनि" */
  readonly weekday: string;
  /** "Malad Premier League 2026 auction" */
  readonly title: string;
  /** "8:00 pm IST" */
  readonly detail: string;
}

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
  /**
   * The last `after` paragraph as a highlighted box, its first sentence in
   * bold — "Didn't ask for this?" under a code, "If it wasn't you…" under a
   * security alert. The words stay the template's; only the setting is code.
   */
  readonly calloutLast?: boolean;
  /** The auction-night stage at the top of the card (a sale). Replaces the club band. */
  readonly stage?: EmailStage;
  /**
   * A document reproduced exactly — a receipt or an invoice — in a monospace
   * panel after the opening paragraphs. Never reflowed, never reworded.
   */
  readonly document?: string;
  /** A date tile after the opening paragraphs — auction night, a changed time. */
  readonly dateLeaf?: EmailDateLeaf;
  /** The club band at the top of the card (club and season mail). */
  readonly band?: EmailBand;
  /** The season tracker under the heading — Registered → Approved → Auction → Team. */
  readonly progress?: readonly EmailStep[];
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
const NOTICE = "#FDF4DE"; // gold-100 — a callout's fill
const NOTICE_EDGE = "#F3D078"; // gold-300
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
  notice: "#1C1608",
  noticeEdge: "#5E410B", // gold-900
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

const RULE_STRONG = "#D9D5CA"; // chalk-300 — a step still ahead

const MONO = "ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace";

function escape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function trimBase(publicBaseUrl: string): string {
  return publicBaseUrl.replace(/\/$/, "");
}

function paragraph(text: string, font: string): string {
  return `<p class="da-text" style="margin:0 0 16px;font:16px/26px ${font};color:${TEXT};">${escape(text)}</p>`;
}

/** The document as issued: every line where it was, in a monospace panel. */
function documentBlock(document: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" class="da-sunken" style="margin:4px 0 24px;background:${SUNKEN};border:1px solid ${RULE};border-radius:12px;"><tr><td class="da-heading" style="padding:16px 18px;font:13px/21px ${MONO};color:${INK};white-space:pre-wrap;word-break:break-word;">${escape(document)}</td></tr></table>`;
}

/** Big, alone, and copied as the digits only — the spacing is letter-spacing, not spaces. */
function codeBlock(code: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:6px 0 24px;"><tr><td align="center" class="da-sunken" style="background:${SUNKEN};border:1px solid ${RULE};border-radius:14px;padding:22px 12px;"><div class="da-heading" style="font:700 40px/48px ${MONO};letter-spacing:12px;padding-left:12px;color:${INK};">${escape(code)}</div></td></tr></table>`;
}

function button(action: { label: string; url: string }, font: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" class="da-btn-wrap" style="margin:8px 0 24px;"><tr><td align="center" style="background:${GOLD};border:1px solid ${GOLD_EDGE};border-radius:10px;"><a class="da-btn" href="${escape(action.url)}" style="display:inline-block;padding:14px 28px;font:700 16px/20px ${font};color:${ON_GOLD};text-decoration:none;border-radius:10px;">${escape(action.label)}</a></td></tr></table>`;
}

// The stage's own palette: the Floodlight room, whatever the reader's theme.
const STAGE_BG = "#0B1018"; // ink-900
const STAGE_PANEL = "#101623"; // ink-850
const STAGE_TEXT = "#C9D4E8"; // ink-200
const STAGE_HEADING = "#F6F9FF"; // ink-50
const STAGE_GOLD = "#F3D078"; // gold-300

function stageRow(stage: EmailStage, font: string): string {
  return `<tr><td class="da-stage" align="center" style="background:${STAGE_BG};border-radius:16px 16px 0 0;border-bottom:2px solid ${GOLD};padding:30px 32px 26px;"><div style="font:800 12px/16px ${FONT};letter-spacing:3px;color:${STAGE_GOLD};text-transform:uppercase;">${escape(stage.kicker)}</div><div style="width:80px;height:80px;border-radius:40px;border:2px solid ${GOLD};background:${STAGE_PANEL};margin:16px auto 14px;font:700 28px/80px ${FONT};color:${STAGE_HEADING};text-align:center;">${escape(stage.monogram)}</div><div style="font:700 21px/28px ${font};color:${STAGE_HEADING};">${escape(stage.title)}</div><div style="font:800 42px/50px ${FONT};color:${STAGE_GOLD};letter-spacing:-1px;font-variant-numeric:tabular-nums;margin-top:6px;">${escape(stage.figure)}</div>${stage.line === "" ? "" : `<div style="font:14px/20px ${font};color:${STAGE_TEXT};margin-top:6px;">${escape(stage.line)}</div>`}</td></tr>`;
}

/**
 * The club band: a crest (the club's initials — there is no logo to show) and
 * the season with its club and sport. Players know their tournament, not us.
 */
function bandRow(band: EmailBand, font: string): string {
  return `<tr><td class="da-band da-sunken da-rule" style="padding:14px 36px;background:${SUNKEN};border-bottom:1px solid ${RULE};border-radius:16px 16px 0 0;"><table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"><tr><td width="36" style="vertical-align:middle;"><div class="da-crest" style="width:36px;height:36px;border-radius:18px;background:${INK};color:${GOLD};font:700 13px/36px ${FONT};text-align:center;letter-spacing:0.5px;">${escape(band.monogram)}</div></td><td style="vertical-align:middle;padding-left:12px;"><div class="da-heading" style="font:700 15px/20px ${font};color:${INK};">${escape(band.title)}</div><div class="da-muted" style="font:13px/18px ${font};color:${MUTED};">${escape(band.subtitle)}</div></td></tr></table></td></tr>`;
}

/** Four dots and their names: where the player is in the season, at a glance. */
function progressRow(steps: readonly EmailStep[], font: string): string {
  const width = `${String(Math.floor(100 / Math.max(steps.length, 1)))}%`;
  const dot = (state: EmailStep["state"]): string => {
    if (state === "done") {
      return `<div style="width:26px;height:26px;border-radius:13px;background:${GOLD};border:1px solid ${GOLD_EDGE};color:${ON_GOLD};font:700 14px/26px ${FONT};text-align:center;margin:0 auto;">&#10003;</div>`;
    }
    if (state === "now") {
      return `<div class="da-now" style="width:22px;height:22px;border-radius:13px;border:2px solid ${INK};background:${CARD};margin:0 auto;"><div class="da-now-dot" style="width:10px;height:10px;border-radius:5px;background:${INK};margin:6px auto 0;"></div></div>`;
    }
    return `<div class="da-next" style="width:24px;height:24px;border-radius:13px;border:1px solid ${RULE_STRONG};background:${CARD};margin:0 auto;"></div>`;
  };
  const cells = steps
    .map((step) => {
      const now = step.state === "now";
      return `<td width="${width}" align="center" style="vertical-align:top;padding:0 2px;">${dot(step.state)}<div class="${now ? "da-heading" : "da-muted"}" style="margin-top:8px;font:${now ? "700" : "500"} 12px/16px ${font};color:${now ? INK : MUTED};">${escape(step.label)}</div></td>`;
    })
    .join("");
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:2px 0 24px;"><tr>${cells}</tr></table>`;
}

/** The leaf beside its title and time. Letter-spacing only on Latin capitals: it splits Devanagari. */
function dateLeafRow(leaf: EmailDateLeaf, font: string): string {
  const latin = /^[A-Z]+$/.test(leaf.month);
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:4px 0 22px;"><tr><td width="72" style="vertical-align:top;"><table role="presentation" cellpadding="0" cellspacing="0" border="0" width="72" class="da-leaf" style="border:1px solid ${RULE_STRONG};border-radius:12px;"><tr><td align="center" style="background:${GOLD};border-radius:11px 11px 0 0;font:800 11px/22px ${FONT};letter-spacing:${latin ? "2px" : "0"};color:${ON_GOLD};">${escape(leaf.month)}</td></tr><tr><td align="center" class="da-heading" style="font:800 30px/38px ${FONT};color:${INK};padding-top:4px;">${escape(leaf.day)}</td></tr><tr><td align="center" class="da-muted" style="font:600 ${latin ? "11px" : "12px"}/16px ${FONT};letter-spacing:${latin ? "1px" : "0"};color:${MUTED};padding-bottom:8px;">${escape(leaf.weekday)}</td></tr></table></td><td style="vertical-align:middle;padding-left:16px;"><div class="da-heading" style="font:700 17px/24px ${font};color:${INK};">${escape(leaf.title)}</div><div class="da-text" style="font:15px/22px ${font};color:${TEXT};margin-top:2px;">${escape(leaf.detail)}</div></td></tr></table>`;
}

/** "✓ Registered → ● Approved → ○ Auction → ○ Team" — the tracker, in plain text. */
function progressText(steps: readonly EmailStep[]): string {
  const mark = { done: "✓", now: "●", next: "○" } as const;
  return steps.map((step) => `${mark[step.state]} ${step.label}`).join(" → ");
}

/** "Didn't ask for this? You can ignore…" → the question in bold, the rest plain. */
function splitFirstSentence(text: string): [string, string] {
  const match = /^(.+?[.?!।])\s+(.+)$/su.exec(text);
  return match === null ? [text, ""] : [match[1] ?? text, match[2] ?? ""];
}

function callout(text: string, font: string): string {
  const [lead, rest] = splitFirstSentence(text);
  const body =
    rest === ""
      ? `<strong class="da-heading" style="color:${INK};">${escape(lead)}</strong>`
      : `<strong class="da-heading" style="color:${INK};">${escape(lead)}</strong> ${escape(rest)}`;
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" class="da-notice" style="margin:4px 0 20px;background:${NOTICE};border:1px solid ${NOTICE_EDGE};border-radius:12px;"><tr><td class="da-text" style="padding:14px 16px;font:14px/22px ${font};color:${TEXT};">${body}</td></tr></table>`;
}

/**
 * A value this short ("Mon 28 Sep, 7:42 pm IST", "₹1,50,000", "9 waiting · 3
 * days") stays on one line; the label beside it wraps instead. A long one
 * ("We call the number you gave us") wraps as prose.
 */
const SHORT_VALUE = 24;

function detailsTable(details: readonly (readonly [string, string])[], font: string): string {
  const rows = details
    .map(([label, value], i) => {
      const rule = i === 0 ? "" : `border-top:1px solid ${RULE};`;
      return `<tr><td class="da-muted da-rule" style="padding:11px 16px 11px 0;${rule}font:14px/20px ${font};color:${MUTED};vertical-align:top;">${escape(label)}</td><td class="da-heading da-rule" align="right" style="padding:11px 0;${rule}font:600 14px/20px ${font};color:${INK};text-align:right;vertical-align:top;font-variant-numeric:tabular-nums;${value.length <= SHORT_VALUE ? "white-space:nowrap;" : ""}">${escape(value)}</td></tr>`;
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
  .da-stage { padding-left:22px !important; padding-right:22px !important; }
  .da-band { padding-left:22px !important; padding-right:22px !important; }
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
  .da-notice { background:${DARK.notice} !important; border-color:${DARK.noticeEdge} !important; }
  .da-now, .da-next { background:${DARK.card} !important; border-color:${DARK.heading} !important; }
  .da-now-dot { background:${DARK.heading} !important; }
  .da-leaf { border-color:${DARK.rule} !important; }
  .da-crest { background:${DARK.heading} !important; color:${DARK.canvas} !important; }
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

export function renderEmail(content: EmailContent, publicBaseUrl: string): RenderedEmail {
  const siteUrl = trimBase(publicBaseUrl);
  const language = content.language ?? "en";
  const font = language === "hi" ? FONT_HI : FONT;
  const action = content.action === undefined ? "" : button(content.action, font);
  const first = content.actionFirst === true;
  const manage = content.noLinks === true ? undefined : content.manageUrl;
  const words = FOOTER_WORDS[language];
  const body = [
    ...content.paragraphs.map((p) => paragraph(p, font)),
    content.document === undefined ? "" : documentBlock(content.document),
    content.dateLeaf === undefined ? "" : dateLeafRow(content.dateLeaf, font),
    content.code === undefined ? "" : codeBlock(content.code),
    first ? action : "",
    content.details === undefined || content.details.length === 0
      ? ""
      : detailsTable(content.details, font),
    ...(content.after ?? []).map((p, i, all) =>
      content.calloutLast === true && i === all.length - 1 ? callout(p, font) : paragraph(p, font),
    ),
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
          footerLink("desiauction.in", publicBaseUrl),
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
<td style="vertical-align:middle;"><img src="${escape(`${siteUrl}/brand/mark.png`)}" width="32" height="32" alt="" style="display:block;border:0;border-radius:8px;"></td>
<td class="da-heading" style="vertical-align:middle;padding-left:10px;font:700 18px/24px ${FONT};color:${INK};letter-spacing:-0.2px;">Desi<span class="da-gold-text" style="color:${GOLD_TEXT};">Auction</span></td>
</tr></table>
</td></tr>
<tr><td>
<table role="article" aria-roledescription="email" aria-label="${escape(content.heading)}" lang="${language}" cellpadding="0" cellspacing="0" border="0" width="100%" class="da-card" style="background:${CARD};border:1px solid ${RULE};border-radius:16px;">
${content.stage !== undefined ? stageRow(content.stage, font) : content.band === undefined ? "" : bandRow(content.band, font)}
<tr><td class="da-body" style="padding:32px 36px 12px;">
<h1 class="da-heading" style="margin:0 0 16px;font:700 24px/32px ${font};color:${INK};letter-spacing:-0.3px;">${escape(content.heading)}</h1>
${content.progress === undefined || content.progress.length === 0 ? "" : progressRow(content.progress, font)}
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
    ...(content.stage === undefined
      ? []
      : [
          `${content.stage.kicker}: ${content.stage.title} — ${content.stage.figure}`,
          ...(content.stage.line === "" ? [] : [content.stage.line]),
          "",
        ]),
    ...(content.stage !== undefined || content.band === undefined
      ? []
      : [`${content.band.title} · ${content.band.subtitle}`, ""]),
    content.heading,
    "",
    ...(content.progress === undefined || content.progress.length === 0
      ? []
      : [progressText(content.progress), ""]),
    ...content.paragraphs.flatMap((p) => [p, ""]),
    ...(content.document === undefined ? [] : [content.document, ""]),
    ...(content.dateLeaf === undefined
      ? []
      : [
          `  ${content.dateLeaf.weekday} ${content.dateLeaf.day} ${content.dateLeaf.month} — ${content.dateLeaf.title}, ${content.dateLeaf.detail}`,
          "",
        ]),
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
      : `DesiAuction · ${publicBaseUrl} · ${words.help}: ${SUPPORT_EMAIL}`,
  ].join("\n");

  return { html, text };
}

/** Where "Manage emails" goes: the notification switches on /account. */
export function manageEmailsUrl(publicBaseUrl: string): string {
  return `${trimBase(publicBaseUrl)}/account?section=notifications`;
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

export function whatsappNudgeUrl(publicBaseUrl: string): string {
  return `${trimBase(publicBaseUrl)}/account#whatsapp`;
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
  publicBaseUrl: string,
): { text: string; html: string } {
  if (!show || !hasWhatsAppNudge(mail.html)) {
    return { text: mail.text, html: mail.html };
  }
  const url = whatsappNudgeUrl(publicBaseUrl);
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
