import type { MessageLanguage } from "@desiauction/messaging/email-templates";

import type { EmailDateLeaf } from "./email-layout";
import { renderNotificationEmail, type NotificationMail } from "./notification-email";
import { seasonBand, type SeasonFacts } from "./player-mail";
import { momentWords } from "./request-context";

/**
 * "AUCTION NIGHT IS SET / HAS MOVED / IS OFF FOR NOW" (email programme PR6) —
 * the date tile, the moment in IST, and a line for the reader's part in it.
 */

const IST_OFFSET_MS = 330 * 60 * 1000;

const MONTHS: Readonly<Record<MessageLanguage, readonly string[]>> = {
  en: ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"],
  hi: [
    "जन॰",
    "फ़र॰",
    "मार्च",
    "अप्रैल",
    "मई",
    "जून",
    "जुल॰",
    "अग॰",
    "सित॰",
    "अक्टू॰",
    "नव॰",
    "दिस॰",
  ],
};
const WEEKDAYS: Readonly<Record<MessageLanguage, readonly string[]>> = {
  en: ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"],
  hi: ["रवि", "सोम", "मंगल", "बुध", "गुरु", "शुक्र", "शनि"],
};
const AUCTION_OF: Readonly<Record<MessageLanguage, (season: string) => string>> = {
  en: (season) => `${season} auction`,
  hi: (season) => `${season} की नीलामी`,
};

/** "8:00 pm IST" — the time alone, for the tile. */
function timeWords(at: Date): string {
  const ist = new Date(at.getTime() + IST_OFFSET_MS);
  const hours = ist.getUTCHours();
  const minutes = String(ist.getUTCMinutes()).padStart(2, "0");
  const twelve = hours % 12 === 0 ? 12 : hours % 12;
  return `${String(twelve)}:${minutes} ${hours < 12 ? "am" : "pm"} IST`;
}

/** The calendar leaf for a moment, in IST and the reader's language. */
export function auctionDateLeaf(
  at: Date,
  season: string,
  language: MessageLanguage,
): EmailDateLeaf {
  const ist = new Date(at.getTime() + IST_OFFSET_MS);
  return {
    month: MONTHS[language][ist.getUTCMonth()] ?? "",
    day: String(ist.getUTCDate()),
    weekday: WEEKDAYS[language][ist.getUTCDay()] ?? "",
    title: AUCTION_OF[language](season),
    detail: timeWords(at),
  };
}

export type ScheduleChange = "set" | "moved" | "cleared";

export interface AuctionScheduleFacts extends SeasonFacts {
  readonly name: string;
  readonly change: ScheduleChange;
  /** The new time; null when cleared. */
  readonly at: Date | null;
  /** The old time, for "moved". */
  readonly previous: Date | null;
  /** The team an owner bids for; null for a player. */
  readonly teamName: string | null;
  /** Where the button goes — the owner's room, or the player's season page. */
  readonly url: string;
}

export function auctionScheduleMail(
  facts: AuctionScheduleFacts,
  language: MessageLanguage,
): Promise<NotificationMail> {
  return renderNotificationEmail(
    "auction.schedule",
    language,
    {
      name: facts.name,
      season: facts.season,
      orgName: facts.orgName,
      when: facts.at === null ? "" : momentWords(facts.at, language),
      previous: facts.previous === null ? "" : momentWords(facts.previous, language),
      teamName: facts.teamName ?? "",
      ifPlayer: facts.teamName === null,
    },
    {
      variant: facts.change,
      action: { id: "season", url: facts.url },
      band: seasonBand(facts),
      ...(facts.at === null ? {} : { dateLeaf: auctionDateLeaf(facts.at, facts.season, language) }),
    },
  );
}
