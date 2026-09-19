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
 * never disagree. The HTML is what every client supports: tables, inline
 * styles, no web fonts, no CSS classes, no images but the logo (and the mail
 * reads fine with images blocked). Every dynamic string is escaped.
 *
 * The internal team alerts (a new problem report, a new review, a new demo
 * request) stay plain text: nobody outside the team sees them.
 */

export const SUPPORT_EMAIL = "support@desiauction.in";

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
}

export interface RenderedEmail {
  readonly html: string;
  readonly text: string;
}

// The console's own palette, as literal colours: mail clients ignore CSS
// variables. Warm neutrals, gold only for the brand, ink for the action.
const INK = "#1A1814";
const TEXT = "#2B2822";
const MUTED = "#6B6559";
const RULE = "#E7E4DC";
const CANVAS = "#F7F6F2";
const CARD = "#FFFFFF";
const GOLD_TEXT = "#8A6410";
const CODE_BG = "#F7F6F2";

const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const MONO = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";

function escape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** An absolute URL on our own host, for the logo. */
function asset(path: string): string {
  return `${env.PUBLIC_BASE_URL.replace(/\/$/, "")}${path}`;
}

function paragraph(text: string): string {
  return `<p style="margin:0 0 16px;font:16px/24px ${FONT};color:${TEXT};">${escape(text)}</p>`;
}

function codeBlock(code: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 24px;"><tr><td style="background:${CODE_BG};border:1px solid ${RULE};border-radius:12px;padding:16px 24px;font:600 32px/40px ${MONO};letter-spacing:8px;color:${INK};">${escape(code)}</td></tr></table>`;
}

function button(action: { label: string; url: string }): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 24px;"><tr><td style="background:${INK};border-radius:10px;"><a href="${escape(action.url)}" style="display:inline-block;padding:14px 24px;font:600 15px/20px ${FONT};color:#FFFFFF;text-decoration:none;border-radius:10px;">${escape(action.label)}</a></td></tr></table>`;
}

function detailsTable(details: readonly (readonly [string, string])[]): string {
  const rows = details
    .map(
      ([label, value]) =>
        `<tr><td style="padding:10px 16px 10px 0;border-top:1px solid ${RULE};font:14px/20px ${FONT};color:${MUTED};white-space:nowrap;vertical-align:top;">${escape(label)}</td><td style="padding:10px 0;border-top:1px solid ${RULE};font:600 14px/20px ${FONT};color:${TEXT};">${escape(value)}</td></tr>`,
    )
    .join("");
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:8px 0 24px;border-bottom:1px solid ${RULE};">${rows}</table>`;
}

export function renderEmail(content: EmailContent): RenderedEmail {
  const action = content.action === undefined ? "" : button(content.action);
  const first = content.actionFirst === true;
  const body = [
    ...content.paragraphs.map(paragraph),
    content.code === undefined ? "" : codeBlock(content.code),
    first ? action : "",
    content.details === undefined || content.details.length === 0
      ? ""
      : detailsTable(content.details),
    ...(content.after ?? []).map(paragraph),
    first ? "" : action,
  ].join("");

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${escape(content.heading)}</title>
</head>
<body style="margin:0;padding:0;background:${CANVAS};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:${CANVAS};">${escape(content.preheader)}</div>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:${CANVAS};">
<tr><td align="center" style="padding:32px 16px;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:560px;">
<tr><td style="padding:0 4px 20px;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
<td style="vertical-align:middle;"><img src="${escape(asset("/brand/mark.png"))}" width="36" height="36" alt="" style="display:block;border:0;border-radius:9px;"></td>
<td style="vertical-align:middle;padding-left:10px;font:700 18px/24px ${FONT};color:${INK};letter-spacing:-0.2px;">Desi<span style="color:${GOLD_TEXT};">Auction</span></td>
</tr></table>
</td></tr>
<tr><td style="background:${CARD};border:1px solid ${RULE};border-radius:16px;padding:32px 32px 16px;">
<h1 style="margin:0 0 16px;font:700 22px/30px ${FONT};color:${INK};letter-spacing:-0.2px;">${escape(content.heading)}</h1>
${body}
</td></tr>
<tr><td style="padding:20px 4px 0;font:13px/20px ${FONT};color:${MUTED};">
<p style="margin:0 0 8px;">${escape(content.footnote)}</p>
${content.noLinks === true ? `<p style="margin:0;">DesiAuction &middot; Help: ${SUPPORT_EMAIL}</p>` : `<p style="margin:0;">DesiAuction &middot; <a href="${escape(env.PUBLIC_BASE_URL)}" style="color:${MUTED};">desiauction.in</a> &middot; Help: <a href="mailto:${SUPPORT_EMAIL}" style="color:${MUTED};">${SUPPORT_EMAIL}</a></p>`}
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
    content.noLinks === true
      ? `DesiAuction · Help: ${SUPPORT_EMAIL}`
      : `DesiAuction · ${env.PUBLIC_BASE_URL} · Help: ${SUPPORT_EMAIL}`,
  ].join("\n");

  return { html, text };
}
