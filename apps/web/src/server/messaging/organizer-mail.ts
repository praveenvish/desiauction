import type { MessageLanguage } from "@desiauction/messaging/email-templates";

import { env } from "../../env";
import type { EmailStep } from "./email-layout";
import {
  renderNotificationEmail,
  type NotificationMail,
  type RenderOptions,
} from "./notification-email";
import { monogramOf, seasonBand, type SeasonFacts } from "./player-mail";

/**
 * WHAT DESIAUCTION TELLS THE PEOPLE WHO RUN A CLUB (email programme PR5): the
 * welcome, the first registration, the 9 am digest and a moderation hold.
 *
 * Wording is the template registry's; the code writes only facts — the club
 * band, the organizer's tracker, the steps and the per-season counts — in the
 * reader's language.
 */

const BASE = (): string => env.PUBLIC_BASE_URL.replace(/\/$/, "");

const JOURNEY: Readonly<Record<MessageLanguage, readonly [string, string, string, string]>> = {
  en: ["Club", "Season", "Players", "Auction"],
  hi: ["क्लब", "सीज़न", "खिलाड़ी", "नीलामी"],
};

/** The organizer's four steps to auction night; `at` is the one they are on (4: all done). */
export function organizerJourney(
  at: 1 | 2 | 3 | 4,
  language: MessageLanguage,
): readonly EmailStep[] {
  return JOURNEY[language].map((label, i) => ({
    label,
    state: i < at ? "done" : i === at ? "now" : "next",
  }));
}

export function reviewUrl(seasonSlug: string): string {
  return `${BASE()}/seasons/${encodeURIComponent(seasonSlug)}/registrations?status=submitted`;
}

function seasonUrl(seasonSlug: string): string {
  return `${BASE()}/seasons/${encodeURIComponent(seasonSlug)}`;
}

// --- The welcome ----------------------------------------------------------------

/** The three steps to auction night — the product's own screens, in order. */
const FIRST_STEPS: Readonly<Record<MessageLanguage, readonly (readonly [string, string])[]>> = {
  en: [
    ["1 · Add a season", "Name and dates"],
    ["2 · Open registration", "Share one link"],
    ["3 · Invite team owners", "One paddle each"],
  ],
  hi: [
    ["1 · सीज़न जोड़ें", "नाम और तारीखें"],
    ["2 · रजिस्ट्रेशन खोलें", "एक लिंक शेयर करें"],
    ["3 · टीम मालिक बुलाएँ", "हर मालिक का पैडल"],
  ],
};

const CLUB_SUBTITLE: Readonly<Record<MessageLanguage, string>> = {
  en: "A club on DesiAuction",
  hi: "DesiAuction पर एक क्लब",
};

/** The welcome's facts: the club band, the organizer's tracker and the three steps. */
export function welcomeFrame(
  orgName: string,
  language: MessageLanguage,
): Pick<RenderOptions, "band" | "progress" | "details"> {
  return {
    band: { title: orgName, subtitle: CLUB_SUBTITLE[language], monogram: monogramOf(orgName) },
    progress: organizerJourney(1, language),
    details: FIRST_STEPS[language],
  };
}

export function clubWelcomeMail(
  facts: { name: string; orgName: string; orgSlug: string },
  language: MessageLanguage,
): Promise<NotificationMail> {
  return renderNotificationEmail(
    "club.welcome",
    language,
    { name: facts.name, orgName: facts.orgName },
    {
      action: { id: "club", url: `${BASE()}/org/${encodeURIComponent(facts.orgSlug)}` },
      ...welcomeFrame(facts.orgName, language),
    },
  );
}

// --- The first registration -----------------------------------------------------

export function firstRegistrationMail(
  facts: SeasonFacts & { name: string; playerName: string; seasonSlug: string },
  language: MessageLanguage,
): Promise<NotificationMail> {
  return renderNotificationEmail(
    "registration.first",
    language,
    { name: facts.name, season: facts.season, playerName: facts.playerName },
    {
      action: { id: "review", url: reviewUrl(facts.seasonSlug) },
      band: seasonBand(facts),
      progress: organizerJourney(2, language),
    },
  );
}

// --- The 9 am digest ------------------------------------------------------------

export interface DigestSeason {
  readonly season: string;
  readonly orgName: string;
  readonly seasonSlug: string;
  readonly waiting: number;
  /** Whole days the oldest waiting registration has waited. */
  readonly oldestDays: number;
}

function waitingWords(count: number, language: MessageLanguage): string {
  if (language === "hi") return `${String(count)} रजिस्ट्रेशन`;
  return `${String(count)} ${count === 1 ? "registration" : "registrations"}`;
}

/** "9 waiting · 3 days" — how many, and how long the oldest has waited. */
function seasonLine(season: DigestSeason, language: MessageLanguage): string {
  if (language === "hi") {
    const age = season.oldestDays >= 1 ? `${String(season.oldestDays)} दिन` : "आज";
    return `${String(season.waiting)} इंतज़ार में · ${age}`;
  }
  const age =
    season.oldestDays >= 1
      ? `${String(season.oldestDays)} ${season.oldestDays === 1 ? "day" : "days"}`
      : "today";
  return `${String(season.waiting)} waiting · ${age}`;
}

/** One row per season: its name (and club, when there are several) and how many wait. */
export function digestDetails(
  seasons: readonly DigestSeason[],
  language: MessageLanguage,
): readonly (readonly [string, string])[] {
  const clubs = new Set(seasons.map((season) => season.orgName)).size;
  return seasons.map(
    (season) =>
      [
        clubs > 1 ? `${season.season} (${season.orgName})` : season.season,
        seasonLine(season, language),
      ] as const,
  );
}

export function registrationDigestMail(
  facts: { name: string; seasons: readonly DigestSeason[] },
  language: MessageLanguage,
): Promise<NotificationMail> {
  const total = facts.seasons.reduce((sum, season) => sum + season.waiting, 0);
  const only = facts.seasons.length === 1 ? facts.seasons[0] : undefined;
  return renderNotificationEmail(
    "registration.digest",
    language,
    { name: facts.name, waiting: waitingWords(total, language) },
    {
      action: {
        id: "review",
        // One season: straight to its queue. Several: home, which lists them.
        url: only === undefined ? `${BASE()}/home` : reviewUrl(only.seasonSlug),
      },
      // A person who runs seasons for more than one club reads the club too.
      details: digestDetails(facts.seasons, language),
    },
  );
}

// --- A moderation hold ----------------------------------------------------------

export function seasonHeldMail(
  facts: SeasonFacts & { name: string; seasonSlug: string; reason: string },
  language: MessageLanguage,
): Promise<NotificationMail> {
  return renderNotificationEmail(
    "season.held",
    language,
    { name: facts.name, season: facts.season, reason: facts.reason },
    { action: { id: "season", url: seasonUrl(facts.seasonSlug) }, band: seasonBand(facts) },
  );
}

export function seasonReleasedMail(
  facts: SeasonFacts & { name: string; seasonSlug: string },
  language: MessageLanguage,
): Promise<NotificationMail> {
  return renderNotificationEmail(
    "season.released",
    language,
    { name: facts.name, season: facts.season },
    { action: { id: "season", url: seasonUrl(facts.seasonSlug) }, band: seasonBand(facts) },
  );
}

// --- The results pack -------------------------------------------------------------

export interface TeamSpend {
  readonly team: string;
  readonly spent: string;
  readonly players: number;
}

const PLAYERS_WORD: Readonly<Record<MessageLanguage, (n: number) => string>> = {
  en: (n) => `${String(n)} ${n === 1 ? "player" : "players"}`,
  hi: (n) => `${String(n)} खिलाड़ी`,
};

/**
 * "THE AUCTION IS DONE" — to the organizers when the auction completes: how
 * many were sold for how much, the top buys, and each team's spend. What the
 * room already showed, gathered in one place (outcome-mail.ts).
 */
export function auctionResultsMail(
  facts: SeasonFacts & {
    name: string;
    seasonSlug: string;
    sold: number;
    pool: number;
    spent: string;
    topBuys: readonly string[];
    teams: readonly TeamSpend[];
  },
  language: MessageLanguage,
): Promise<NotificationMail> {
  return renderNotificationEmail(
    "auction.results",
    language,
    {
      name: facts.name,
      season: facts.season,
      soldCount: String(facts.sold),
      poolCount: String(facts.pool),
      spent: facts.spent,
      topBuys: facts.topBuys,
    },
    {
      action: { id: "results", url: `${seasonUrl(facts.seasonSlug)}/auction` },
      band: seasonBand(facts),
      progress: organizerJourney(4, language),
      details: facts.teams.map(
        (team) => [team.team, `${team.spent} · ${PLAYERS_WORD[language](team.players)}`] as const,
      ),
    },
  );
}
