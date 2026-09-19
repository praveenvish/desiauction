/**
 * THE DLT REGISTRATION SHEET, generated from the registry the code sends from.
 *
 *   pnpm --filter @desiauction/web dlt:sheet
 *
 * Writes docs/messaging/DLT_REGISTRATION.md. The text an operator registers
 * must match what the gateway receives character for character, so the sheet
 * is never typed by hand: it is `SMS_TEMPLATES` with each `{slot}` turned into
 * DLT's `{#var#}`. Re-run it after any template edit (which is a new version).
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  DLT_VAR_MAX,
  SMS_LINK,
  SMS_SUPPORT_LINK,
  SMS_TEMPLATES,
  renderTemplate,
  type TemplateKey,
} from "../src/server/messaging/templates";

const SAMPLE: Record<string, string> = {
  competition: "Malad Premier League 2026",
  reason: "the season is full",
  last4: "4321",
  team: "Cup Kings",
  price: "Rs 75,000",
  role: "captain",
};

const PURPOSE: Record<TemplateKey, string> = {
  "registration.approved": "A player's registration was approved by the organizer.",
  "registration.waitlisted": "A player's registration was placed on the waitlist.",
  "registration.rejected": "A player's registration was declined, with the category of reason.",
  "registration.withdrawn": "A player's registration was withdrawn.",
  "registration.restored": "A declined or withdrawn registration was put back under review.",
  "security.phone_changed":
    "Security alert to the OLD number when an account's mobile number is changed.",
  "auction.sold":
    "A player was bought by a team in their season's auction (sent when results are announced).",
  "team.appointed":
    "A player was named captain, vice-captain, icon or retained player of their team (sent when the organizer announces it).",
};

/** The one-time sign-in code. Sent through MSG91's OTP API, not the registry. */
const OTP_BODY =
  "{#var#} is your DesiAuction sign-in code. It expires in 5 minutes. Never share it with anyone, including us.";

function dlt(body: string): string {
  return body.replace(/\{[a-z0-9_]+\}/g, "{#var#}");
}

const rows = (Object.keys(SMS_TEMPLATES) as TemplateKey[]).map((key) => {
  const t = SMS_TEMPLATES[key];
  const sample = renderTemplate(
    t,
    Object.fromEntries(t.slots.map((slot) => [slot.name, SAMPLE[slot.name] ?? "x"])),
  );
  return { key, t, sample: sample.ok ? sample.body : "(sample failed to render)" };
});

const lines: string[] = [
  "# DLT registration sheet — SMS templates",
  "",
  "> **Generated** from `apps/web/src/server/messaging/templates.ts` by",
  "> `pnpm --filter @desiauction/web dlt:sheet`. Do not edit by hand: the text below",
  "> must match what the gateway receives character for character, and the code is",
  "> the source of that text.",
  "",
  "## Before you register",
  "",
  "1. **Principal Entity (PE).** Register DesiAuction's legal entity on one DLT portal",
  "   (Jio TrueConnect, Airtel, Vodafone Idea Vilpower or BSNL — one is enough; it is",
  "   shared across operators). You get a **PE ID**.",
  "2. **Header (sender ID).** Six letters, for service messages. Suggested:",
  "   `DSAUCN` — pick whatever is free; it must read as DesiAuction. Header type:",
  "   **Service Implicit**.",
  `3. **Whitelist the URL domain.** Every template carries a link as fixed text on`,
  `   \`desiauction.in\` (${SMS_LINK}, ${SMS_SUPPORT_LINK}). Since TRAI's 2024 rule, a`,
  "   message with a URL on a domain not whitelisted under your entity is blocked.",
  "4. **Content category.** Register every template below as **Service Implicit**.",
  '   (DLT\'s "Transactional" category is reserved for banks; these are service',
  "   messages about something the recipient just did. None is promotional.)",
  "5. **Link the header to MSG91.** Give MSG91 the PE ID and header; register each",
  "   template in MSG91 against its DLT template ID, then put that MSG91 template id",
  "   in the env var named in each row.",
  "",
  `Every variable is \`{#var#}\` and holds at most **${String(DLT_VAR_MAX)} characters** (the`,
  "portals' limit). Every message is **one SMS segment** (≤ 160 characters) even with",
  "every variable full, and uses only GSM-7 characters.",
  "",
  "## Templates",
  "",
];

for (const { key, t, sample } of rows) {
  lines.push(
    `### ${key} (v${t.version})`,
    "",
    PURPOSE[key],
    "",
    "| Field | Value |",
    "|---|---|",
    "| Content category | Service Implicit |",
    `| Variables | ${String(t.slots.length)} — ${t.slots.map((s) => `\`${s.name}\` (≤ ${String(s.maxLength)})`).join(", ")} |`,
    `| Env var for the MSG91 template id | \`${t.providerTemplateEnv}\` |`,
    "",
    "Template text to register:",
    "",
    "```text",
    dlt(t.body),
    "```",
    "",
    "Example as received:",
    "",
    "```text",
    sample,
    "```",
    "",
  );
}

lines.push(
  "### Sign-in code (OTP)",
  "",
  "Sent through MSG91's OTP API (`MSG91_TEMPLATE_ID` in the web env), not the",
  "registry above: MSG91 fills the code into its own OTP template. Register this",
  "text on DLT as **Service Implicit**, and create the MSG91 OTP template with the",
  "same text, using `##OTP##` where DLT has `{#var#}`.",
  "",
  "```text",
  OTP_BODY,
  "```",
  "",
  "Example as received:",
  "",
  "```text",
  OTP_BODY.replace("{#var#}", "482913"),
  "```",
  "",
  "## WhatsApp (optional, later)",
  "",
  "WhatsApp authentication templates use Meta's fixed wording (\"{{1}} is your",
  'verification code. For your security, do not share this code.") and are approved',
  "in Meta Business Manager, not on DLT. Set `WHATSAPP_TEMPLATE_NAME` to the approved",
  "template's name.",
  "",
);

const out = fileURLToPath(new URL("../../../docs/messaging/DLT_REGISTRATION.md", import.meta.url));
writeFileSync(out, `${lines.join("\n")}\n`, "utf8");
process.stdout.write(`wrote ${out}\n`);
