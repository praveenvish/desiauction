import type { EmailNotificationKind } from "@desiauction/messaging/catalogue";
import { EMAIL_TEMPLATES } from "@desiauction/messaging/email-template-defaults";
import type { MessageLanguage } from "@desiauction/messaging/email-templates";

import { env } from "../../env";
import type { RenderOptions } from "./notification-email";

/**
 * THE CODE-OWNED HALF OF A PREVIEW — what the admin editor and a test send put
 * around the wording: the button (with a harmless URL on our own host), the
 * sample code, and a sample details table in the reader's language. The
 * wording is the editor's; these only make the preview look like the mail.
 */

const SQUAD: Readonly<Record<MessageLanguage, readonly (readonly [string, string])[]>> = {
  en: [
    ["Arjun Sharma", "₹75,000"],
    ["Vikram Patel", "Captain · ₹25,000"],
  ],
  hi: [
    ["Arjun Sharma", "₹75,000"],
    ["Vikram Patel", "कप्तान · ₹25,000"],
  ],
};

function details(
  kind: EmailNotificationKind,
  language: MessageLanguage,
): readonly (readonly [string, string])[] | undefined {
  const hi = language === "hi";
  switch (kind) {
    case "auction.sold":
    case "lineup.announced":
      return SQUAD[language];
    case "team.squad_sheet":
      return [...SQUAD[language], [hi ? "कोच" : "Coach", "Ravi Shastri"]];
    case "auction.owner_summary":
      return [
        ...SQUAD[language],
        [hi ? "खर्च" : "Spent", "₹1,00,000"],
        [hi ? "बचा हुआ पर्स" : "Purse left", "₹50,000"],
        [hi ? "टीम" : "Squad", hi ? "8–15 में से 2" : "2 of 8–15"],
      ];
    case "demo.request_received":
      return [
        ["Tournament size", "8–16 teams"],
        ["Auction date", "2026-11-14"],
        ["Best time to talk", "weekday evenings"],
      ];
    case "demo.booking_confirmed":
      return [
        ["When", "Tue 9 Sep, 7:00 pm IST"],
        ["How", "We call the number you gave us"],
        ["Length", "About twenty minutes"],
      ];
    default:
      return undefined;
  }
}

export function previewOptions(
  kind: EmailNotificationKind,
  variant: string,
  language: MessageLanguage,
): RenderOptions {
  const spec = EMAIL_TEMPLATES[kind];
  const action = spec.actions[0];
  const rows = details(kind, language);
  return {
    variant,
    ...(action === undefined
      ? {}
      : { action: { id: action.id, url: `${env.PUBLIC_BASE_URL.replace(/\/$/, "")}/home` } }),
    ...(rows === undefined ? {} : { details: rows }),
    ...(kind === "auth.email_code" ? { code: "482913" } : {}),
  };
}
