/**
 * THE WHATSAPP TEMPLATE SHEET, generated from the templates the code sends.
 *
 *   pnpm --filter @desiauction/web wa:sheet
 *
 * Writes docs/messaging/WHATSAPP_TEMPLATES.md — what to submit in Meta Business
 * Manager for the personal messages (Phase 3). Meta matches a send against the
 * approved template by name, so the text here IS the text sent; re-run after
 * any edit, and resubmit (an approved template's body cannot be edited).
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { WHATSAPP_TEMPLATES } from "../src/server/messaging/whatsapp";

const SUGGESTED_NAME: Record<string, string> = {
  "auction.sold": "da_auction_sold",
  "team.appointed": "da_team_appointed",
  "lineup.announced": "da_lineup_announced",
};

const WHEN: Record<string, string> = {
  "auction.sold":
    "When the organizer announces the auction results — to each player a team bought.",
  "team.appointed":
    "When the organizer announces captains and icons — to each player named captain, vice-captain, icon or retained player.",
  "lineup.announced":
    "When the organizer announces a side's lineup for a match still to come — to each player in it.",
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
  "A player who ticks **“Send my auction and team updates on WhatsApp instead of SMS”**",
  "(at registration, or on /account) gets these moments on WhatsApp **instead of** the",
  "SMS. Everyone else keeps the SMS. A template whose name is not configured, or a",
  "WhatsApp send that fails, falls back to the SMS for that message, so nothing is",
  "lost while approval is pending.",
  "",
  "## Before you submit",
  "",
  "1. **Meta Business account** verified, with a WhatsApp Business phone number on the",
  "   Cloud API. The same `WHATSAPP_PHONE_NUMBER_ID` and `WHATSAPP_ACCESS_TOKEN` serve",
  "   sign-in codes and these messages.",
  "2. Create each template below in **WhatsApp Manager → Message templates**:",
  "   category **Utility**, language **English (en)**. Use the suggested name or your",
  "   own, then put the APPROVED name in the env var listed for it.",
  "3. The button is a **static URL** (no variable). The sale's header is an **image**:",
  "   the player card for a public, adult player, the DesiAuction card otherwise.",
  "",
  "## Templates",
  "",
];

for (const template of Object.values(WHATSAPP_TEMPLATES)) {
  if (template === undefined) continue;
  lines.push(
    `### ${template.key}`,
    "",
    WHEN[template.key] ?? "",
    "",
    "| Field | Value |",
    "|---|---|",
    `| Suggested name | \`${SUGGESTED_NAME[template.key] ?? template.key}\` |`,
    `| Category | ${template.category === "UTILITY" ? "Utility" : template.category} |`,
    "| Language | English (en) |",
    `| Header | ${template.header === "image" ? "Image (sample: any player card PNG)" : "None"} |`,
    `| Footer | ${template.footer} |`,
    `| Button | Visit website — “${template.button.label}” → ${template.button.url} |`,
    `| Env var for the approved name | \`${template.nameEnv}\` |`,
    "",
    "Body to submit:",
    "",
    "```text",
    template.body,
    "```",
    "",
    "Variable samples (Meta asks for one per variable):",
    "",
    ...template.samples.map((sample, index) => `- \`{{${String(index + 1)}}}\` — ${sample}`),
    "",
    "As received:",
    "",
    "```text",
    filled(template.body, template.samples),
    "```",
    "",
  );
}

const out = fileURLToPath(
  new URL("../../../docs/messaging/WHATSAPP_TEMPLATES.md", import.meta.url),
);
writeFileSync(out, `${lines.join("\n")}\n`, "utf8");
process.stdout.write(`wrote ${out}\n`);
