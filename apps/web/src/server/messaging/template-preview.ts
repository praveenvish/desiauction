import type { EmailNotificationKind } from "@desiauction/messaging/catalogue";
import { EMAIL_TEMPLATES } from "@desiauction/messaging/email-template-defaults";
import { sampleVariables, type MessageLanguage } from "@desiauction/messaging/email-templates";

import { sportPackFor } from "@desiauction/core";

import { env } from "../../env";
import { auctionDateLeaf } from "./auction-schedule-mail";
import { digestDetails, organizerJourney, welcomeFrame } from "./organizer-mail";
import { journey, seasonBand, submittedDetails } from "./player-mail";
import { requestDetails } from "./request-context";
import type { RenderOptions } from "./notification-email";

/**
 * THE CODE-OWNED HALF OF A PREVIEW — what the admin editor and a test send put
 * around the wording: the button (with a harmless URL on our own host), the
 * sample code, and a sample details table in the reader's language. The
 * wording is the editor's; these only make the preview look like the mail.
 */

/**
 * What a sample player "sent": the cricket pack's first role and the first
 * option of each question, read from the pack — a sport's words live there only.
 */
const CRICKET = sportPackFor("cricket");
const SAMPLE_ANSWERS = Object.fromEntries(
  CRICKET.attributes.map((attribute) => [attribute.key, attribute.options[0]?.key ?? ""]),
);
const SAMPLE_ROLE = CRICKET.roles.values[0]?.key ?? "";
const SAMPLE_SUBMITTED: Readonly<Record<MessageLanguage, readonly (readonly [string, string])[]>> =
  {
    en: submittedDetails("cricket", SAMPLE_ROLE, SAMPLE_ANSWERS, "en"),
    hi: submittedDetails("cricket", SAMPLE_ROLE, SAMPLE_ANSWERS, "hi"),
  };

const SAMPLE_REQUEST = { device: "Chrome on macOS", at: new Date("2026-09-28T14:12:00Z") };

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
    // Where and when — the facts a code or an alert shows (request-context.ts).
    case "auth.email_code":
      return requestDetails(SAMPLE_REQUEST, "code", language);
    case "security.email_changed":
    case "security.phone_changed":
      return requestDetails(SAMPLE_REQUEST, "change", language);
    case "registration.received":
      return SAMPLE_SUBMITTED[language];
    default:
      return undefined;
  }
}

/** Where each player mail leaves the player in the season (player-mail.ts). */
const PREVIEW_STEP: Partial<Record<EmailNotificationKind, 1 | 2>> = {
  "registration.received": 1,
  "registration.waitlisted": 1,
  "registration.restored": 1,
  "registration.approved": 2,
};

/** The club band and tracker a registration mail carries, with the sample season. */
const ORGANIZER_KINDS = {
  "registration.first": true,
  "registration.digest": true,
} as const;

/**
 * What an organizer mail carries, with the samples — built by the same
 * builders a send uses (organizer-mail.ts), so the preview cannot drift.
 */
function organizerFrame(
  kind: EmailNotificationKind,
  language: MessageLanguage,
): Partial<RenderOptions> {
  const samples = sampleVariables(EMAIL_TEMPLATES[kind], language);
  const orgName = String(
    samples["orgName"] ?? (language === "hi" ? "मलाड क्रिकेट क्लब" : "Malad Cricket Club"),
  );
  const season = String(samples["season"] ?? "Malad Premier League 2026");
  const band = seasonBand({ season, orgName, sport: "cricket" });
  switch (kind) {
    case "club.welcome":
      return welcomeFrame(orgName, language);
    case "registration.first":
      return { band, progress: organizerJourney(2, language) };
    case "registration.digest":
      return {
        details: digestDetails(
          [
            { season, orgName, seasonSlug: "mpl-2026", waiting: 9, oldestDays: 3 },
            { season: "Under-19 Cup", orgName, seasonSlug: "u19", waiting: 3, oldestDays: 0 },
          ],
          language,
        ),
      };
    case "season.held":
    case "season.released":
      return { band };
    default:
      return {};
  }
}

/** Auction night's band and date tile, with the sample season (auction-schedule-mail.ts). */
function scheduleFrame(variant: string, language: MessageLanguage): Partial<RenderOptions> {
  const samples = sampleVariables(EMAIL_TEMPLATES["auction.schedule"], language);
  const season = String(samples["season"] ?? "");
  return {
    band: seasonBand({ season, orgName: String(samples["orgName"] ?? ""), sport: "cricket" }),
    ...(variant === "cleared"
      ? {}
      : { dateLeaf: auctionDateLeaf(new Date("2026-10-04T14:30:00Z"), season, language) }),
  };
}

function seasonFrame(
  kind: EmailNotificationKind,
  language: MessageLanguage,
): Partial<RenderOptions> {
  // The player's registration mails; the organizer's are organizerFrame's.
  if (!kind.startsWith("registration.") || kind in ORGANIZER_KINDS) return {};
  const step = PREVIEW_STEP[kind];
  // The template's own samples, so the band and the sentences name one season.
  const samples = sampleVariables(EMAIL_TEMPLATES[kind], language);
  return {
    band: seasonBand({
      season: String(samples["season"] ?? ""),
      orgName: String(samples["orgName"] ?? ""),
      sport: "cricket",
    }),
    ...(step === undefined ? {} : { progress: journey(step, language) }),
  };
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
    language,
    ...(action === undefined
      ? {}
      : { action: { id: action.id, url: `${env.PUBLIC_BASE_URL.replace(/\/$/, "")}/home` } }),
    ...(rows === undefined ? {} : { details: rows }),
    ...(kind === "auth.email_code" ? { code: "482913" } : {}),
    ...seasonFrame(kind, language),
    ...organizerFrame(kind, language),
    ...(kind === "auction.schedule" ? scheduleFrame(variant, language) : {}),
  };
}
