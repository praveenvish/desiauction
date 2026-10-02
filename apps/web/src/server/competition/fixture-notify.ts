import { competitions, messageOutbox, newId, organizations, type Db } from "@desiauction/db";
import { messageLanguagesOf } from "@desiauction/messaging/language";
import { and, eq, like, sql } from "drizzle-orm";

import { env } from "../../env";
import { logSecurityEvent } from "../auth/security-events";
import { fixtureChangedMail, scheduleMail, type MatchFacts } from "../messaging/fixture-mail";
import { enqueueMail, supersedePending, type QueuedMail } from "../messaging/outbox";
import { nowWallClock } from "./fixtures";

/**
 * TELLING A TEAM ABOUT ITS MATCHES (email programme PR11).
 *
 *   · THE SCHEDULE. When the organizer publishes fixtures, every player and
 *     owner of a team with a match in them hears the team's whole schedule to
 *     come. HELD ten minutes and REBUILT on every publish: an organizer who
 *     publishes in three sittings sends one mail listing all of it, and the
 *     list is the truth when it goes. The first mail says "your schedule is
 *     out"; a later one "more matches".
 *   · A CHANGE. A published match moved (the reschedule workflow — the only
 *     way one moves) or called off: both sides hear it, held ten minutes so a
 *     corrected time sends one mail. Somebody whose schedule mail is still
 *     waiting gets that rebuilt instead — it already shows the new time — so
 *     nobody hears "your schedule" and "your match moved" about one change.
 *
 * WHO is a team's: its approved registrations (players, captain and icons
 * included) and its owners — an accepted, unrevoked owner invite or an active
 * paddle grant on the season's auction. Someone who is both is told once.
 */

export const SETTLE_MS = 10 * 60 * 1000;

const BASE = (): string => env.PUBLIC_BASE_URL.replace(/\/$/, "");

export interface TeamPerson {
  readonly personId: string;
  readonly name: string;
  readonly teamId: string;
  readonly teamName: string;
  /** Their registration on this team — null for an owner who does not play. */
  readonly registrationId: string | null;
  /** An owner holds the Matches screen (org member); a player does not. */
  readonly owner: boolean;
}

const trim = (value: string | null | undefined): string => (value ?? "").trim();

/** Every team's people in this season, keyed by team. */
export async function teamPeopleOf(
  db: Db,
  competitionId: string,
): Promise<Map<string, TeamPerson[]>> {
  const rows = await db.execute<
    {
      person_id: string;
      name: string | null;
      team_id: string;
      team_name: string;
      registration_id: string | null;
      owner: boolean;
    } & Record<string, unknown>
  >(sql`
    select r.person_id, p.name, t.id as team_id, t.name as team_name,
      r.id as registration_id, false as owner
    from registrations r
    join people p on p.id = r.person_id
    join teams t on t.id = r.team_id
    where r.competition_id = ${competitionId} and r.status = 'approved' and r.team_id is not null
    union all
    select i.accepted_by, p.name, t.id, t.name, null, true
    from auction_owner_invites i
    join auctions a on a.id = i.auction_id and a.status <> 'abandoned' and a.kind = 'real'
    join people p on p.id = i.accepted_by
    join teams t on t.id = i.team_id
    where a.competition_id = ${competitionId} and i.accepted_by is not null and i.revoked_at is null
    union all
    select g.person_id, p.name, t.id, t.name, null, true
    from paddle_grants g
    join auctions a on a.id = g.auction_id and a.status <> 'abandoned' and a.kind = 'real'
    join people p on p.id = g.person_id
    join teams t on t.id = g.team_id
    where a.competition_id = ${competitionId} and g.revoked_at is null
  `);
  const byTeam = new Map<string, Map<string, TeamPerson>>();
  for (const row of rows) {
    const teamId = trim(row.team_id);
    const personId = trim(row.person_id);
    const team = byTeam.get(teamId) ?? new Map<string, TeamPerson>();
    const known = team.get(personId);
    team.set(personId, {
      personId,
      name: trim(row.name) || "there",
      teamId,
      teamName: row.team_name.trim(),
      registrationId:
        known?.registrationId ?? (row.registration_id === null ? null : trim(row.registration_id)),
      owner: (known?.owner ?? false) || row.owner,
    });
    byTeam.set(teamId, team);
  }
  return new Map([...byTeam].map(([teamId, people]) => [teamId, [...people.values()]]));
}

export interface MatchRow extends Record<string, unknown> {
  id: string;
  kickoff_at: string;
  status: string;
  ground_name: string | null;
  venue_name: string | null;
  venue_address: string | null;
  venue_city: string | null;
  home_id: string | null;
  home_name: string | null;
  home_color: string | null;
  away_id: string | null;
  away_name: string | null;
  away_color: string | null;
  squad_count: number;
  team_ids: string[] | null;
}

export interface MatchRecord extends MatchFacts {
  readonly status: string;
  /** Every team in it — the two sides, or a lobby's squads. */
  readonly teamIds: readonly string[];
  /** "Link Road, Malad West, Mumbai" — the venue's, when it has one. */
  readonly address: string | null;
}

export function toMatch(row: MatchRow): MatchRecord {
  const side = (id: string | null, name: string | null, color: string | null) =>
    id === null || name === null ? null : { id: trim(id), name: name.trim(), color };
  const home = side(row.home_id, row.home_name, row.home_color);
  const away = side(row.away_id, row.away_name, row.away_color);
  const address = [row.venue_address, row.venue_city]
    .map((part) => trim(part))
    .filter((part) => part !== "")
    .join(", ");
  return {
    id: trim(row.id),
    kickoffAt: row.kickoff_at,
    status: row.status,
    ground: trim(row.ground_name) || trim(row.venue_name) || null,
    home,
    away,
    squadCount: row.squad_count,
    teamIds: [
      ...new Set([
        ...(home === null ? [] : [home.id]),
        ...(away === null ? [] : [away.id]),
        ...(row.team_ids ?? []).map((id) => trim(id)),
      ]),
    ],
    address: address === "" ? null : address,
  };
}

/** The columns every match read shares. `where` is the caller's filter on `f`. */
export function matchesWhere(db: Db, where: ReturnType<typeof sql>): Promise<MatchRow[]> {
  return db.execute<MatchRow>(sql`
    select f.id, f.kickoff_at, f.status,
      g.name as ground_name, v.name as venue_name, v.address as venue_address, v.city as venue_city,
      f.home_team_id as home_id, h.name as home_name, h.primary_color as home_color,
      f.away_team_id as away_id, w.name as away_name, w.primary_color as away_color,
      (select count(*) from fixture_participants fp where fp.fixture_id = f.id)::int as squad_count,
      (select array_agg(fp.team_id) from fixture_participants fp where fp.fixture_id = f.id) as team_ids
    from fixtures f
    left join grounds g on g.id = f.ground_id
    left join venues v on v.id = g.venue_id
    left join teams h on h.id = f.home_team_id
    left join teams w on w.id = f.away_team_id
    where f.kickoff_at is not null and ${where}
    order by f.kickoff_at, f.seq
  `);
}

export interface SeasonRow {
  orgId: string;
  orgName: string;
  season: string;
  seasonSlug: string;
  sport: string;
  visibility: string;
}

export async function seasonOf(db: Db, competitionId: string): Promise<SeasonRow | null> {
  const [season] = await db
    .select({
      orgId: competitions.orgId,
      orgName: organizations.name,
      season: competitions.name,
      seasonSlug: competitions.slug,
      sport: competitions.sport,
      visibility: competitions.visibility,
    })
    .from(competitions)
    .innerJoin(organizations, eq(organizations.id, competitions.orgId))
    .where(eq(competitions.id, competitionId))
    .limit(1);
  return season ?? null;
}

/**
 * Where a person's button goes. An owner is a member of the club and has the
 * Matches screen; a player is not — they get the public season page when there
 * is one, or their own home (which lists their matches).
 */
export function matchesUrl(
  season: { seasonSlug: string; visibility: string },
  person: { owner: boolean },
  focus: { teamId?: string; matchId?: string; date?: string } = {},
): string {
  const slug = encodeURIComponent(season.seasonSlug);
  if (person.owner) {
    const query = new URLSearchParams({
      ...(focus.teamId === undefined ? {} : { team: focus.teamId }),
      ...(focus.matchId === undefined ? {} : { match: focus.matchId }),
      ...(focus.date === undefined ? {} : { date: focus.date }),
    }).toString();
    return `${BASE()}/seasons/${slug}/fixtures${query === "" ? "" : `?${query}`}`;
  }
  return season.visibility === "public" ? `${BASE()}/c/${slug}#schedule-heading` : `${BASE()}/home`;
}

const scheduleKeyPrefix = (competitionId: string, personId: string) =>
  `schedule.published:${competitionId}:${personId}:`;

/** People in this season with a schedule mail in the given state. */
async function scheduleMailPeople(
  db: Db,
  competitionId: string,
  status: "pending" | "sent",
): Promise<Set<string>> {
  const rows = await db
    .select({ key: messageOutbox.dedupeKey })
    .from(messageOutbox)
    .where(
      and(
        like(messageOutbox.dedupeKey, `schedule.published:${competitionId}:%`),
        eq(messageOutbox.status, status),
      ),
    );
  return new Set(rows.map((row) => row.key.split(":")[2] ?? ""));
}

/**
 * Queue (or rebuild) each affected person's schedule mail. `teamIds` limits it
 * to those teams; `onlyPeople` to those people (a rebuild after a change).
 */
export async function notifySchedulePublished(
  db: Db,
  input: {
    competitionId: string;
    teamIds?: readonly string[];
    onlyPeople?: ReadonlySet<string>;
  },
  options: { now?: Date; outboxDb?: Db } = {},
): Promise<{ queued: number }> {
  const now = options.now ?? new Date();
  const season = await seasonOf(db, input.competitionId);
  if (season === null) return { queued: 0 };
  const upcoming = (
    await matchesWhere(
      db,
      sql`f.competition_id = ${input.competitionId} and f.status = 'published' and f.kickoff_at > ${nowWallClock(now)}`,
    )
  ).map(toMatch);
  const people = await teamPeopleOf(db, input.competitionId);
  const told = await scheduleMailPeople(options.outboxDb ?? db, input.competitionId, "sent");
  const teams = input.teamIds ?? [...people.keys()];
  const recipients: { person: TeamPerson; matches: MatchRecord[] }[] = [];
  const seen = new Set<string>();
  for (const teamId of teams) {
    const matches = upcoming.filter((match) => match.teamIds.includes(teamId));
    if (matches.length === 0) continue;
    for (const person of people.get(teamId) ?? []) {
      if (seen.has(person.personId)) continue;
      if (input.onlyPeople !== undefined && !input.onlyPeople.has(person.personId)) continue;
      seen.add(person.personId);
      recipients.push({ person, matches });
    }
  }
  if (recipients.length === 0) return { queued: 0 };
  const languages = await messageLanguagesOf(
    db,
    recipients.map((r) => r.person.personId),
  );
  const notBefore = new Date(now.getTime() + SETTLE_MS);
  const stamp = newId();
  const mails: QueuedMail[] = [];
  for (const { person, matches } of recipients) {
    const prefix = scheduleKeyPrefix(input.competitionId, person.personId);
    await supersedePending(prefix, options.outboxDb);
    mails.push({
      ...(await scheduleMail(
        {
          name: person.name,
          season: season.season.trim(),
          orgName: season.orgName.trim(),
          seasonSlug: season.seasonSlug,
          sport: season.sport,
          teamId: person.teamId,
          teamName: person.teamName,
          matches,
          variant: told.has(person.personId) ? "updated" : "first",
          url: matchesUrl(season, person, { teamId: person.teamId }),
        },
        languages.get(person.personId) ?? "en",
      )),
      personId: person.personId,
      orgId: season.orgId,
      kind: "schedule.published",
      dedupeKey: `${prefix}${stamp}`,
      notBefore,
    });
  }
  return { queued: (await enqueueMail(mails, options.outboxDb)).length };
}

export interface FixtureChange {
  readonly competitionId: string;
  readonly fixtureId: string;
  readonly change: "moved" | "cancelled";
  readonly previousKickoff: string;
  readonly previousGround: string | null;
  readonly reason: string | null;
}

export async function notifyFixtureChanged(
  db: Db,
  input: FixtureChange,
  options: { now?: Date; outboxDb?: Db } = {},
): Promise<{ queued: number; rebuilt: number }> {
  const now = options.now ?? new Date();
  const season = await seasonOf(db, input.competitionId);
  const [row] = await matchesWhere(db, sql`f.id = ${input.fixtureId}`);
  if (season === null || row === undefined) return { queued: 0, rebuilt: 0 };
  const match = toMatch(row);
  const people = await teamPeopleOf(db, input.competitionId);
  // Whoever is still waiting for their schedule gets it rebuilt instead.
  const waiting = await scheduleMailPeople(options.outboxDb ?? db, input.competitionId, "pending");
  const rebuilt =
    waiting.size === 0
      ? 0
      : (
          await notifySchedulePublished(
            db,
            { competitionId: input.competitionId, onlyPeople: waiting },
            options,
          )
        ).queued;
  const recipients: TeamPerson[] = [];
  const seen = new Set<string>(waiting);
  for (const teamId of match.teamIds) {
    for (const person of people.get(teamId) ?? []) {
      if (seen.has(person.personId)) continue;
      seen.add(person.personId);
      recipients.push(person);
    }
  }
  if (recipients.length === 0) return { queued: 0, rebuilt };
  const languages = await messageLanguagesOf(
    db,
    recipients.map((person) => person.personId),
  );
  const notBefore = new Date(now.getTime() + SETTLE_MS);
  const stamp = newId();
  const prefix = `fixture.changed:${input.fixtureId}:`;
  await supersedePending(prefix, options.outboxDb);
  const mails: QueuedMail[] = await Promise.all(
    recipients.map(async (person) => ({
      ...(await fixtureChangedMail(
        {
          name: person.name,
          season: season.season.trim(),
          orgName: season.orgName.trim(),
          seasonSlug: season.seasonSlug,
          sport: season.sport,
          teamName: person.teamName,
          change: input.change,
          match,
          previousKickoff: input.previousKickoff,
          previousGround: input.previousGround,
          reason: input.reason,
          url: matchesUrl(
            season,
            person,
            input.change === "moved" ? { matchId: match.id } : { teamId: person.teamId },
          ),
        },
        languages.get(person.personId) ?? "en",
      )),
      personId: person.personId,
      orgId: season.orgId,
      kind: "fixture.changed" as const,
      dedupeKey: `${prefix}${stamp}:${person.personId}`,
      notBefore,
    })),
  );
  const queued = await enqueueMail(mails, options.outboxDb);
  for (const person of recipients) {
    try {
      await logSecurityEvent(person.personId, "fixture.changed", {
        competitionId: input.competitionId,
        team: person.teamName,
        change: input.change,
        kickoffAt: input.change === "moved" ? match.kickoffAt : input.previousKickoff,
      });
    } catch {
      // The mail is queued; one unwritable inbox row must not stop the rest.
    }
  }
  return { queued: queued.length, rebuilt };
}
