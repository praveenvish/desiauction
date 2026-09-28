import type { MessageLanguage } from "@desiauction/messaging/email-templates";

import { renderNotificationEmail, type NotificationMail } from "./notification-email";
import { monogramOf, seasonBand, type SeasonFacts } from "./player-mail";

/**
 * THE SEASON'S END (email programme PR12) — when the organizer names the
 * champion. Three readers: the champion team (a trophy, on the stage), every
 * other team (where they finished — plainly, never as a verdict: C-23), and
 * the organizers (the final table). Gathered in competition/season-finale.ts.
 */

export interface FinaleRow {
  readonly teamId: string;
  readonly teamName: string;
  readonly played: number;
  readonly won: number;
  readonly points: number;
}

export type FinaleRole = "champion" | "team" | "organizer";

export interface FinaleFacts extends SeasonFacts {
  readonly name: string;
  readonly role: FinaleRole;
  /** The reader's team; null for an organizer. */
  readonly teamId: string | null;
  /** The final table, in order — its first row is NOT necessarily the champion. */
  readonly table: readonly FinaleRow[];
  readonly championId: string;
  readonly url: string;
}

/** Rows shown to a team: the top of the table, and their own row when it is further down. */
export const TEAM_ROWS = 4;
/** Rows shown to an organizer — a season's whole table, within reason. */
export const ORGANIZER_ROWS = 12;

const EN_SUFFIX = (n: number): string => {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return "th";
  return ["th", "st", "nd", "rd"][n % 10] ?? "th";
};
const HI_ORDINAL = ["पहले", "दूसरे", "तीसरे", "चौथे", "पाँचवें", "छठे"];

/** "3rd of 8" / "8 में से तीसरे". */
export function placeWords(position: number, of: number, language: MessageLanguage): string {
  if (language === "hi") {
    return `${String(of)} में से ${HI_ORDINAL[position - 1] ?? `${String(position)}वें`}`;
  }
  return `${String(position)}${EN_SUFFIX(position)} of ${String(of)}`;
}

/** "7 wins from 8 matches · 14 points". */
export function recordWords(row: FinaleRow, language: MessageLanguage): string {
  if (language === "hi") {
    return `${String(row.played)} मैचों में ${String(row.won)} जीत · ${String(row.points)} अंक`;
  }
  const wins = `${String(row.won)} ${row.won === 1 ? "win" : "wins"}`;
  const matches = `${String(row.played)} ${row.played === 1 ? "match" : "matches"}`;
  return `${wins} from ${matches} · ${String(row.points)} ${row.points === 1 ? "point" : "points"}`;
}

/** One table row: "1. Cup Kings" — "14 pts · 7W". */
function tableLine(
  row: FinaleRow,
  position: number,
  mark: string | null,
  language: MessageLanguage,
): readonly [string, string] {
  const pts = language === "hi" ? `${String(row.points)} अंक` : `${String(row.points)} pts`;
  const won = language === "hi" ? `${String(row.won)} जीत` : `${String(row.won)}W`;
  return [
    `${String(position)}. ${row.teamName}${mark === null ? "" : ` · ${mark}`}`,
    `${pts} · ${won}`,
  ];
}

/** The rows a reader sees: the top, the champion, and their own team. */
export function finaleTable(
  facts: Pick<FinaleFacts, "table" | "championId" | "teamId" | "role">,
  language: MessageLanguage,
): readonly (readonly [string, string])[] {
  const limit = facts.role === "organizer" ? ORGANIZER_ROWS : TEAM_ROWS;
  const champion = language === "hi" ? "चैंपियन" : "Champion";
  const yours = language === "hi" ? "आपकी टीम" : "Your team";
  return facts.table.flatMap((row, i) => {
    const mine = row.teamId === facts.teamId;
    const crowned = row.teamId === facts.championId;
    if (i >= limit && !mine && !crowned) return [];
    return [tableLine(row, i + 1, crowned ? champion : mine ? yours : null, language)];
  });
}

export function finaleMail(
  facts: FinaleFacts,
  language: MessageLanguage,
): Promise<NotificationMail> {
  const championRow = facts.table.find((row) => row.teamId === facts.championId);
  const index = facts.table.findIndex((row) => row.teamId === facts.teamId);
  const mine = index === -1 ? undefined : facts.table[index];
  const champion = championRow?.teamName ?? "";
  const record = championRow === undefined ? "" : recordWords(championRow, language);
  const band = seasonBand(facts);
  return renderNotificationEmail(
    "season.champion",
    language,
    {
      name: facts.name,
      season: facts.season,
      orgName: facts.orgName,
      teamName: mine?.teamName ?? "",
      champion,
      recordLine: record,
      place: index === -1 ? "" : placeWords(index + 1, facts.table.length, language),
    },
    {
      variant: facts.role,
      action: { id: "season", url: facts.url },
      ...(facts.role === "champion"
        ? {
            stage: {
              kicker: facts.season,
              monogram: monogramOf(champion),
              title: champion,
              figure: language === "hi" ? "चैंपियन" : "Champions",
              line: record,
            },
            details: finaleTable(facts, language),
          }
        : { band, details: finaleTable(facts, language) }),
    },
  );
}
