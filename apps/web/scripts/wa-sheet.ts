/**
 * THE WHATSAPP TEMPLATE SHEET, generated from the templates the code sends.
 *
 *   pnpm --filter @desiauction/web wa:sheet
 *
 * Writes docs/messaging/WHATSAPP_TEMPLATES.md — what to submit in Meta Business
 * Manager for every personal message, in English and Hindi. Meta matches a send
 * against the approved template by name and language, so the text here IS the
 * text sent; re-run after any edit, and resubmit (an approved template's body
 * cannot be edited).
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  WHATSAPP_CONSENT_LABEL,
  WHATSAPP_LANGUAGES,
  WHATSAPP_TEMPLATES,
  type WhatsAppKey,
  type WhatsAppLanguage,
} from "../src/server/messaging/whatsapp";

const SUGGESTED_NAME: Record<WhatsAppKey, string> = {
  "registration.approved": "da_registration_approved",
  "registration.waitlisted": "da_registration_waitlisted",
  "registration.rejected": "da_registration_rejected",
  "registration.withdrawn": "da_registration_withdrawn",
  "registration.restored": "da_registration_restored",
  "security.phone_changed": "da_security_phone_changed",
  "security.email_changed": "da_security_email_changed",
  "auction.sold": "da_auction_sold",
  "team.appointed": "da_team_appointed",
  "lineup.announced": "da_lineup_announced",
};

const WHEN: Record<WhatsAppKey, string> = {
  "registration.approved": "When an organizer approves a registration — to the player.",
  "registration.waitlisted":
    "When an organizer puts a registration on the waitlist — to the player.",
  "registration.rejected":
    "When an organizer declines a registration — to the player, with the reason from a closed list.",
  "registration.withdrawn": "When a registration is withdrawn — to the player.",
  "registration.restored": "When a withdrawn or declined registration is put back under review.",
  "security.phone_changed":
    "When the mobile number on an account is changed — to the number being GIVEN UP, sent at once (not queued, not held overnight).",
  "security.email_changed":
    "When the sign-in email on an account is changed — to the account's phone, sent at once. The old address gets an email.",
  "auction.sold":
    "When the organizer announces the auction results — to each player a team bought.",
  "team.appointed":
    "When the organizer announces captains and icons — to each player named captain, vice-captain, icon or retained player.",
  "lineup.announced":
    "When the organizer announces a side's lineup for a match still to come — to each player in it.",
};

const LANGUAGE_NAME: Record<WhatsAppLanguage, string> = {
  en: "English (`en`)",
  hi: "Hindi (`hi`)",
};

function filled(body: string, samples: readonly string[]): string {
  return body.replace(/\{\{(\d+)\}\}/g, (_m, n: string) => samples[Number(n) - 1] ?? "");
}

const lines: string[] = [
  "# WhatsApp templates — personal messages",
  "",
  "> **Generated** from `apps/web/src/server/messaging/whatsapp.ts` by",
  "> `pnpm --filter @desiauction/web wa:sheet`. Do not edit by hand: Meta matches",
  "> every send against the approved template, and the code is the source of the text.",
  "",
  "## How these are used",
  "",
  "WhatsApp is the text channel; SMS (MSG91/DLT) is deferred. A person who ticks",
  `**“${WHATSAPP_CONSENT_LABEL}”** (at registration, or on /account)`,
  "gets every moment below on WhatsApp, in the language they chose there (English or",
  "हिन्दी). A person who has **not** opted in never gets a WhatsApp message — their",
  "email carries the moment, with one line inviting them to turn WhatsApp on.",
  "",
  "A template whose approved name is not configured sends nothing on WhatsApp. Where",
  "an SMS gateway is configured the moment falls back to SMS; where none is (today),",
  "the text is recorded as `suppressed` with a `no_text_channel:` reason and the",
  "email still goes. So approval can be pending without anything breaking.",
  "",
  "Sign-in codes are separate: an **Authentication** template in Meta's own wording,",
  "English only, named in `WHATSAPP_TEMPLATE_NAME` (see WHATSAPP_SETUP.md).",
  "",
  "## Before you submit",
  "",
  "1. **Meta Business account** verified, with a WhatsApp Business phone number on the",
  "   Cloud API. The same `WHATSAPP_PHONE_NUMBER_ID` and `WHATSAPP_ACCESS_TOKEN` serve",
  "   sign-in codes and these messages.",
  "2. Create each template below in **WhatsApp Manager → Message templates**: category",
  "   **Utility**, ONE template name with **two languages** — English (`en`) and Hindi",
  "   (`hi`). Use the suggested name or your own, then put the APPROVED name in the env",
  "   var listed for it. Both languages must be approved before a Hindi reader gets it;",
  "   until then their send is refused and handled like any other refusal.",
  "3. The button is a **static URL** (no variable) — its label is per language. The",
  "   sale's header is an **image**: the player card for a public, adult player, the",
  "   DesiAuction card otherwise.",
  "4. The variables are the same, in the same order, in both languages; a sample for",
  "   each is listed per language.",
  "",
  "## Templates",
  "",
  "| Moment | Suggested name | Env var for the approved name |",
  "|---|---|---|",
  ...Object.values(WHATSAPP_TEMPLATES).map(
    (template) =>
      `| ${template.key} | \`${SUGGESTED_NAME[template.key]}\` | \`${template.nameEnv}\` |`,
  ),
  "",
];

for (const template of Object.values(WHATSAPP_TEMPLATES)) {
  lines.push(
    `### ${template.key}`,
    "",
    WHEN[template.key],
    "",
    "| Field | Value |",
    "|---|---|",
    `| Suggested name | \`${SUGGESTED_NAME[template.key]}\` |`,
    `| Category | ${template.category === "UTILITY" ? "Utility" : template.category} |`,
    `| Languages | ${WHATSAPP_LANGUAGES.map((language) => LANGUAGE_NAME[language]).join(", ")} |`,
    `| Header | ${template.header === "image" ? "Image (sample: any player card PNG)" : "None"} |`,
    `| Footer | ${template.footer} |`,
    `| Button | Visit website → ${template.button.url} |`,
    `| Env var for the approved name | \`${template.nameEnv}\` |`,
    "",
  );
  for (const language of WHATSAPP_LANGUAGES) {
    const samples = template.samples[language];
    lines.push(
      `#### ${LANGUAGE_NAME[language]}`,
      "",
      `Button label: “${template.button.label[language]}”`,
      "",
      "Body to submit:",
      "",
      "```text",
      template.body[language],
      "```",
      "",
      "Variable samples (Meta asks for one per variable):",
      "",
      ...samples.map((sample, index) => `- \`{{${String(index + 1)}}}\` — ${sample}`),
      "",
      "As received:",
      "",
      "```text",
      filled(template.body[language], samples),
      "```",
      "",
    );
  }
}

const out = fileURLToPath(
  new URL("../../../docs/messaging/WHATSAPP_TEMPLATES.md", import.meta.url),
);
writeFileSync(out, `${lines.join("\n")}\n`, "utf8");
process.stdout.write(`wrote ${out}\n`);
