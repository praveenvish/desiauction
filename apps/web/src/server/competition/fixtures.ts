import { addDays, type FixtureStatus } from "@desiauction/core";
import {
  auditLog,
  competitions,
  fixtures,
  grounds,
  orgMembers,
  teams,
  venues,
  type Db,
} from "@desiauction/db";
import { alias } from "drizzle-orm/pg-core";
import { and, asc, desc, eq, gte, ilike, inArray, lte, sql, type SQL } from "drizzle-orm";

// FIXTURE SNAPSHOTS (M-IP3-3, CTO addition 2). The immutable projection every
// downstream surface reads — calendar, exports, and (future) the Auction and
// Match engines. Nothing outside fixture-aggregate.ts touches mutable rows;
// this module is read-only and returns plain frozen shapes, never ORM entities.
// All queries are server-driven: filter/sort/page in SQL, stable (kickoff, seq)
// ordering, indexed for the 500+ fixture target.

export interface FixtureSnapshot {
  readonly id: string;
  readonly number: string;
  readonly seq: number;
  readonly round: number | null;
  readonly homeTeamId: string;
  readonly homeTeamName: string;
  readonly homeTeamShort: string | null;
  readonly homeTeamColor: string | null;
  readonly awayTeamId: string;
  readonly awayTeamName: string;
  readonly awayTeamShort: string | null;
  readonly awayTeamColor: string | null;
  readonly groundId: string | null;
  readonly groundName: string | null;
  readonly venueId: string | null;
  readonly venueName: string | null;
  readonly kickoffAt: string | null; // YYYY-MM-DDTHH:MM wall clock
  readonly durationMinutes: number | null;
  readonly status: FixtureStatus;
  readonly cancelReason: string | null;
}

const homeTeams = alias(teams, "home_teams");
const awayTeams = alias(teams, "away_teams");

const SNAPSHOT_COLUMNS = {
  id: fixtures.id,
  number: fixtures.fixtureNumber,
  seq: fixtures.seq,
  round: fixtures.round,
  homeTeamId: fixtures.homeTeamId,
  homeTeamName: homeTeams.name,
  homeTeamShort: homeTeams.shortName,
  homeTeamColor: homeTeams.primaryColor,
  awayTeamId: fixtures.awayTeamId,
  awayTeamName: awayTeams.name,
  awayTeamShort: awayTeams.shortName,
  awayTeamColor: awayTeams.primaryColor,
  groundId: fixtures.groundId,
  groundName: grounds.name,
  venueId: grounds.venueId,
  venueName: venues.name,
  kickoffAt: fixtures.kickoffAt,
  durationMinutes: fixtures.durationMinutes,
  status: fixtures.status,
  cancelReason: fixtures.cancelReason,
};

interface SnapshotRow {
  id: string;
  number: string;
  seq: number;
  round: number | null;
  homeTeamId: string;
  homeTeamName: string | null;
  homeTeamShort: string | null;
  homeTeamColor: string | null;
  awayTeamId: string;
  awayTeamName: string | null;
  awayTeamShort: string | null;
  awayTeamColor: string | null;
  groundId: string | null;
  groundName: string | null;
  venueId: string | null;
  venueName: string | null;
  kickoffAt: string | null;
  durationMinutes: number | null;
  status: FixtureStatus;
  cancelReason: string | null;
}

function toSnapshot(row: SnapshotRow): FixtureSnapshot {
  return Object.freeze({
    ...row,
    homeTeamName: row.homeTeamName ?? "Unknown",
    awayTeamName: row.awayTeamName ?? "Unknown",
  });
}

function snapshotQuery(db: Db) {
  return db
    .select(SNAPSHOT_COLUMNS)
    .from(fixtures)
    .leftJoin(homeTeams, eq(homeTeams.id, fixtures.homeTeamId))
    .leftJoin(awayTeams, eq(awayTeams.id, fixtures.awayTeamId))
    .leftJoin(grounds, eq(grounds.id, fixtures.groundId))
    .leftJoin(venues, eq(venues.id, grounds.venueId));
}

// --- Dashboard: statistics + paginated snapshots ---------------------------------

export interface FixtureStats {
  total: number;
  draft: number;
  scheduled: number;
  published: number;
  inProgress: number;
  completed: number;
  cancelled: number;
  /**
   * How many rounds the SCHEDULE spans. The header used to derive this from the
   * 25 rows of the current page, so a 30-round, 240-fixture season announced
   * itself as "240 fixtures across 4 rounds". Rounds are a property of the
   * schedule, so they are counted where the schedule is.
   */
  rounds: number;
}

export async function fixtureStats(
  db: Db,
  competitionId: string,
  visible?: readonly FixtureStatus[],
): Promise<FixtureStats> {
  const scope = and(
    eq(fixtures.competitionId, competitionId),
    ...(visible === undefined ? [] : [inArray(fixtures.status, [...visible])]),
  );
  const [rows, [roundRow]] = await Promise.all([
    db
      .select({ status: fixtures.status, count: sql<number>`count(*)::int` })
      .from(fixtures)
      .where(scope)
      .groupBy(fixtures.status),
    db
      .select({ max: sql<number>`coalesce(max(${fixtures.round}), 0)::int` })
      .from(fixtures)
      .where(scope),
  ]);
  const stats: FixtureStats = {
    total: 0,
    draft: 0,
    scheduled: 0,
    published: 0,
    inProgress: 0,
    completed: 0,
    cancelled: 0,
    rounds: roundRow?.max ?? 0,
  };
  const keys: Record<FixtureStatus, keyof FixtureStats> = {
    draft: "draft",
    scheduled: "scheduled",
    published: "published",
    in_progress: "inProgress",
    completed: "completed",
    cancelled: "cancelled",
  };
  for (const row of rows) {
    stats[keys[row.status]] = row.count;
    stats.total += row.count;
  }
  return stats;
}

export type FixtureSort = "kickoff" | "kickoff_desc" | "number" | "round";

/**
 * The statuses a member without `fixture.manage` may see. A draft is an
 * organizer's unfinished thinking — half-slotted, wrong dates, teams still
 * moving — and `scheduled` is explicitly not yet the public record (the
 * lifecycle's own words: "Scheduled → Published: the schedule becomes the
 * public record"). Cancelled stays visible because a match that is off is news.
 */
export const PUBLIC_FIXTURE_STATUSES: readonly FixtureStatus[] = [
  "published",
  "in_progress",
  "completed",
  "cancelled",
];

export interface FixtureQuery {
  status?: FixtureStatus;
  /** Restrict to these statuses regardless of the filter (capability gate). */
  visible?: readonly FixtureStatus[];
  teamId?: string;
  groundId?: string;
  search?: string; // fixture number
  from?: string; // YYYY-MM-DD
  to?: string;
  sort?: FixtureSort;
  page: number;
  pageSize: number;
}

export interface FixturePage {
  rows: FixtureSnapshot[];
  total: number;
  page: number;
  pageSize: number;
}

const SORTS: Record<FixtureSort, SQL[]> = {
  // Kickoff is wall-clock text: lexicographic IS chronological. NULLs (unslotted
  // drafts) sort last via coalesce sentinel; seq is the stable tiebreak.
  kickoff: [sql`coalesce(${fixtures.kickoffAt}, '9999') asc`, asc(fixtures.seq)],
  kickoff_desc: [sql`coalesce(${fixtures.kickoffAt}, '9999') desc`, desc(fixtures.seq)],
  number: [asc(fixtures.seq)],
  round: [asc(fixtures.round), asc(fixtures.seq)],
};

/** Deterministic server-driven fixture list — never the whole dataset. */
export async function queryFixtures(
  db: Db,
  competitionId: string,
  query: FixtureQuery,
): Promise<FixturePage> {
  const filters: SQL[] = [eq(fixtures.competitionId, competitionId)];
  if (query.visible !== undefined) {
    filters.push(inArray(fixtures.status, [...query.visible]));
  }
  if (query.status !== undefined) {
    filters.push(eq(fixtures.status, query.status));
  }
  if (query.teamId !== undefined && query.teamId !== "") {
    const clause = sql`(${fixtures.homeTeamId} = ${query.teamId} or ${fixtures.awayTeamId} = ${query.teamId})`;
    filters.push(clause);
  }
  if (query.groundId !== undefined && query.groundId !== "") {
    filters.push(eq(fixtures.groundId, query.groundId));
  }
  const term = query.search?.trim();
  if (term !== undefined && term !== "") {
    filters.push(ilike(fixtures.fixtureNumber, `%${term}%`));
  }
  if (query.from !== undefined && query.from !== "") {
    filters.push(gte(fixtures.kickoffAt, query.from));
  }
  if (query.to !== undefined && query.to !== "") {
    filters.push(lte(fixtures.kickoffAt, `${query.to}T23:59`));
  }
  const where = and(...filters);
  const pageSize = Math.min(Math.max(query.pageSize, 1), 100);
  const page = Math.max(query.page, 1);

  const [countRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(fixtures)
    .where(where);
  const total = countRow?.count ?? 0;

  const rows = await snapshotQuery(db)
    .where(where)
    .orderBy(...SORTS[query.sort ?? "kickoff"])
    .limit(pageSize)
    .offset((page - 1) * pageSize);
  return { rows: rows.map(toSnapshot), total, page, pageSize };
}

export async function fixtureSnapshot(db: Db, fixtureId: string): Promise<FixtureSnapshot | null> {
  const [row] = await snapshotQuery(db).where(eq(fixtures.id, fixtureId)).limit(1);
  return row === undefined ? null : toSnapshot(row);
}

// --- Calendar / timeline / match-day (all server-driven) --------------------------

export interface CalendarDay {
  date: string; // YYYY-MM-DD
  fixtures: FixtureSnapshot[];
}

/** Fixtures with a kickoff inside [from, to] (dates inclusive), day-grouped. */
export async function calendarRange(
  db: Db,
  competitionId: string,
  from: string,
  to: string,
  visible?: readonly FixtureStatus[],
): Promise<CalendarDay[]> {
  const rows = await snapshotQuery(db)
    .where(
      and(
        eq(fixtures.competitionId, competitionId),
        gte(fixtures.kickoffAt, from),
        lte(fixtures.kickoffAt, `${to}T23:59`),
        ...(visible === undefined ? [] : [inArray(fixtures.status, [...visible])]),
      ),
    )
    .orderBy(asc(fixtures.kickoffAt), asc(fixtures.seq));
  const days = new Map<string, FixtureSnapshot[]>();
  for (const row of rows) {
    const date = (row.kickoffAt ?? "").slice(0, 10);
    const list = days.get(date) ?? [];
    list.push(toSnapshot(row));
    days.set(date, list);
  }
  return [...days.entries()].map(([date, dayFixtures]) => ({ date, fixtures: dayFixtures }));
}

/** A calendar week (7 days from `start`), every day present even when empty. */
export async function weekView(
  db: Db,
  competitionId: string,
  start: string,
  visible?: readonly FixtureStatus[],
): Promise<CalendarDay[]> {
  const end = addDays(start, 6);
  const filled = await calendarRange(db, competitionId, start, end, visible);
  const byDate = new Map(filled.map((d) => [d.date, d.fixtures]));
  return Array.from({ length: 7 }, (_, i) => {
    const date = addDays(start, i);
    return { date, fixtures: byDate.get(date) ?? [] };
  });
}

/** The competition timeline: every slotted fixture, kickoff order, one list. */
export async function competitionTimeline(
  db: Db,
  competitionId: string,
  visible?: readonly FixtureStatus[],
): Promise<FixtureSnapshot[]> {
  const rows = await snapshotQuery(db)
    .where(
      and(
        eq(fixtures.competitionId, competitionId),
        sql`${fixtures.kickoffAt} is not null`,
        ...(visible === undefined ? [] : [inArray(fixtures.status, [...visible])]),
      ),
    )
    .orderBy(asc(fixtures.kickoffAt), asc(fixtures.seq))
    .limit(1000);
  return rows.map(toSnapshot);
}

/** Upcoming fixtures from a given wall-clock instant (dashboard strip). */
export async function upcomingFixtures(
  db: Db,
  competitionId: string,
  fromKickoff: string,
  visible?: readonly FixtureStatus[],
  limit = 8,
): Promise<FixtureSnapshot[]> {
  const rows = await snapshotQuery(db)
    .where(
      and(
        eq(fixtures.competitionId, competitionId),
        gte(fixtures.kickoffAt, fromKickoff),
        sql`${fixtures.status} not in ('cancelled', 'completed')`,
        ...(visible === undefined ? [] : [inArray(fixtures.status, [...visible])]),
      ),
    )
    .orderBy(asc(fixtures.kickoffAt), asc(fixtures.seq))
    .limit(limit);
  return rows.map(toSnapshot);
}

export interface MatchDayGround {
  groundId: string | null;
  groundName: string;
  venueName: string;
  fixtures: FixtureSnapshot[];
}

/** Match-day dashboard: one date's fixtures, grouped by ground, kickoff order. */
export async function matchDay(
  db: Db,
  competitionId: string,
  date: string,
  visible?: readonly FixtureStatus[],
): Promise<MatchDayGround[]> {
  const days = await calendarRange(db, competitionId, date, date, visible);
  const dayFixtures = days[0]?.fixtures ?? [];
  const groupsByKey = new Map<string, MatchDayGround>();
  for (const fixture of dayFixtures) {
    const key = fixture.groundId ?? "unassigned";
    const group = groupsByKey.get(key) ?? {
      groundId: fixture.groundId,
      groundName: fixture.groundName ?? "Unassigned",
      venueName: fixture.venueName ?? "—",
      fixtures: [],
    };
    group.fixtures.push(fixture);
    groupsByKey.set(key, group);
  }
  return [...groupsByKey.values()];
}

export interface OrganizerFixture extends FixtureSnapshot {
  readonly competitionName: string;
  readonly competitionSlug: string;
}

/** The organizer schedule: upcoming fixtures across every org they belong to. */
export async function organizerSchedule(
  db: Db,
  personId: string,
  fromKickoff: string,
  limit = 10,
): Promise<OrganizerFixture[]> {
  const rows = await db
    .select({
      ...SNAPSHOT_COLUMNS,
      competitionName: competitions.name,
      competitionSlug: competitions.slug,
    })
    .from(fixtures)
    .innerJoin(
      orgMembers,
      and(eq(orgMembers.orgId, fixtures.orgId), eq(orgMembers.personId, personId)),
    )
    .innerJoin(competitions, eq(competitions.id, fixtures.competitionId))
    .leftJoin(homeTeams, eq(homeTeams.id, fixtures.homeTeamId))
    .leftJoin(awayTeams, eq(awayTeams.id, fixtures.awayTeamId))
    .leftJoin(grounds, eq(grounds.id, fixtures.groundId))
    .leftJoin(venues, eq(venues.id, grounds.venueId))
    .where(
      and(
        gte(fixtures.kickoffAt, fromKickoff),
        sql`${fixtures.status} not in ('cancelled', 'completed')`,
      ),
    )
    .orderBy(asc(fixtures.kickoffAt), asc(fixtures.seq))
    .limit(limit);
  return rows.map((row) => {
    const { competitionName, competitionSlug, ...rest } = row;
    return Object.freeze({ ...toSnapshot(rest), competitionName, competitionSlug });
  });
}

// --- Snapshot constituents + audit timeline ------------------------------------------

/**
 * Every fixture snapshot of a competition in seq order — the ScheduleSnapshot's
 * fixture list (see schedule-snapshot.ts, the canonical downstream read model).
 */
/**
 * The published schedule as the PUBLIC sees it, with an honest total.
 *
 * The public competition page used to ask `queryFixtures` for page 1 at a page
 * size of 100 and throw the total away. A season with 300 published fixtures
 * therefore showed 100 of them under a heading that said "Published schedule",
 * and the other 200 were invisible with nothing on the page admitting it —
 * spectators looking for a match in the back half of a league found no match
 * and concluded it was not scheduled.
 *
 * The bound stays, because this is an uncached public endpoint and an unbounded
 * scan is a denial-of-service invitation. What changes is that the bound is
 * high enough to hold a real season whole, and that the caller is told the
 * count so a truncated page can say so instead of lying by omission.
 */
export const PUBLIC_SCHEDULE_LIMIT = 500;

export async function publishedSchedule(
  db: Db,
  competitionId: string,
): Promise<{ rows: FixtureSnapshot[]; total: number }> {
  const where = and(eq(fixtures.competitionId, competitionId), eq(fixtures.status, "published"));
  const [countRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(fixtures)
    .where(where);
  const rows = await snapshotQuery(db)
    .where(where)
    .orderBy(...SORTS["kickoff"])
    .limit(PUBLIC_SCHEDULE_LIMIT);
  return { rows: rows.map(toSnapshot), total: countRow?.count ?? 0 };
}

export async function competitionFixtureSnapshots(
  db: Db,
  competitionId: string,
): Promise<FixtureSnapshot[]> {
  const rows = await snapshotQuery(db)
    .where(eq(fixtures.competitionId, competitionId))
    .orderBy(asc(fixtures.seq));
  return rows.map(toSnapshot);
}

export interface FixtureTimelineEntry {
  action: string;
  at: Date;
  meta: unknown;
}

/** A fixture's audit timeline (every transition + reschedule), oldest→newest. */
export async function fixtureTimeline(db: Db, fixtureId: string): Promise<FixtureTimelineEntry[]> {
  return db
    .select({ action: auditLog.action, at: auditLog.at, meta: auditLog.meta })
    .from(auditLog)
    .where(eq(auditLog.subject, fixtureId))
    .orderBy(asc(auditLog.at));
}

/**
 * Current wall-clock "YYYY-MM-DDTHH:MM" for an Indian tournament.
 *
 * `getFullYear`/`getHours` read the SERVER's zone. That is right on a laptop in
 * Asia/Calcutta and wrong on every UTC host we would deploy to: measured, the
 * same instant gave 2026-08-01T08:18 on the host and 2026-08-01T02:48 under
 * TZ=UTC, so between 00:00 and 05:29 IST match day opened on the PREVIOUS date
 * and the "Upcoming" cut-off sat five and a half hours in the past. Kickoffs are
 * IST wall clock (packages/core/src/fixture.ts), so "now" must be too — pinned
 * the way every other date in this product is (see lib/format-date.ts).
 */
const IST_WALL_CLOCK = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Kolkata",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

export function nowWallClock(now = new Date()): string {
  const parts = new Map<Intl.DateTimeFormatPartTypes, string>(
    IST_WALL_CLOCK.formatToParts(now).map((p) => [p.type, p.value]),
  );
  const get = (type: Intl.DateTimeFormatPartTypes): string => parts.get(type) ?? "00";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}
