import { auditLog, messageOutbox, type Db } from "@desiauction/db";
import { messageLanguagesOf } from "@desiauction/messaging/language";
import { and, eq, inArray, like, or, sql } from "drizzle-orm";

import { db as appDb, systemDb } from "../db";
import { logger } from "../logger";
import { matchDayMail, organizerMatchDayMail, type MatchDayWhen } from "../messaging/fixture-mail";
import { enqueueMail, type QueuedMail } from "../messaging/outbox";
import { organizersOf } from "../orgs/organizer-notify";
import { nowWallClock } from "./fixtures";
import {
  matchesUrl,
  matchesWhere,
  seasonOf,
  teamPeopleOf,
  toMatch,
  type MatchRecord,
  type TeamPerson,
} from "./fixture-notify";

/**
 * MATCH DAY (email programme PR11), swept every two minutes by the messages
 * job, which then drains what this queued.
 *
 *   · WHEN. At 7 am IST on the day — or at 6 pm the evening before, for a
 *     match that starts before 11 am (a 7 am note for a 7:30 start is no note
 *     at all). Never inside the hour before kickoff: a job that was down does
 *     not send "your match is today" as the toss happens.
 *   · WHO. Both teams' players and owners — each hears their team's matches
 *     that day, in ONE mail, with the ground's address and, when the lineup
 *     was announced and they are in it, that they are in it (never that they
 *     are not: C-23). Each organizer hears the whole day at a glance, with
 *     the lineups still to announce.
 *   · ONCE per person per season per match date, by the outbox key. Built
 *     when due, so a match moved the day before is sent at its new time.
 *
 * Cross-club reads on the system pool (posture allowlist); mail queued on the
 * app pool.
 */

const HOUR = 60 * 60 * 1000;
export const MORNING_HOUR_IST = 7;
export const EVENING_HOUR_IST = 18;
/** A match starting before this hour is told the evening before. */
export const EARLY_MATCH_HOUR = 11;
export const LAST_CALL_MS = HOUR;
/** The furthest ahead a note can be due: 6 pm for an early match the next day. */
const HORIZON_MS = 18 * HOUR;

/** When a match's note is due — the instant, from its IST wall clock. */
export function matchDayDueAt(kickoffAt: string): Date {
  const date = kickoffAt.slice(0, 10);
  const hour = Number(kickoffAt.slice(11, 13));
  if (hour < EARLY_MATCH_HOUR) {
    const eve = new Date(new Date(`${date}T00:00:00+05:30`).getTime() - 24 * HOUR);
    return new Date(eve.getTime() + EVENING_HOUR_IST * HOUR);
  }
  return new Date(`${date}T${String(MORNING_HOUR_IST).padStart(2, "0")}:00:00+05:30`);
}

interface DueRow extends Record<string, unknown> {
  competition_id: string;
  kickoff_at: string;
}

export interface MatchDayResult {
  readonly queued: number;
}

export async function sweepMatchDays(
  options: {
    now?: Date;
    readDb?: Db;
    outboxDb?: Db;
    /** Only these seasons — a test's own, in a shared database. */
    competitionIds?: readonly string[];
  } = {},
): Promise<MatchDayResult> {
  const now = options.now ?? new Date();
  const readDb = options.readDb ?? systemDb;
  const outboxDb = options.outboxDb ?? appDb;
  const candidates = await readDb.execute<DueRow>(sql`
    select f.competition_id, f.kickoff_at
    from fixtures f
    where f.status = 'published' and f.kickoff_at is not null
      and f.kickoff_at > ${nowWallClock(new Date(now.getTime() + LAST_CALL_MS))}
      and f.kickoff_at <= ${nowWallClock(new Date(now.getTime() + HORIZON_MS))}
  `);
  // One group per season and match date, once any match in it is due.
  const groups = new Map<string, { competitionId: string; date: string }>();
  for (const row of candidates) {
    if (matchDayDueAt(row.kickoff_at).getTime() > now.getTime()) continue;
    const competitionId = row.competition_id.trim();
    if (options.competitionIds !== undefined && !options.competitionIds.includes(competitionId)) {
      continue;
    }
    const date = row.kickoff_at.slice(0, 10);
    groups.set(`${competitionId}:${date}`, { competitionId, date });
  }
  let queued = 0;
  for (const group of groups.values()) {
    try {
      queued += await queueMatchDay(readDb, outboxDb, group, now);
    } catch (error) {
      logger().error(
        { err: error, competitionId: group.competitionId, date: group.date },
        "match_day.season_failed",
      );
    }
  }
  return { queued };
}

async function queueMatchDay(
  readDb: Db,
  outboxDb: Db,
  group: { competitionId: string; date: string },
  now: Date,
): Promise<number> {
  const season = await seasonOf(readDb, group.competitionId);
  if (season === null) return 0;
  const matches = (
    await matchesWhere(
      readDb,
      sql`f.competition_id = ${group.competitionId} and f.status = 'published'
        and left(f.kickoff_at, 10) = ${group.date}`,
    )
  ).map(toMatch);
  if (matches.length === 0) return 0;
  const when: MatchDayWhen = nowWallClock(now).slice(0, 10) === group.date ? "today" : "tomorrow";
  const [people, organizers, told, announced] = await Promise.all([
    teamPeopleOf(readDb, group.competitionId),
    organizersOf(readDb, season.orgId),
    toldInLineup(
      outboxDb,
      matches.map((match) => match.id),
    ),
    lineupsAnnounced(
      readDb,
      matches.map((match) => match.id),
    ),
  ]);
  const recipients: { person: TeamPerson; matches: MatchRecord[] }[] = [];
  const seen = new Set<string>(organizers);
  for (const [teamId, members] of people) {
    const theirs = matches.filter((match) => match.teamIds.includes(teamId));
    if (theirs.length === 0) continue;
    for (const person of members) {
      if (seen.has(person.personId)) continue;
      seen.add(person.personId);
      recipients.push({ person, matches: theirs });
    }
  }
  const everyone = [...organizers, ...recipients.map((r) => r.person.personId)];
  const [languages, names] = await Promise.all([
    messageLanguagesOf(readDb, everyone),
    namesOf(readDb, organizers),
  ]);
  const facts = {
    season: season.season.trim(),
    orgName: season.orgName.trim(),
    seasonSlug: season.seasonSlug,
    sport: season.sport,
  };
  const key = (personId: string) => `match.day:${group.competitionId}:${group.date}:${personId}`;
  const mails: QueuedMail[] = [];
  for (const personId of organizers) {
    mails.push({
      ...(await organizerMatchDayMail(
        {
          ...facts,
          name: names.get(personId) ?? "there",
          when,
          matches: matches.map((match) => ({
            ...match,
            lineupsAnnounced: announced.get(match.id) ?? 0,
          })),
          url: matchesUrl(season, { owner: true }, { date: group.date }),
        },
        languages.get(personId) ?? "en",
      )),
      personId,
      orgId: season.orgId,
      kind: "match.day",
      dedupeKey: key(personId),
    });
  }
  for (const { person, matches: theirs } of recipients) {
    const first = theirs[0];
    if (first === undefined) continue;
    mails.push({
      ...(await matchDayMail(
        {
          ...facts,
          name: person.name,
          teamId: person.teamId,
          teamName: person.teamName,
          matches: theirs,
          when,
          inLineup:
            person.registrationId !== null && told.has(`${first.id}:${person.registrationId}`),
          address: first.address,
          url: matchesUrl(season, person, { matchId: first.id }),
        },
        languages.get(person.personId) ?? "en",
      )),
      personId: person.personId,
      orgId: season.orgId,
      kind: "match.day",
      dedupeKey: key(person.personId),
    });
  }
  return (await enqueueMail(mails, outboxDb)).length;
}

/** "fixtureId:registrationId" for everyone told they are in a lineup (lineup-announce.ts keys). */
async function toldInLineup(db: Db, fixtureIds: readonly string[]): Promise<Set<string>> {
  if (fixtureIds.length === 0) return new Set();
  const rows = await db
    .select({ key: messageOutbox.dedupeKey })
    .from(messageOutbox)
    .where(
      or(...fixtureIds.map((id) => like(messageOutbox.dedupeKey, `lineup.announced:${id}:%`))),
    );
  return new Set(rows.map((row) => row.key.slice("lineup.announced:".length)));
}

/** How many sides of each match have announced a lineup. */
async function lineupsAnnounced(
  db: Db,
  fixtureIds: readonly string[],
): Promise<Map<string, number>> {
  if (fixtureIds.length === 0) return new Map();
  const rows = await db
    .select({ fixtureId: auditLog.subject, teamId: sql<string>`${auditLog.meta}->>'teamId'` })
    .from(auditLog)
    .where(
      and(
        eq(auditLog.action, "fixture.lineup.announced"),
        inArray(auditLog.subject, [...fixtureIds]),
      ),
    );
  const sides = new Map<string, Set<string>>();
  for (const row of rows) {
    if (row.fixtureId === null) continue;
    const id = row.fixtureId.trim();
    sides.set(id, (sides.get(id) ?? new Set()).add(row.teamId));
  }
  return new Map([...sides].map(([id, teams]) => [id, teams.size]));
}

async function namesOf(db: Db, personIds: readonly string[]): Promise<Map<string, string>> {
  if (personIds.length === 0) return new Map();
  const rows = await db.execute<{ id: string; name: string | null } & Record<string, unknown>>(sql`
    select id, name from people where id in (${sql.join(
      personIds.map((id) => sql`${id}`),
      sql`, `,
    )})
  `);
  return new Map(rows.map((row) => [row.id.trim(), row.name?.trim() || "there"]));
}
