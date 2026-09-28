import type { MessageLanguage } from "@desiauction/messaging/email-templates";

import { leafDate, timeWords } from "./auction-schedule-mail";
import type { EmailFixture, EmailMatchup } from "./email-layout";
import { renderNotificationEmail, type NotificationMail } from "./notification-email";
import { monogramOf, seasonBand, type SeasonFacts } from "./player-mail";
import { momentWords } from "./request-context";

/**
 * THE SEASON'S MATCHES (email programme PR11) — the schedule a team was given,
 * a match that moved or was called off, and match day. Every builder takes
 * plain facts and the reader's language; the gathering is elsewhere
 * (competition/fixture-notify.ts, competition/match-day.ts), so the gallery and
 * the tests render exactly what is sent.
 *
 * A fixture's kickoff is an IST WALL CLOCK ("2026-10-04T19:30"), never an
 * instant; it becomes one here, once, so the words and the tile agree.
 */

export interface MatchSide {
  readonly id: string;
  readonly name: string;
  readonly color: string | null;
}

export interface MatchFacts {
  readonly id: string;
  /** "YYYY-MM-DDTHH:MM", IST. */
  readonly kickoffAt: string;
  /** The ground (or the venue, when the ground has no name of its own). */
  readonly ground: string | null;
  /** Both null on a lobby, whose squads are counted instead. */
  readonly home: MatchSide | null;
  readonly away: MatchSide | null;
  readonly squadCount: number;
}

/** The wall clock as the instant it names. */
export function wallInstant(wall: string): Date {
  return new Date(`${wall}:00+05:30`);
}

const WORDS = {
  en: {
    versus: "vs",
    against: (team: string) => `vs ${team}`,
    lobby: (n: number) => `Lobby · ${String(n)} teams`,
    matches: (n: number) => `${String(n)} ${n === 1 ? "match" : "matches"}`,
    more: (n: number) => `…and ${String(n)} more on the season page.`,
    yours: "Your team",
    matchDay: "Match day",
    tomorrow: "Tomorrow",
    lineup: "Lineup",
    was: "Was",
    wasSetFor: "Was set for",
    ground: "Ground",
    address: "Address",
    kickoff: "Kick-off",
    today: "today",
    tomorrowWord: "tomorrow",
    inLineup: "You're in the lineup — good luck!",
    twice: (team: string, n: number) =>
      `${team} play ${n === 2 ? "twice" : `${String(n)} times`} — every match is below.`,
    note: (reason: string) => `The organizer's note: “${reason}”`,
    lineupsIn: "Lineups in",
    lineupsOf: (a: number, b: number) => `${String(a)}/${String(b)} lineups`,
    gap: (n: number) =>
      `${String(n)} ${n === 1 ? "lineup isn't" : "lineups aren't"} announced yet — announce them from the Matches screen.`,
  },
  hi: {
    versus: "बनाम",
    against: (team: string) => `बनाम ${team}`,
    lobby: (n: number) => `लॉबी · ${String(n)} टीमें`,
    matches: (n: number) => `${String(n)} मैच`,
    more: (n: number) => `…और ${String(n)} मैच सीज़न पेज पर।`,
    yours: "आपकी टीम",
    matchDay: "मैच डे",
    tomorrow: "कल",
    lineup: "प्लेइंग टीम",
    was: "पहले",
    wasSetFor: "तय था",
    ground: "मैदान",
    address: "पता",
    kickoff: "शुरुआत",
    today: "आज",
    tomorrowWord: "कल",
    inLineup: "आप प्लेइंग टीम में हैं — शुभकामनाएँ!",
    twice: (team: string, n: number) => `${team} के ${String(n)} मैच हैं — सभी नीचे हैं।`,
    note: (reason: string) => `आयोजक का नोट: “${reason}”`,
    lineupsIn: "टीमें घोषित",
    lineupsOf: (a: number, b: number) => `${String(a)}/${String(b)} टीमें`,
    gap: (n: number) => `${String(n)} प्लेइंग टीमें अभी घोषित नहीं हुईं — मैच पेज से घोषित करें।`,
  },
} as const;

/** "Cup Kings vs Tigers", or "Lobby · 12 teams". */
export function matchTitle(match: MatchFacts, language: MessageLanguage): string {
  const w = WORDS[language];
  return match.home !== null && match.away !== null
    ? `${match.home.name} ${w.versus} ${match.away.name}`
    : w.lobby(match.squadCount);
}

/** The match from one team's side — "vs Tigers" — or the whole title for a lobby or a neutral reader. */
export function matchAgainst(
  match: MatchFacts,
  teamId: string | null,
  language: MessageLanguage,
): string {
  const w = WORDS[language];
  if (teamId !== null && match.home !== null && match.away !== null) {
    if (match.home.id === teamId) return w.against(match.away.name);
    if (match.away.id === teamId) return w.against(match.home.name);
  }
  return matchTitle(match, language);
}

/** "7:30 pm IST · Malad Ground" */
export function whenAndWhere(match: MatchFacts): string {
  const time = timeWords(wallInstant(match.kickoffAt));
  return match.ground === null ? time : `${time} · ${match.ground}`;
}

/** "Sun 4 Oct" / "रवि, 4 अक्टू॰" — the day without the time. */
export function dayWords(at: Date, language: MessageLanguage): string {
  const words = momentWords(at, language);
  const cut = words.lastIndexOf(",");
  return cut === -1 ? words : words.slice(0, cut);
}

/** "Sun 4 Oct, 7:30 pm" — the moment without "IST" (the mail says it once). */
function shortMoment(wall: string, language: MessageLanguage): string {
  return momentWords(wallInstant(wall), language).replace(/ IST$/, "");
}

/** One row of a schedule. */
export function fixtureLine(
  match: MatchFacts,
  teamId: string | null,
  language: MessageLanguage,
  note?: string,
): EmailFixture {
  return {
    ...leafDate(wallInstant(match.kickoffAt), language),
    title: matchAgainst(match, teamId, language),
    detail: whenAndWhere(match),
    ...(note === undefined ? {} : { note }),
  };
}

/** The two crests; none for a lobby, which has no two sides to draw. */
export function matchupOf(
  match: MatchFacts,
  teamId: string | null,
  kicker: string,
  language: MessageLanguage,
): EmailMatchup | undefined {
  if (match.home === null || match.away === null) return undefined;
  const side = (s: MatchSide) => ({
    name: s.name,
    monogram: monogramOf(s.name),
    color: s.color,
    yours: s.id === teamId,
  });
  return {
    kicker,
    home: side(match.home),
    away: side(match.away),
    versus: WORDS[language].versus,
    yoursLabel: WORDS[language].yours,
    line: `${dayWords(wallInstant(match.kickoffAt), language)} · ${whenAndWhere(match)}`,
  };
}

// --- The schedule, published ---------------------------------------------------

/** Rows shown before "…and N more": a season's worth would bury the first match. */
export const SCHEDULE_ROWS = 8;

export interface ScheduleFacts extends SeasonFacts {
  readonly name: string;
  readonly teamId: string;
  readonly teamName: string;
  /** The team's published matches still to come, soonest first. */
  readonly matches: readonly MatchFacts[];
  /** "first" the first time this person hears of the schedule; "updated" after. */
  readonly variant: "first" | "updated";
  readonly url: string;
}

export function scheduleMail(
  facts: ScheduleFacts,
  language: MessageLanguage,
): Promise<NotificationMail> {
  const w = WORDS[language];
  const first = facts.matches[0];
  const shown = facts.matches.slice(0, SCHEDULE_ROWS);
  const hidden = facts.matches.length - shown.length;
  return renderNotificationEmail(
    "schedule.published",
    language,
    {
      name: facts.name,
      season: facts.season,
      orgName: facts.orgName,
      teamName: facts.teamName,
      matchCount: w.matches(facts.matches.length),
      firstMatch:
        first === undefined
          ? ""
          : `${dayWords(wallInstant(first.kickoffAt), language)} ${matchAgainst(first, facts.teamId, language)}`,
      moreLine: hidden > 0 ? w.more(hidden) : "",
    },
    {
      variant: facts.variant,
      action: { id: "matches", url: facts.url },
      band: seasonBand(facts),
      fixtures: shown.map((match) => fixtureLine(match, facts.teamId, language)),
    },
  );
}

// --- A published match moved, or was called off ------------------------------

export interface FixtureChangeFacts extends SeasonFacts {
  readonly name: string;
  readonly teamName: string;
  readonly change: "moved" | "cancelled";
  /** The match as it is NOW (its new time, for "moved"). */
  readonly match: MatchFacts;
  /** The kickoff it had. */
  readonly previousKickoff: string;
  /** The ground it had, when that changed too. */
  readonly previousGround: string | null;
  readonly reason: string | null;
  readonly url: string;
}

export function fixtureChangedMail(
  facts: FixtureChangeFacts,
  language: MessageLanguage,
): Promise<NotificationMail> {
  const w = WORDS[language];
  const title = matchTitle(facts.match, language);
  const previous = shortMoment(facts.previousKickoff, language);
  const moved = facts.change === "moved";
  const at = wallInstant(facts.match.kickoffAt);
  return renderNotificationEmail(
    "fixture.changed",
    language,
    {
      name: facts.name,
      season: facts.season,
      orgName: facts.orgName,
      teamName: facts.teamName,
      matchTitle: title,
      when: moved ? shortMoment(facts.match.kickoffAt, language) : "",
      previous,
      reasonLine: facts.reason === null || facts.reason === "" ? "" : w.note(facts.reason),
    },
    {
      variant: facts.change,
      action: { id: "match", url: facts.url },
      band: seasonBand(facts),
      ...(moved
        ? {
            dateLeaf: {
              ...leafDate(at, language),
              title,
              detail: whenAndWhere(facts.match),
            },
            details: [
              [w.was, previous],
              ...(facts.previousGround !== null && facts.previousGround !== facts.match.ground
                ? ([[`${w.was} (${w.ground})`, facts.previousGround]] as const)
                : []),
            ],
          }
        : { details: [[w.wasSetFor, previous]] }),
    },
  );
}

// --- Match day -------------------------------------------------------------------

export type MatchDayWhen = "today" | "tomorrow";

export interface MatchDayFacts extends SeasonFacts {
  readonly name: string;
  readonly teamId: string;
  readonly teamName: string;
  /** The team's matches that day, soonest first — at least one. */
  readonly matches: readonly MatchFacts[];
  readonly when: MatchDayWhen;
  /** In the ANNOUNCED lineup of the first match. Never said the other way (C-23). */
  readonly inLineup: boolean;
  /** "Link Road, Malad West, Mumbai" — the first match's venue, when it has one. */
  readonly address: string | null;
  readonly url: string;
}

export function matchDayMail(
  facts: MatchDayFacts,
  language: MessageLanguage,
): Promise<NotificationMail> {
  const w = WORDS[language];
  const first = facts.matches[0];
  if (first === undefined) {
    throw new Error("match day needs a match");
  }
  const kicker = facts.when === "today" ? w.matchDay : w.tomorrow;
  const matchup = matchupOf(first, facts.teamId, kicker, language);
  const several = facts.matches.length > 1;
  const placeClause =
    first.ground === null
      ? ""
      : language === "hi"
        ? `, ${first.ground} में`
        : ` at ${first.ground}`;
  return renderNotificationEmail(
    "match.day",
    language,
    {
      name: facts.name,
      season: facts.season,
      orgName: facts.orgName,
      teamName: facts.teamName,
      matchTitle: matchTitle(first, language),
      dayWord: facts.when === "today" ? w.today : w.tomorrowWord,
      time: timeWords(wallInstant(first.kickoffAt)).replace(/ IST$/, ""),
      placeClause,
      matchCount: w.matches(facts.matches.length),
      lineupLine: facts.inLineup ? w.inLineup : "",
      moreLine: several ? w.twice(facts.teamName, facts.matches.length) : "",
      gapLine: "",
    },
    {
      variant: "player",
      action: { id: "open", url: facts.url },
      ...(matchup === undefined ? { band: seasonBand(facts) } : { matchup }),
      ...(several
        ? { fixtures: facts.matches.map((match) => fixtureLine(match, facts.teamId, language)) }
        : {}),
      details: [
        [w.kickoff, timeWords(wallInstant(first.kickoffAt))],
        ...(first.ground === null ? [] : ([[w.ground, first.ground]] as const)),
        ...(facts.address === null ? [] : ([[w.address, facts.address]] as const)),
      ],
    },
  );
}

export interface OrganizerDayFacts extends SeasonFacts {
  readonly name: string;
  readonly when: MatchDayWhen;
  /** Every match that day, soonest first, with how many of its sides announced a lineup. */
  readonly matches: readonly (MatchFacts & { readonly lineupsAnnounced: number })[];
  readonly url: string;
}

export function organizerMatchDayMail(
  facts: OrganizerDayFacts,
  language: MessageLanguage,
): Promise<NotificationMail> {
  const w = WORDS[language];
  // A lobby has no two lineups to announce; only duels are counted.
  const duels = facts.matches.filter((match) => match.home !== null && match.away !== null);
  const missing = duels.reduce((sum, match) => sum + (2 - Math.min(match.lineupsAnnounced, 2)), 0);
  return renderNotificationEmail(
    "match.day",
    language,
    {
      name: facts.name,
      season: facts.season,
      orgName: facts.orgName,
      teamName: "",
      matchTitle: "",
      dayWord: facts.when === "today" ? w.today : w.tomorrowWord,
      time: "",
      placeClause: "",
      matchCount: w.matches(facts.matches.length),
      lineupLine: "",
      moreLine: "",
      gapLine: missing > 0 ? w.gap(missing) : "",
    },
    {
      variant: "organizer",
      action: { id: "open", url: facts.url },
      band: seasonBand(facts),
      fixtures: facts.matches.map((match) =>
        fixtureLine(
          match,
          null,
          language,
          match.home === null
            ? undefined
            : match.lineupsAnnounced >= 2
              ? w.lineupsIn
              : w.lineupsOf(match.lineupsAnnounced, 2),
        ),
      ),
    },
  );
}

/** The lineup mail's matchup (player-mail.ts `lineupMail`). */
export function lineupMatchup(
  match: MatchFacts,
  teamId: string,
  language: MessageLanguage,
): EmailMatchup | undefined {
  return matchupOf(match, teamId, WORDS[language].lineup, language);
}
