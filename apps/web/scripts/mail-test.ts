/**
 * TEST EMAIL THROUGH THE CONFIGURED PROVIDER — the Phase 5 check.
 *
 *   pnpm --filter web mail:test --to=you@example.com [--kind=plain|html|ics]
 *       one bare message: plain text, the HTML part, or an .ics attachment
 *
 *   pnpm --filter web mail:test --to=you@example.com --template=auction.sold [--language=hi]
 *   pnpm --filter web mail:test --to=you@example.com --template=all [--language=en]
 *       the REAL designs: every email the product sends, in its default
 *       wording with the sample values, through the same layout and provider
 *
 *   pnpm --filter web mail:test --preview=/tmp/mail-preview
 *       every design × language × version written to HTML files and an
 *       index.html — nothing is sent
 *
 * Reads the same settings the app does (EMAIL_PROVIDER, EMAIL_FROM, SES_* or
 * EMAIL_API_*) from .env.local and prints what the provider answered. Never
 * prints a key. `ok` proves only that the provider ACCEPTED a message;
 * delivery and SPF/DKIM/DMARC are proved by "Show original" on what arrives
 * (docs/EMAIL_INFRASTRUCTURE.md → Testing).
 *
 * One recipient, sent one at a time a little over a second apart: the SES
 * sandbox allows one message per second, and nothing here should ever fan out.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { EmailNotificationKind } from "@desiauction/messaging/catalogue";
import { EMAIL_TEMPLATES } from "@desiauction/messaging/email-template-defaults";
import { defaultContent, type MessageLanguage } from "@desiauction/messaging/email-templates";
import {
  mailProviderFromEnv,
  selectedProvider,
  type MailEnv,
  type MailRequest,
} from "@desiauction/messaging/mail-provider";

import { sampleMail } from "../src/server/messaging/template-writer";

function flag(name: string): string | undefined {
  const hit = process.argv.find((arg) => arg.startsWith(`--${name}=`));
  return hit?.slice(name.length + 3);
}

const KINDS = Object.keys(EMAIL_TEMPLATES) as EmailNotificationKind[];
const escape = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// --- preview: files only, no provider needed ---------------------------------
const previewDir = flag("preview");
if (previewDir !== undefined) {
  mkdirSync(previewDir, { recursive: true });
  const rows: string[] = [];
  for (const kind of KINDS) {
    const spec = EMAIL_TEMPLATES[kind];
    for (const language of spec.languages) {
      for (const variant of Object.keys(defaultContent(spec, language).variants)) {
        const { mail } = sampleMail(kind, language, variant);
        const file = `${kind}.${language}.${variant}.html`;
        writeFileSync(
          join(previewDir, file),
          mail.html ?? `<pre style="font:14px/1.5 monospace">${escape(mail.text)}</pre>`,
        );
        rows.push(
          `<tr><td>${kind}</td><td>${language}</td><td>${variant}</td><td><a href="${file}">${escape(mail.subject)}</a></td><td>${mail.html === undefined ? "plain" : "html"}</td></tr>`,
        );
      }
    }
  }
  writeFileSync(
    join(previewDir, "index.html"),
    `<!doctype html><meta charset="utf-8"><title>DesiAuction emails</title><table border="1" cellpadding="6" style="border-collapse:collapse;font:14px system-ui"><tr><th>Email</th><th>Lang</th><th>Version</th><th>Subject</th><th>Format</th></tr>${rows.join("")}</table>`,
  );
  console.log(`${String(rows.length)} emails written to ${join(previewDir, "index.html")}`);
  process.exit(0);
}

// --- send ---------------------------------------------------------------------
const to = flag("to");
if (to === undefined || !to.includes("@")) {
  console.error(
    "usage: mail:test --to=you@example.com [--kind=plain|html|ics | --template=<kind>|all [--language=en|hi]]  or  --preview=<dir>",
  );
  process.exit(2);
}

const env = process.env as MailEnv;
const provider = mailProviderFromEnv(env);
if (provider === null) {
  console.error(
    `no mailer selected (EMAIL_PROVIDER=${env.EMAIL_PROVIDER ?? "auto"}) — set EMAIL_FROM and SES_* or EMAIL_API_*`,
  );
  process.exit(1);
}
const replyTo = process.env["EMAIL_REPLY_TO"];
const stamp = new Date().toISOString();

function bare(kind: string): MailRequest {
  const ics = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//DesiAuction//mail-test//EN",
    "BEGIN:VEVENT",
    `UID:mail-test-${String(Date.now())}@desiauction.in`,
    "DTSTAMP:20260928T100000Z",
    "DTSTART:20261001T100000Z",
    "DTEND:20261001T103000Z",
    "SUMMARY:DesiAuction mail test",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
  return {
    to: to ?? "",
    subject: `DesiAuction mail test (${selectedProvider(env) ?? "?"}, ${kind}) ${stamp}`,
    text: `This is a test from DesiAuction's mail setup.\n\nSent ${stamp} via ${provider?.name ?? "?"}.`,
    ...(kind === "plain"
      ? {}
      : {
          html: `<p>This is a test from <strong>DesiAuction</strong>'s mail setup.</p><p>Sent ${stamp}.</p>`,
        }),
    ...(kind === "ics"
      ? {
          attachment: {
            filename: "mail-test.ics",
            contentType: "text/calendar",
            contentBase64: Buffer.from(ics).toString("base64"),
          },
        }
      : {}),
  };
}

const template = flag("template");
const language = (flag("language") ?? "en") as MessageLanguage;
const messages: { label: string; mail: MailRequest }[] = [];
if (template === undefined) {
  const kind = flag("kind") ?? "html";
  messages.push({ label: kind, mail: bare(kind) });
} else {
  const kinds = template === "all" ? KINDS : [template as EmailNotificationKind];
  for (const kind of kinds) {
    const spec = EMAIL_TEMPLATES[kind] as
      (typeof EMAIL_TEMPLATES)[EmailNotificationKind] | undefined;
    if (spec === undefined) {
      console.error(`no such email: ${kind} — one of ${KINDS.join(", ")}`);
      process.exit(2);
    }
    if (!spec.languages.includes(language)) continue;
    const { mail, variant } = sampleMail(kind, language, flag("variant"));
    messages.push({
      label: `${kind} (${language}, ${variant})`,
      mail: {
        to,
        subject: `[Test] ${mail.subject}`,
        text: mail.text,
        ...(mail.html === undefined ? {} : { html: mail.html }),
      },
    });
  }
}

let failures = 0;
for (const [index, { label, mail }] of messages.entries()) {
  if (index > 0) await new Promise((done) => setTimeout(done, 1_100));
  const result = await provider.send({
    ...mail,
    ...(replyTo ? { replyTo } : {}),
    tags: { kind: "mail_test" },
  });
  if (!result.ok) failures += 1;
  console.log(
    JSON.stringify({
      provider: provider.name,
      email: label,
      ...(result.ok
        ? { ok: true, messageId: result.messageId }
        : { ok: false, status: result.status, detail: result.detail }),
    }),
  );
}
console.log(`${String(messages.length - failures)}/${String(messages.length)} accepted`);
process.exit(failures === 0 ? 0 : 1);
