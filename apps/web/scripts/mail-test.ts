/**
 * ONE test email through the configured provider — the Phase 5 check.
 *
 *   pnpm --filter web mail:test --to=you@example.com [--kind=plain|html|ics]
 *
 * Reads the same settings the app does (EMAIL_PROVIDER, EMAIL_FROM, SES_* or
 * EMAIL_API_*) from .env.local, sends exactly one message and prints what the
 * provider answered. Never prints a key. `sent` proves only that the provider
 * ACCEPTED it; delivery and SPF/DKIM/DMARC are proved by "Show original" on
 * the received mail (docs/EMAIL_INFRASTRUCTURE.md → Testing).
 *
 * Deliberately one recipient per run: while SES is in the sandbox, the
 * recipient must be a verified identity, and nothing here should ever loop.
 */
import { mailProviderFromEnv, selectedProvider } from "@desiauction/messaging/mail-provider";
import type { MailEnv } from "@desiauction/messaging/mail-provider";

function flag(name: string): string | undefined {
  const hit = process.argv.find((arg) => arg.startsWith(`--${name}=`));
  return hit?.slice(name.length + 3);
}

const to = flag("to");
const kind = flag("kind") ?? "html";
if (to === undefined || !to.includes("@")) {
  console.error("usage: mail:test --to=you@example.com [--kind=plain|html|ics]");
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

const stamp = new Date().toISOString();
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

const result = await provider.send({
  to,
  subject: `DesiAuction mail test (${selectedProvider(env) ?? "?"}, ${kind}) ${stamp}`,
  text: `This is a test from DesiAuction's mail setup.\n\nSent ${stamp} via ${provider.name}.\nIf you can read this, the provider accepted and delivered it.`,
  ...(kind === "plain"
    ? {}
    : {
        html: `<p>This is a test from <strong>DesiAuction</strong>'s mail setup.</p><p>Sent ${stamp} via ${provider.name}.</p>`,
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
  ...(process.env["EMAIL_REPLY_TO"] ? { replyTo: process.env["EMAIL_REPLY_TO"] } : {}),
  tags: { kind: "mail_test" },
});

console.log(JSON.stringify({ provider: provider.name, to, kind, ...result }, null, 2));
process.exit(result.ok ? 0 : 1);
