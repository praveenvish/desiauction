// EMAIL V2 MOCKUPS (PR0) — the approved look, before any product code changes.
//
//   node docs/design/email-v2/build-mockups.mjs [--logo=<src>] [--out=<dir>]
//
// Writes one real email document per mail × language (table layout, inline
// styles, a <style> block only for phone width and dark mode — what Gmail,
// Apple Mail and Outlook actually render) plus `gallery.html`, which shows
// every mail at phone and desktop width, light and dark, English and Hindi.
//
// This file is a SPEC, not the implementation: PR1 moves the layout into
// apps/web/src/server/messaging/email-layout.ts and the wording into
// packages/messaging/src/email-template-defaults.ts. Sample people and clubs
// are the same ones the admin preview uses (template-preview.ts).

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const arg = (name, fallback) =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const OUT = arg("out", join(here, "mockups"));
const LOGO = arg("logo", "https://desiauction.in/brand/mark.png");

// ---------------------------------------------------------------------------
// Palette — the design tokens (packages/ui/tokens), as literals: mail clients
// ignore CSS variables. Daylight for light, Floodlight for dark.
// ---------------------------------------------------------------------------
const L = {
  canvas: "#F7F6F2", // chalk-50
  card: "#FFFFFF",
  sunken: "#F0EEE8", // chalk-100
  rule: "#E7E4DC", // chalk-200
  ruleStrong: "#D9D5CA", // chalk-300
  heading: "#1A1814", // chalk-800
  text: "#2B2822", // chalk-700
  muted: "#58534A", // chalk-600 (AA on white and on canvas)
  gold: "#F0B43C", // gold-400 — fills only
  goldEdge: "#B57F14", // gold-700 — rims and lines
  goldInk: "#865D12", // gold-800 — gold TEXT on light
  onGold: "#070A0F", // ink-950 — text on a gold fill
  amber: "#B87D08", // warning, strong
  amberTint: "#FDF4DE", // gold-100
};
const D = {
  canvas: "#070A0F", // ink-950
  card: "#101623", // ink-850
  sunken: "#0B1018", // ink-900
  rule: "#1F2A3D", // ink-700
  heading: "#E8EEF9", // ink-100
  text: "#C9D4E8", // ink-200
  muted: "#9FB0CC", // ink-300
  goldInk: "#F3D078", // gold-300
};
// The celebration panel is Floodlight in BOTH themes — the auction room's own look.
const STAGE = { bg: "#0B1018", panel: "#101623", text: "#C9D4E8", heading: "#F6F9FF", gold: "#F3D078", rule: "#2C3A52" };

const FONT_EN =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
// Devanagari first for Hindi: every phone has one of these, and without them
// Windows falls back to a face whose matras collide with the line above.
const FONT_HI =
  "'Noto Sans Devanagari', 'Kohinoor Devanagari', 'Nirmala UI', Mangal, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif";
const MONO = "ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace";

const esc = (s) =>
  String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

// ---------------------------------------------------------------------------
// Blocks. Each returns table rows/cells with inline styles; `da-*` classes are
// hooks for the phone and dark rules in <style> only — the mail reads fully
// without them (Gmail on some Android builds strips <style>).
// ---------------------------------------------------------------------------

function brandBar(f) {
  return `<tr><td class="da-pad-x" style="padding:0 8px 18px;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
<td style="vertical-align:middle;"><img src="${esc(LOGO)}" width="32" height="32" alt="" style="display:block;border:0;border-radius:8px;"></td>
<td style="vertical-align:middle;padding-left:10px;font:700 18px/24px ${FONT_EN};color:${L.heading};letter-spacing:-0.2px;" class="da-heading">Desi<span class="da-gold-ink" style="color:${L.goldInk};">Auction</span></td>
</tr></table></td></tr>`;
}

/** Who this is about: the club and season, before anything we say. */
function clubBand(club, f) {
  return `<tr><td class="da-band" style="padding:14px 32px;border-bottom:1px solid ${L.rule};background:${L.sunken};border-radius:16px 16px 0 0;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"><tr>
<td width="36" style="vertical-align:middle;"><div class="da-crest" style="width:36px;height:36px;border-radius:18px;background:${L.heading};color:${L.gold};font:700 13px/36px ${FONT_EN};text-align:center;letter-spacing:0.5px;">${esc(club.initials)}</div></td>
<td style="vertical-align:middle;padding-left:12px;">
<div class="da-heading" style="font:700 15px/20px ${f};color:${L.heading};">${esc(club.season)}</div>
<div class="da-muted" style="font:13px/18px ${f};color:${L.muted};">${esc(club.name)} · ${esc(club.sport)}</div>
</td></tr></table></td></tr>`;
}

function heading(text, f) {
  return `<h1 class="da-heading" style="margin:0 0 14px;font:700 24px/32px ${f};color:${L.heading};letter-spacing:-0.3px;">${esc(text)}</h1>`;
}

function p(text, f, extra = "") {
  return `<p class="da-text" style="margin:0 0 16px;font:16px/26px ${f};color:${L.text};${extra}">${esc(text)}</p>`;
}

function small(text, f) {
  return `<p class="da-muted" style="margin:0 0 12px;font:14px/22px ${f};color:${L.muted};">${esc(text)}</p>`;
}

function button(label, url, f) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" class="da-btn-wrap" style="margin:8px 0 24px;"><tr>
<td class="da-btn-cell" align="center" style="background:${L.gold};border:1px solid ${L.goldEdge};border-radius:10px;">
<a class="da-btn" href="${esc(url)}" style="display:inline-block;padding:14px 28px;font:700 16px/20px ${f};color:${L.onGold};text-decoration:none;border-radius:10px;">${esc(label)}</a>
</td></tr></table>`;
}

function textLink(label, url, f) {
  return `<p style="margin:-8px 0 24px;font:600 15px/22px ${f};"><a class="da-gold-ink" href="${esc(url)}" style="color:${L.goldInk};text-decoration:underline;">${esc(label)}</a></p>`;
}

function facts(rows, f) {
  const tr = rows
    .map(
      ([k, v], i) =>
        `<tr><td class="da-muted da-rule" style="padding:11px 16px 11px 0;${i ? `border-top:1px solid ${L.rule};` : ""}font:14px/20px ${f};color:${L.muted};vertical-align:top;white-space:nowrap;">${esc(k)}</td><td class="da-heading da-rule" align="right" style="padding:11px 0;${i ? `border-top:1px solid ${L.rule};` : ""}font:600 14px/20px ${f};color:${L.heading};font-variant-numeric:tabular-nums;">${esc(v)}</td></tr>`,
    )
    .join("");
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" class="da-sunken" style="margin:4px 0 24px;background:${L.sunken};border-radius:12px;"><tr><td style="padding:4px 18px;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">${tr}</table></td></tr></table>`;
}

/** The one-time code: big, alone, copies as six digits with no spaces. */
function codeBlock(code, expiry, f) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:6px 0 10px;"><tr>
<td align="center" class="da-sunken" style="background:${L.sunken};border:1px solid ${L.rule};border-radius:14px;padding:22px 12px;">
<div class="da-heading" style="font:700 40px/48px ${MONO};letter-spacing:12px;padding-left:12px;color:${L.heading};">${esc(code)}</div>
</td></tr></table>
<p class="da-muted" style="margin:0 0 22px;font:14px/20px ${f};color:${L.muted};text-align:center;">${esc(expiry)}</p>`;
}

/**
 * Where the player is in the season. The same four steps on every player
 * mail, so each one answers "where am I?" before it says anything else.
 * state: done | now | next | off (a waitlist or a decline stops the line).
 */
function stepper(steps, f) {
  const dot = (s) => {
    if (s.state === "done")
      return `<div style="width:26px;height:26px;border-radius:13px;background:${L.gold};border:1px solid ${L.goldEdge};color:${L.onGold};font:700 14px/26px ${FONT_EN};text-align:center;margin:0 auto;">&#10003;</div>`;
    if (s.state === "now")
      return `<div class="da-now" style="width:22px;height:22px;border-radius:13px;border:2px solid ${L.heading};background:${L.card};margin:0 auto;"><div class="da-now-dot" style="width:10px;height:10px;border-radius:5px;background:${L.heading};margin:6px auto 0;"></div></div>`;
    if (s.state === "off")
      return `<div style="width:24px;height:24px;border-radius:13px;border:1px dashed ${L.ruleStrong};margin:0 auto;"></div>`;
    return `<div class="da-next" style="width:24px;height:24px;border-radius:13px;border:1px solid ${L.ruleStrong};background:${L.card};margin:0 auto;"></div>`;
  };
  const cells = steps
    .map(
      (s) =>
        `<td width="25%" align="center" style="vertical-align:top;padding:0 2px;">${dot(s)}<div class="${s.state === "now" ? "da-heading" : "da-muted"}" style="margin-top:8px;font:${s.state === "now" ? 700 : 500} 12px/16px ${f};color:${s.state === "now" ? L.heading : L.muted};">${esc(s.label)}</div></td>`,
    )
    .join("");
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:2px 0 26px;"><tr>${cells}</tr></table>`;
}

/** The auction-night panel: Floodlight in both themes, gold price. */
function stage({ kicker, initials, title, price, line }, f) {
  return `<tr><td class="da-stage" style="background:${STAGE.bg};border-radius:16px 16px 0 0;border-bottom:2px solid ${L.gold};padding:32px 32px 28px;" align="center">
<div style="font:800 12px/16px ${FONT_EN};letter-spacing:3px;color:${STAGE.gold};text-transform:uppercase;">${esc(kicker)}</div>
<div style="width:84px;height:84px;border-radius:42px;border:2px solid ${L.gold};background:${STAGE.panel};margin:18px auto 16px;font:700 30px/84px ${FONT_EN};color:${STAGE.heading};text-align:center;">${esc(initials)}</div>
<div style="font:700 22px/30px ${f};color:${STAGE.heading};">${esc(title)}</div>
<div style="font:800 44px/52px ${FONT_EN};color:${STAGE.gold};letter-spacing:-1px;font-variant-numeric:tabular-nums;margin-top:6px;">${esc(price)}</div>
<div style="font:14px/20px ${f};color:${STAGE.text};margin-top:6px;">${esc(line)}</div>
</td></tr>`;
}

/** A calendar leaf: the date is the whole point of a reminder. */
function dateLeaf({ month, day, weekday, title, when }, f) {
  // Letter-spacing splits Devanagari conjuncts apart; Latin capitals only.
  const latin = /^[A-Z]+$/.test(month);
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:4px 0 22px;"><tr>
<td width="72" style="vertical-align:top;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="72" style="border:1px solid ${L.ruleStrong};border-radius:12px;" class="da-leaf">
<tr><td align="center" style="background:${L.gold};border-radius:11px 11px 0 0;font:800 11px/22px ${FONT_EN};letter-spacing:${latin ? 2 : 0}px;color:${L.onGold};">${esc(month)}</td></tr>
<tr><td align="center" class="da-heading" style="font:800 30px/38px ${FONT_EN};color:${L.heading};padding-top:4px;">${esc(day)}</td></tr>
<tr><td align="center" class="da-muted" style="font:600 ${latin ? 11 : 12}px/16px ${FONT_EN};letter-spacing:${latin ? 1 : 0}px;color:${L.muted};padding-bottom:8px;">${esc(weekday)}</td></tr>
</table></td>
<td style="vertical-align:middle;padding-left:16px;">
<div class="da-heading" style="font:700 17px/24px ${f};color:${L.heading};">${esc(title)}</div>
<div class="da-text" style="font:15px/22px ${f};color:${L.text};margin-top:2px;">${esc(when)}</div>
</td></tr></table>`;
}

function footer(lines, links, f) {
  const linkRow = links
    ? `<p style="margin:0;">DesiAuction · <a class="da-muted" href="https://desiauction.in" style="color:${L.muted};">desiauction.in</a> · <a class="da-muted" href="https://desiauction.in/account#notifications" style="color:${L.muted};">${esc(links)}</a></p>`
    : `<p style="margin:0;">DesiAuction · support@desiauction.in</p>`;
  return `<tr><td class="da-pad-x da-muted" style="padding:22px 8px 0;font:13px/20px ${f};color:${L.muted};">
${lines.map((l) => `<p style="margin:0 0 8px;">${esc(l)}</p>`).join("")}
${linkRow}
</td></tr>`;
}

/**
 * The document. `top` goes above the white body (a club band, the stage);
 * `body` inside it. Phone and dark rules are progressive: everything above
 * is already a complete, readable light mail.
 */
function page({ lang, subject, preheader, top = "", body, foot }) {
  const f = lang === "hi" ? FONT_HI : FONT_EN;
  return `<!doctype html>
<html lang="${lang}" dir="ltr" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${esc(subject)}</title>
<style>
  body { margin:0; padding:0; -webkit-text-size-adjust:100%; }
  a { text-decoration-thickness:1px; text-underline-offset:2px; }
  @media (max-width: 520px) {
    .da-outer { padding:20px 12px 28px !important; }
    .da-body { padding:26px 22px 8px !important; }
    .da-band, .da-stage { padding-left:22px !important; padding-right:22px !important; }
    .da-btn-wrap { width:100% !important; }
    .da-btn { display:block !important; }
  }
  /*da:dark*/
  @media (prefers-color-scheme: dark) {
    .da-canvas { background:${D.canvas} !important; }
    .da-card { background:${D.card} !important; border-color:${D.rule} !important; }
    .da-band, .da-sunken { background:${D.sunken} !important; border-color:${D.rule} !important; }
    .da-heading { color:${D.heading} !important; }
    .da-text { color:${D.text} !important; }
    .da-muted { color:${D.muted} !important; }
    .da-gold-ink { color:${D.goldInk} !important; }
    .da-rule { border-color:${D.rule} !important; }
    .da-crest { background:${D.heading} !important; color:#070A0F !important; }
    .da-now, .da-next { background:${D.card} !important; border-color:${D.heading} !important; }
    .da-now-dot { background:${D.heading} !important; }
    .da-leaf { border-color:${D.rule} !important; }
    .da-callout { background:#1C1608 !important; border-color:#5E410B !important; }
  }
  /*/da:dark*/
</style>
</head>
<body class="da-canvas" style="margin:0;padding:0;background:${L.canvas};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;">${esc(preheader)}${"&#8199;&#847; ".repeat(40)}</div>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" class="da-canvas" style="background:${L.canvas};">
<tr><td align="center" class="da-outer" style="padding:36px 16px 40px;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:580px;">
${brandBar(f)}
<tr><td>
<table role="article" aria-roledescription="email" aria-label="${esc(subject)}" lang="${lang}" cellpadding="0" cellspacing="0" border="0" width="100%" class="da-card" style="background:${L.card};border:1px solid ${L.rule};border-radius:16px;">
${top}
<tr><td class="da-body" style="padding:32px 36px 12px;">
${body}
</td></tr>
</table>
</td></tr>
${foot}
</table>
</td></tr>
</table>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// The five mails, in both languages. Wording follows the product's voice:
// plain, warm, no exclamation marks except the one a sale has earned, and no
// red for a person's outcome (C-23).
// ---------------------------------------------------------------------------

const CLUB = {
  en: { initials: "MC", season: "Malad Premier League 2026", name: "Malad Cricket Club", sport: "Cricket" },
  hi: { initials: "MC", season: "Malad Premier League 2026", name: "Malad Cricket Club", sport: "क्रिकेट" },
};
const URL = "https://desiauction.in/home";

const STEPS = {
  en: ["Registered", "Approved", "Auction", "Team"],
  hi: ["रजिस्टर", "मंज़ूर", "नीलामी", "टीम"],
};
const steps = (lang, states) => STEPS[lang].map((label, i) => ({ label, state: states[i] }));

const MAILS = {
  // 1 ─ The sign-in code. No links anywhere (a code cannot be followed out of
  //     a forwarded mail; a link can). The code leads the subject so the lock
  //     screen shows it and Gmail offers "Copy code".
  "auth-code": {
    title: "Sign-in code",
    en: () => {
      const f = FONT_EN;
      return {
        subject: "482913 is your DesiAuction sign-in code",
        preheader: "It works for 15 minutes. Nobody from DesiAuction will ever ask you for it.",
        body:
          heading("Your sign-in code", f) +
          p("Enter this code on the DesiAuction sign-in page to continue.", f) +
          codeBlock("482913", "Expires at 7:57 pm IST · in 15 minutes", f) +
          facts(
            [
              ["Requested from", "Chrome on macOS"],
              ["When", "Sun 28 Sep, 7:42 pm IST"],
              ["For", "arjun.sharma@gmail.com"],
            ],
            f,
          ) +
          `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" class="da-callout" style="margin:0 0 20px;background:${L.amberTint};border:1px solid #F3D078;border-radius:12px;"><tr><td style="padding:14px 16px;font:14px/21px ${f};" class="da-text">
<strong class="da-heading" style="color:${L.heading};">Didn't ask for this?</strong> You can ignore this email. Nobody can sign in without the code, and DesiAuction will never call or message you to ask for it.</td></tr></table>`,
        foot: footer(["You received this because this address was entered on the DesiAuction sign-in page."], null, f),
      };
    },
    hi: () => {
      const f = FONT_HI;
      return {
        subject: "482913 आपका DesiAuction साइन-इन कोड है",
        preheader: "यह 15 मिनट तक चलेगा। DesiAuction कभी भी आपसे यह कोड नहीं माँगेगा।",
        body:
          heading("आपका साइन-इन कोड", f) +
          p("आगे बढ़ने के लिए यह कोड DesiAuction के साइन-इन पेज पर डालें।", f) +
          codeBlock("482913", "शाम 7:57 बजे (IST) तक · 15 मिनट में ख़त्म", f) +
          facts(
            [
              ["कहाँ से माँगा गया", "Chrome, macOS पर"],
              ["कब", "रवि 28 सित॰, शाम 7:42 (IST)"],
              ["किसके लिए", "arjun.sharma@gmail.com"],
            ],
            f,
          ) +
          `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" class="da-callout" style="margin:0 0 20px;background:${L.amberTint};border:1px solid #F3D078;border-radius:12px;"><tr><td style="padding:14px 16px;font:14px/22px ${f};" class="da-text">
<strong class="da-heading" style="color:${L.heading};">आपने यह नहीं माँगा?</strong> इस ईमेल को अनदेखा करें। कोड के बिना कोई साइन इन नहीं कर सकता, और DesiAuction कभी फ़ोन या मैसेज करके यह कोड नहीं माँगेगा।</td></tr></table>`,
        foot: footer(["आपको यह इसलिए मिला क्योंकि DesiAuction के साइन-इन पेज पर यह पता डाला गया था।"], null, f),
      };
    },
  },

  // 2 ─ NEW: registration received. The first mail a player ever gets from us.
  "registration-received": {
    title: "Registration received",
    en: () => {
      const f = FONT_EN;
      return {
        subject: "You're registered for Malad Premier League 2026",
        preheader: "Malad Cricket Club reviews every registration. Here's what you sent them.",
        top: clubBand(CLUB.en, f),
        body:
          heading("We've got your registration", f) +
          stepper(steps("en", ["done", "now", "next", "next"]), f) +
          p("Hi Arjun, thanks for registering. Malad Cricket Club reviews every player before auction day, and we'll email you as soon as they decide.", f) +
          facts(
            [
              ["Role", "All-rounder"],
              ["Batting", "Right-hand"],
              ["Bowling", "Right-arm medium"],
              ["Photo", "Added"],
              ["Auction day", "Sat 4 Oct, 8:00 pm"],
            ],
            f,
          ) +
          button("See your registration", URL, f) +
          small("Spotted a mistake? You can change your details until the organizer approves them.", f),
        foot: footer(
          ["You received this because you registered for Malad Premier League 2026 on DesiAuction."],
          "Manage emails",
          f,
        ),
      };
    },
    hi: () => {
      const f = FONT_HI;
      return {
        subject: "Malad Premier League 2026 के लिए आपका रजिस्ट्रेशन हो गया",
        preheader: "Malad Cricket Club हर रजिस्ट्रेशन देखता है। आपने जो भेजा, वह नीचे है।",
        top: clubBand(CLUB.hi, f),
        body:
          heading("आपका रजिस्ट्रेशन हमें मिल गया", f) +
          stepper(steps("hi", ["done", "now", "next", "next"]), f) +
          p("नमस्ते Arjun, रजिस्टर करने के लिए धन्यवाद। Malad Cricket Club नीलामी से पहले हर खिलाड़ी को देखता है — फ़ैसला होते ही हम आपको ईमेल करेंगे।", f) +
          facts(
            [
              ["भूमिका", "ऑल-राउंडर"],
              ["बल्लेबाज़ी", "दाएँ हाथ से"],
              ["गेंदबाज़ी", "दाएँ हाथ, मीडियम"],
              ["फ़ोटो", "लगी है"],
              ["नीलामी", "शनि 4 अक्टू॰, रात 8:00"],
            ],
            f,
          ) +
          button("अपना रजिस्ट्रेशन देखें", URL, f) +
          small("कुछ ग़लत दिखा? आयोजक के मंज़ूरी देने तक आप अपनी जानकारी बदल सकते हैं।", f),
        foot: footer(["आपको यह इसलिए मिला क्योंकि आपने DesiAuction पर Malad Premier League 2026 के लिए रजिस्टर किया।"], "ईमेल सेटिंग", f),
      };
    },
  },

  // 3 ─ Approved: same band, the line moves one step.
  "registration-approved": {
    title: "Registration approved",
    en: () => {
      const f = FONT_EN;
      return {
        subject: "You're in — Malad Premier League 2026",
        preheader: "You're in the player pool for auction night, Sat 4 Oct at 8:00 pm.",
        top: clubBand(CLUB.en, f),
        body:
          heading("You're in the auction pool", f) +
          stepper(steps("en", ["done", "done", "now", "next"]), f) +
          p("Hi Arjun, Malad Cricket Club approved your registration. You're one of 43 players eight teams will bid on.", f) +
          dateLeaf({ month: "OCT", day: "4", weekday: "SAT", title: "Auction night", when: "8:00 pm IST · watch it live on DesiAuction" }, f) +
          button("See your player page", URL, f) +
          small("We'll email you the moment a team buys you.", f),
        foot: footer(
          ["You received this because you registered for Malad Premier League 2026 on DesiAuction."],
          "Manage emails",
          f,
        ),
      };
    },
    hi: () => {
      const f = FONT_HI;
      return {
        subject: "आप चुन लिए गए — Malad Premier League 2026",
        preheader: "नीलामी की रात, शनि 4 अक्टूबर रात 8 बजे, आप खिलाड़ियों की सूची में हैं।",
        top: clubBand(CLUB.hi, f),
        body:
          heading("आप नीलामी की सूची में हैं", f) +
          stepper(steps("hi", ["done", "done", "now", "next"]), f) +
          p("नमस्ते Arjun, Malad Cricket Club ने आपका रजिस्ट्रेशन मंज़ूर कर दिया है। आठ टीमें जिन 43 खिलाड़ियों पर बोली लगाएँगी, उनमें आप भी हैं।", f) +
          dateLeaf({ month: "अक्टू॰", day: "4", weekday: "शनि", title: "नीलामी की रात", when: "रात 8:00 (IST) · DesiAuction पर लाइव देखें" }, f) +
          button("अपना प्लेयर पेज देखें", URL, f) +
          small("जैसे ही कोई टीम आपको ख़रीदेगी, हम आपको ईमेल करेंगे।", f),
        foot: footer(["आपको यह इसलिए मिला क्योंकि आपने DesiAuction पर Malad Premier League 2026 के लिए रजिस्टर किया।"], "ईमेल सेटिंग", f),
      };
    },
  },

  // 4 ─ Sold. The best mail we will ever send a player.
  sold: {
    title: "Sold at auction",
    en: () => {
      const f = FONT_EN;
      return {
        subject: "Sold to Cup Kings for ₹75,000",
        preheader: "Cup Kings, Tigers and Falcons all bid for you. Cup Kings won.",
        top: stage({ kicker: "Sold", initials: "AS", title: "Arjun Sharma → Cup Kings", price: "₹75,000", line: "3× your base price · 7 bids · 3 teams chased you" }, f),
        body:
          heading("Congratulations, Arjun", f) +
          stepper(steps("en", ["done", "done", "done", "now"]), f) +
          p("Cup Kings bought you in the Malad Premier League 2026 auction. You were the most expensive buy of the night.", f) +
          button("Share your player card", URL, f) +
          textLink("See your Cup Kings squad", URL, f) +
          facts(
            [
              ["Arjun Sharma", "₹75,000"],
              ["Vikram Patel", "Captain · ₹25,000"],
              ["Rohit Nair", "₹40,000"],
            ],
            f,
          ) +
          small("Your squad so far. Malad Cricket Club will share fixtures next.", f),
        foot: footer(["You received this because you played in the Malad Premier League 2026 auction."], "Manage emails", f),
      };
    },
    hi: () => {
      const f = FONT_HI;
      return {
        subject: "Cup Kings ने आपको ₹75,000 में ख़रीदा",
        preheader: "Cup Kings, Tigers और Falcons — तीनों ने आप पर बोली लगाई। Cup Kings जीती।",
        top: stage({ kicker: "Sold", initials: "AS", title: "Arjun Sharma → Cup Kings", price: "₹75,000", line: "बेस प्राइस का 3 गुना · 7 बोलियाँ · 3 टीमें" }, f),
        body:
          heading("बधाई हो, Arjun", f) +
          stepper(steps("hi", ["done", "done", "done", "now"]), f) +
          p("Malad Premier League 2026 की नीलामी में Cup Kings ने आपको ख़रीदा। आप इस रात की सबसे महँगी ख़रीद रहे।", f) +
          button("अपना प्लेयर कार्ड शेयर करें", URL, f) +
          textLink("अपनी Cup Kings टीम देखें", URL, f) +
          facts(
            [
              ["Arjun Sharma", "₹75,000"],
              ["Vikram Patel", "कप्तान · ₹25,000"],
              ["Rohit Nair", "₹40,000"],
            ],
            f,
          ) +
          small("अब तक की आपकी टीम। मैचों की जानकारी Malad Cricket Club जल्द भेजेगा।", f),
        foot: footer(["आपको यह इसलिए मिला क्योंकि आप Malad Premier League 2026 की नीलामी में थे।"], "ईमेल सेटिंग", f),
      };
    },
  },

  // 5 ─ NEW: the owner's T-24h reminder (canon C-19: T-24h and T-30m).
  "owner-reminder": {
    title: "Auction tomorrow (owner)",
    en: () => {
      const f = FONT_EN;
      return {
        subject: "Tomorrow 8:00 pm — the Malad Premier League 2026 auction",
        preheader: "Cup Kings starts with ₹1,50,000 to spend. Here's your room link.",
        top: clubBand(CLUB.en, f),
        body:
          heading("Your auction is tomorrow", f) +
          dateLeaf({ month: "OCT", day: "4", weekday: "SAT", title: "Malad Premier League 2026 auction", when: "8:00 pm IST · about 2 hours" }, f) +
          p("Hi Rahul, you're bidding for Cup Kings. Open your owner room a few minutes early so your paddle is ready when the first player comes up.", f) +
          facts(
            [
              ["Your team", "Cup Kings"],
              ["Purse", "₹1,50,000"],
              ["Squad size", "8 to 15 players"],
              ["Already signed", "Vikram Patel (Captain)"],
              ["Player pool", "43 players"],
            ],
            f,
          ) +
          button("Open your owner room", URL, f) +
          small("Works on a phone or a laptop. The auctioneer can't start until every team's paddle is in, so please join on time.", f),
        foot: footer(["You received this because you own Cup Kings in Malad Premier League 2026."], "Manage emails", f),
      };
    },
    hi: () => {
      const f = FONT_HI;
      return {
        subject: "कल रात 8:00 बजे — Malad Premier League 2026 की नीलामी",
        preheader: "Cup Kings के पास ख़र्च करने को ₹1,50,000 हैं। आपके रूम का लिंक अंदर है।",
        top: clubBand(CLUB.hi, f),
        body:
          heading("आपकी नीलामी कल है", f) +
          dateLeaf({ month: "अक्टू॰", day: "4", weekday: "शनि", title: "Malad Premier League 2026 की नीलामी", when: "रात 8:00 (IST) · लगभग 2 घंटे" }, f) +
          p("नमस्ते Rahul, आप Cup Kings के लिए बोली लगा रहे हैं। अपना ओनर रूम कुछ मिनट पहले खोल लें, ताकि पहला खिलाड़ी आते ही आपका पैडल तैयार हो।", f) +
          facts(
            [
              ["आपकी टीम", "Cup Kings"],
              ["पर्स", "₹1,50,000"],
              ["टीम का आकार", "8 से 15 खिलाड़ी"],
              ["पहले से टीम में", "Vikram Patel (कप्तान)"],
              ["खिलाड़ियों की सूची", "43 खिलाड़ी"],
            ],
            f,
          ) +
          button("अपना ओनर रूम खोलें", URL, f) +
          small("फ़ोन या लैपटॉप, दोनों पर चलता है। जब तक हर टीम का पैडल नहीं जुड़ता, नीलामी शुरू नहीं हो सकती — इसलिए समय पर जुड़ें।", f),
        foot: footer(["आपको यह इसलिए मिला क्योंकि Malad Premier League 2026 में Cup Kings आपकी टीम है।"], "ईमेल सेटिंग", f),
      };
    },
  },
};

// ---------------------------------------------------------------------------
// Build.
// ---------------------------------------------------------------------------

mkdirSync(OUT, { recursive: true });
const built = [];
for (const [id, mail] of Object.entries(MAILS)) {
  for (const lang of ["en", "hi"]) {
    const m = mail[lang]();
    const html = page({ lang, ...m });
    const file = `${id}.${lang}.html`;
    writeFileSync(join(OUT, file), html);
    built.push({ id, lang, title: mail.title, subject: m.subject, preheader: m.preheader, file, html, bytes: Buffer.byteLength(html) });
  }
}

// Gmail clips a message past ~102 KB; stay far below it.
for (const b of built) {
  if (b.bytes > 60_000) throw new Error(`${b.file} is ${b.bytes} bytes — over the 60 KB budget`);
}

// The gallery: dark = the same document with its dark rules unconditional,
// which is exactly what Apple Mail and iOS Mail do on a dark device.
const forceDark = (html) =>
  html.replace(/\/\*da:dark\*\/\s*@media \(prefers-color-scheme: dark\) \{([\s\S]*?)\}\s*\/\*\/da:dark\*\//, "$1");
const template = readFileSync(join(here, "gallery.template.html"), "utf8");
const data = built.map((b) => ({
  id: b.id,
  lang: b.lang,
  title: b.title,
  subject: b.subject,
  preheader: b.preheader,
  kb: Math.round(b.bytes / 102.4) / 10,
  light: b.html,
  dark: forceDark(b.html),
}));
writeFileSync(
  join(OUT, "gallery.html"),
  template.replace("/*__DATA__*/[]", JSON.stringify(data).replace(/</g, "\\u003c")),
);
console.log(built.map((b) => `${b.file}  ${(b.bytes / 1024).toFixed(1)} KB  ${b.subject}`).join("\n"));
