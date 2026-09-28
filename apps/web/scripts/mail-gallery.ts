// EVERY CUSTOMER EMAIL, ON ONE PAGE — the review surface for email v2.
//
// Renders every email kind × variant × language through the SAME code a send
// uses (composeNotificationEmail with the admin preview's sample facts), and
// writes a gallery: pick a mail, see it as the inbox lists it (subject +
// preview line), then at phone and desktop width, light or dark, English or
// Hindi. A reviewer scores mail here before a wording or layout PR merges.
//
// Run:  pnpm mail:gallery              → apps/web/.mail-gallery/index.html
//       pnpm mail:gallery -- --shots   → also PNGs of every mail at 390 and
//                                         680 px, light and dark (Playwright)
//
// Nothing here touches a database or sends anything; the default wording is
// what renders (a published admin edit is previewed in /admin/notifications).
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { EMAIL_TEMPLATES } from "@desiauction/messaging/email-template-defaults";
import { defaultContent, sampleVariables } from "@desiauction/messaging/email-templates";

import { env } from "../src/env.js";
import { forceDarkEmail } from "../src/server/messaging/email-layout.js";
import {
  composeNotificationEmail,
  financeDocumentPreviewMail,
} from "../src/server/messaging/notification-email.js";
import { FINANCE_TEMPLATE_FOR_VARIANT } from "../src/server/messaging/template-writer.js";
import { previewOptions } from "../src/server/messaging/template-preview.js";
import { PAGE } from "./mail-gallery-page.js";

const here = dirname(fileURLToPath(import.meta.url));

/** A receipt as the club's books issue it — the document is reproduced, never reworded. */
const SAMPLE_RECEIPT = [
  "RECEIPT RCT/2026-27/000042",
  "Malad Cricket Club · Malad Premier League 2026",
  "Date: 04 Oct 2026",
  "Received from: Cup Kings (owner: Rahul Mehta)",
  "For: Team entry fee",
  "Amount: ₹25,000.00",
  "Mode: UPI · ref 4273 9910 2231",
].join("\n");
const OUT = join(here, "..", ".mail-gallery");
const SHOTS = process.argv.includes("--shots");

// The logo is an absolute URL on our host; locally nothing may be serving it,
// so the gallery points it at the file itself.
const LOGO = `${env.PUBLIC_BASE_URL.replace(/\/$/, "")}/brand/mark.png`;
const localLogo = (html: string) => html.split(LOGO).join("../public/brand/mark.png");

interface Rendered {
  readonly id: string;
  readonly kind: string;
  readonly label: string;
  readonly variant: string;
  readonly lang: string;
  readonly subject: string;
  readonly preheader: string;
  readonly kb: number;
  readonly light: string;
  readonly dark: string;
  readonly plain: boolean;
}

function preheaderOf(html: string): string {
  const match = /<div style="display:none[^>]*>([^<&]*)/.exec(html);
  return match?.[1] ?? "";
}

const mails: Rendered[] = [];
for (const spec of Object.values(EMAIL_TEMPLATES)) {
  for (const lang of spec.languages) {
    const content = defaultContent(spec, lang);
    for (const variant of spec.variants) {
      const fields = content.variants[variant.id];
      if (fields === undefined) continue;
      // A finance document is laid out around the document itself, as the
      // runner sends it (email programme PR10).
      const mail =
        spec.kind === "finance.document.issued"
          ? financeDocumentPreviewMail(
              fields,
              SAMPLE_RECEIPT,
              FINANCE_TEMPLATE_FOR_VARIANT[variant.id] ?? "document.issued",
              lang,
              "Malad Cricket Club",
            )
          : composeNotificationEmail(
              spec,
              fields,
              sampleVariables(spec, lang),
              previewOptions(spec.kind, variant.id, lang),
            );
      const plain = mail.html === undefined;
      const html =
        mail.html ??
        `<!doctype html><meta charset="utf-8"><pre style="margin:24px;font:14px/1.5 ui-monospace,Menlo,monospace;white-space:pre-wrap;">${mail.text
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")}</pre>`;
      mails.push({
        id: `${spec.kind}.${variant.id}.${lang}`,
        kind: spec.kind,
        label: spec.variants.length > 1 ? `${spec.kind} · ${variant.label}` : spec.kind,
        variant: variant.id,
        lang,
        subject: mail.subject,
        preheader: plain ? "" : preheaderOf(html),
        kb: Math.round(Buffer.byteLength(html) / 102.4) / 10,
        light: localLogo(html),
        dark: localLogo(forceDarkEmail(html)),
        plain,
      });
    }
  }
}

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
writeFileSync(
  join(OUT, "index.html"),
  PAGE.replace("/*__DATA__*/[]", JSON.stringify(mails).replace(/</g, "\\u003c")),
);
for (const m of mails) writeFileSync(join(OUT, `${m.id}.html`), m.light);

console.log(`${String(mails.length)} mails → ${join(OUT, "index.html")}`);

if (SHOTS) {
  const { chromium } = await import("@playwright/test");
  const dir = join(OUT, "shots");
  mkdirSync(dir, { recursive: true });
  const browser = await chromium.launch();
  for (const width of [390, 680]) {
    for (const scheme of ["light", "dark"] as const) {
      const page = await browser.newPage({ viewport: { width, height: 900 }, colorScheme: scheme });
      for (const m of mails) {
        await page.goto(`file://${join(OUT, `${m.id}.html`)}`);
        await page.screenshot({
          path: join(dir, `${m.id}.${scheme}.${String(width)}.png`),
          fullPage: true,
        });
      }
      await page.close();
    }
  }
  await browser.close();
  console.log(`${String(mails.length * 4)} screenshots → ${dir}`);
}
