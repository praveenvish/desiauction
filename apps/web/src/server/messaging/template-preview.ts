import type { EmailNotificationKind } from "@desiauction/messaging/catalogue";
import { EMAIL_TEMPLATES } from "@desiauction/messaging/email-template-defaults";
import { sampleVariables, type MessageLanguage } from "@desiauction/messaging/email-templates";

import { sportPackFor } from "@desiauction/core";

import { env } from "../../env";
import { readinessRows } from "./auction-reminder-mail";
import { auctionDateLeaf, leafDate } from "./auction-schedule-mail";
import {
  fixtureLine,
  lineupMatchup,
  matchupOf,
  matchTitle,
  whenAndWhere,
  wallInstant,
  type MatchFacts,
} from "./fixture-mail";
import { clubBand } from "./club-mail";
import { finaleTable, recordWords, type FinaleRow } from "./finale-mail";
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
    case "security.passkey_changed":
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

/** A team's sample schedule — the preview's and the gallery's (fixture-mail.ts). */
export const SAMPLE_MATCHES: readonly MatchFacts[] = [
  {
    id: "sample-1",
    kickoffAt: "2026-10-04T19:30",
    ground: "Malad Ground",
    home: { id: "cup-kings", name: "Cup Kings", color: "#1E6FD9" },
    away: { id: "tigers", name: "Tigers", color: "#E8772E" },
    squadCount: 0,
  },
  {
    id: "sample-2",
    kickoffAt: "2026-10-11T16:00",
    ground: "Goregaon Sports Club",
    home: { id: "falcons", name: "Falcons", color: "#2E9E6B" },
    away: { id: "cup-kings", name: "Cup Kings", color: "#1E6FD9" },
    squadCount: 0,
  },
  {
    id: "sample-3",
    kickoffAt: "2026-10-18T07:30",
    ground: "Malad Ground",
    home: { id: "cup-kings", name: "Cup Kings", color: "#1E6FD9" },
    away: { id: "royals", name: "Royals", color: null },
    squadCount: 0,
  },
];
export const SAMPLE_TEAM_ID = "cup-kings";

/** The season's matches (PR11): the schedule's list, a change's tile, match day's crests. */
function matchesFrame(
  kind: EmailNotificationKind,
  variant: string,
  language: MessageLanguage,
): Partial<RenderOptions> {
  if (
    kind !== "schedule.published" &&
    kind !== "fixture.changed" &&
    kind !== "match.day" &&
    kind !== "lineup.announced"
  ) {
    return {};
  }
  const samples = sampleVariables(EMAIL_TEMPLATES[kind], language);
  const band = seasonBand({
    season: String(samples["season"] ?? ""),
    orgName: String(
      samples["orgName"] ?? (language === "hi" ? "मलाड क्रिकेट क्लब" : "Malad Cricket Club"),
    ),
    sport: "cricket",
  });
  const [first] = SAMPLE_MATCHES;
  if (first === undefined) return {};
  const hi = language === "hi";
  switch (kind) {
    case "schedule.published":
      return {
        band,
        fixtures: SAMPLE_MATCHES.map((match) => fixtureLine(match, SAMPLE_TEAM_ID, language)),
      };
    case "fixture.changed":
      return variant === "cancelled"
        ? { band, details: [[hi ? "तय था" : "Was set for", String(samples["previous"] ?? "")]] }
        : {
            band,
            dateLeaf: {
              ...leafDate(wallInstant(first.kickoffAt), language),
              title: matchTitle(first, language),
              detail: whenAndWhere(first),
            },
            details: [[hi ? "पहले" : "Was", String(samples["previous"] ?? "")]],
          };
    case "match.day":
      return variant === "organizer"
        ? {
            band,
            fixtures: SAMPLE_MATCHES.slice(0, 2).map((match, i) =>
              fixtureLine(
                match,
                null,
                language,
                i === 0 ? (hi ? "टीमें घोषित" : "Lineups in") : hi ? "1/2 टीमें" : "1/2 lineups",
              ),
            ),
          }
        : {
            ...(() => {
              const matchup = matchupOf(
                first,
                SAMPLE_TEAM_ID,
                hi ? "मैच डे" : "Match day",
                language,
              );
              return matchup === undefined ? { band } : { matchup };
            })(),
            details: [
              [hi ? "शुरुआत" : "Kick-off", "7:30 pm IST"],
              [hi ? "मैदान" : "Ground", "Malad Ground"],
              [hi ? "पता" : "Address", "Link Road, Malad West, Mumbai"],
            ],
          };
    case "lineup.announced": {
      const matchup = lineupMatchup(first, SAMPLE_TEAM_ID, language);
      return matchup === undefined ? { band } : { matchup };
    }
  }
}

/** A season's sample final table (finale-mail.ts). */
const SAMPLE_TABLE: readonly FinaleRow[] = [
  { teamId: "cup-kings", teamName: "Cup Kings", played: 8, won: 7, points: 14 },
  { teamId: "falcons", teamName: "Falcons", played: 8, won: 5, points: 10 },
  { teamId: "tigers", teamName: "Tigers", played: 8, won: 4, points: 8 },
  { teamId: "royals", teamName: "Royals", played: 8, won: 2, points: 4 },
  { teamId: "strikers", teamName: "Strikers", played: 8, won: 2, points: 4 },
];

/** The champion's trophy, or the final table (finale-mail.ts). */
function finaleFrame(
  kind: EmailNotificationKind,
  variant: string,
  language: MessageLanguage,
): Partial<RenderOptions> {
  if (kind !== "season.champion") return {};
  const samples = sampleVariables(EMAIL_TEMPLATES[kind], language);
  const season = String(samples["season"] ?? "");
  const role = variant === "champion" || variant === "organizer" ? variant : "team";
  const details = finaleTable(
    {
      table: SAMPLE_TABLE,
      championId: "cup-kings",
      teamId: role === "organizer" ? null : role === "champion" ? "cup-kings" : "tigers",
      role,
    },
    language,
  );
  const [first] = SAMPLE_TABLE;
  return role === "champion" && first !== undefined
    ? {
        stage: {
          kicker: season,
          monogram: "CK",
          title: first.teamName,
          figure: language === "hi" ? "चैंपियन" : "Champions",
          line: recordWords(first, language),
        },
        details,
      }
    : {
        band: seasonBand({ season, orgName: String(samples["orgName"] ?? ""), sport: "cricket" }),
        details,
      };
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

/** The owner invitation and "every team has its owner", with the samples (owner-mail.ts). */
function ownerFrame(
  kind: EmailNotificationKind,
  language: MessageLanguage,
): Partial<RenderOptions> {
  if (kind !== "owner.invite" && kind !== "auction.owners_ready") return {};
  const samples = sampleVariables(EMAIL_TEMPLATES[kind], language);
  const season = String(samples["season"] ?? "");
  const band = seasonBand({
    season,
    orgName: String(
      samples["orgName"] ?? (language === "hi" ? "मलाड क्रिकेट क्लब" : "Malad Cricket Club"),
    ),
    sport: "cricket",
  });
  const dateLeaf = auctionDateLeaf(new Date("2026-10-04T14:30:00Z"), season, language);
  return kind === "owner.invite"
    ? { band, dateLeaf }
    : {
        band,
        progress: organizerJourney(3, language),
        details: [
          ["Cup Kings", "Rahul Mehta"],
          ["Falcons", "Arjun Rao"],
          ["Tigers", "Sana Iqbal"],
        ],
      };
}

/** The day-before reminder's band, date and facts, per reader (auction-reminder-mail.ts). */
function reminderFrame(variant: string, language: MessageLanguage): Partial<RenderOptions> {
  const samples = sampleVariables(EMAIL_TEMPLATES["auction.reminder"], language);
  const season = String(samples["season"] ?? "");
  const hi = language === "hi";
  return {
    band: seasonBand({ season, orgName: String(samples["orgName"] ?? ""), sport: "cricket" }),
    dateLeaf: auctionDateLeaf(new Date("2026-10-04T14:30:00Z"), season, language),
    ...(variant === "owner"
      ? {
          details: [
            [hi ? "आपकी टीम" : "Your team", String(samples["teamName"] ?? "")],
            [hi ? "आपका पैडल" : "Your paddle", hi ? "तैयार" : "Ready"],
          ],
        }
      : {}),
    ...(variant === "organizer"
      ? {
          progress: organizerJourney(3, language),
          details: readinessRows(
            { auctionCreated: true, teams: 8, owned: 6, paddles: 5, pool: 43 },
            language,
          ),
        }
      : {}),
  };
}

/** The auction's results, with the samples: the sale's stage, the bands, the organizer's pack. */
function resultsFrame(
  kind: EmailNotificationKind,
  language: MessageLanguage,
): Partial<RenderOptions> {
  const samples = sampleVariables(EMAIL_TEMPLATES[kind], language);
  const band = seasonBand({
    season: String(samples["season"] ?? ""),
    orgName: String(
      samples["orgName"] ?? (language === "hi" ? "मलाड क्रिकेट क्लब" : "Malad Cricket Club"),
    ),
    sport: "cricket",
  });
  switch (kind) {
    case "auction.sold":
      return {
        stage: {
          kicker: "Sold",
          monogram: "AS",
          title: `${String(samples["name"] ?? "")} → ${String(samples["teamName"] ?? "")}`,
          figure: String(samples["price"] ?? ""),
          line:
            language === "hi"
              ? "बेस प्राइस का 3 गुना · 7 बोलियाँ · 3 टीमें"
              : "3× your base · 7 bids · 3 teams",
        },
        progress: journey(3, language),
      };
    case "auction.unsold":
    case "auction.owner_summary":
      return { band };
    case "auction.results":
      return {
        band,
        progress: organizerJourney(4, language),
        details: [
          ["Cup Kings", language === "hi" ? "₹2,10,000 · 9 खिलाड़ी" : "₹2,10,000 · 9 players"],
          ["Tigers", language === "hi" ? "₹1,90,000 · 8 खिलाड़ी" : "₹1,90,000 · 8 players"],
          ["Falcons", language === "hi" ? "₹1,75,000 · 8 खिलाड़ी" : "₹1,75,000 · 8 players"],
        ],
      };
    default:
      return {};
  }
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
    ...ownerFrame(kind, language),
    ...(kind === "auction.reminder" ? reminderFrame(variant, language) : {}),
    ...resultsFrame(kind, language),
    ...matchesFrame(kind, variant, language),
    ...finaleFrame(kind, variant, language),
    ...(kind === "club.invite" || kind === "club.member_joined"
      ? {
          band: clubBand(
            String(sampleVariables(EMAIL_TEMPLATES[kind], language)["orgName"] ?? ""),
            language,
          ),
        }
      : {}),
  };
}
