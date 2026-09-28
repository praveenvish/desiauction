import { auditLog, newId, teams, type Db } from "@desiauction/db";
import { messageLanguagesOf } from "@desiauction/messaging/language";
import { and, desc, eq, sql } from "drizzle-orm";

import { env } from "../../env";
import { logSecurityEvent } from "../auth/security-events";
import { finaleMail, type FinaleRow } from "../messaging/finale-mail";
import { enqueueMail, kickDrain, type QueuedMail } from "../messaging/outbox";
import { organizersOf } from "../orgs/organizer-notify";
import { seasonOf, teamPeopleOf } from "./fixture-notify";
import { standingsOf } from "./results";

/**
 * THE CHAMPION (email programme PR12).
 *
 * ANNOUNCED, NOT DERIVED. A season stores no end and no winner, its results
 * can be amended after the last match, a tie at the top is broken only by an
 * arbitrary id, and a final may have been played off the app. So the season
 * never crowns anyone by itself: when every match is done, the organizer is
 * offered the top of the table and may pick another team, and pressing
 * Announce tells everyone — once.
 *
 * The announcement is the audit row `competition.champion_announced`
 * (subject: the season; meta: the team). The mails are keyed per person per
 * season, so nothing is ever sent twice.
 */

export const CHAMPION_ACTION = "competition.champion_announced";

const BASE = (): string => env.PUBLIC_BASE_URL.replace(/\/$/, "");

export interface FinaleState {
  /** Every fixture played or called off, and at least one played. */
  readonly matchesDone: boolean;
  /** The final table, in order. */
  readonly table: readonly FinaleRow[];
  /** The top two level on everything the table compares — the organizer must choose. */
  readonly tiedAtTop: boolean;
  readonly announced: {
    readonly teamId: string;
    readonly teamName: string;
    readonly at: Date;
  } | null;
}

async function matchesDone(db: Db, competitionId: string): Promise<boolean> {
  const [row] = await db.execute<{ open: number; played: number } & Record<string, unknown>>(sql`
    select
      count(*) filter (where status not in ('completed', 'cancelled'))::int as open,
      count(*) filter (where status = 'completed')::int as played
    from fixtures where competition_id = ${competitionId}
  `);
  return row !== undefined && row.open === 0 && row.played > 0;
}

export async function finaleState(db: Db, competitionId: string): Promise<FinaleState> {
  const [done, standings, [announcement]] = await Promise.all([
    matchesDone(db, competitionId),
    standingsOf(db, competitionId),
    db
      .select({ meta: auditLog.meta, at: auditLog.at })
      .from(auditLog)
      .where(and(eq(auditLog.subject, competitionId), eq(auditLog.action, CHAMPION_ACTION)))
      .orderBy(desc(auditLog.at))
      .limit(1),
  ]);
  const table: FinaleRow[] = standings.rows.map((row) => ({
    teamId: row.teamId.trim(),
    teamName: row.teamName,
    played: row.played,
    won: row.won,
    points: row.points,
  }));
  const [first, second] = standings.rows;
  const tiedAtTop =
    first !== undefined &&
    second !== undefined &&
    first.points === second.points &&
    first.won === second.won &&
    JSON.stringify(first.tiebreakers) === JSON.stringify(second.tiebreakers);
  const meta = (announcement?.meta ?? {}) as Record<string, unknown>;
  const teamId = typeof meta["teamId"] === "string" ? meta["teamId"] : null;
  return {
    matchesDone: done,
    table,
    tiedAtTop,
    announced:
      announcement === undefined || teamId === null
        ? null
        : {
            teamId,
            teamName:
              table.find((row) => row.teamId === teamId)?.teamName ??
              (typeof meta["teamName"] === "string" ? meta["teamName"] : ""),
            at: announcement.at,
          },
  };
}

export type AnnounceChampionResult =
  | { readonly ok: true; readonly told: number }
  | { readonly ok: false; readonly reason: "not_done" | "not_a_team" | "already" | "not_found" };

export async function announceChampion(
  db: Db,
  input: { competitionId: string; teamId: string; actorId: string },
  options: { outboxDb?: Db } = {},
): Promise<AnnounceChampionResult> {
  const season = await seasonOf(db, input.competitionId);
  if (season === null) return { ok: false, reason: "not_found" };
  const state = await finaleState(db, input.competitionId);
  if (state.announced !== null) return { ok: false, reason: "already" };
  if (!state.matchesDone) return { ok: false, reason: "not_done" };
  const [team] = await db
    .select({ id: teams.id, name: teams.name })
    .from(teams)
    .where(and(eq(teams.id, input.teamId), eq(teams.competitionId, input.competitionId)))
    .limit(1);
  if (team === undefined) return { ok: false, reason: "not_a_team" };
  const championId = team.id.trim();

  await db.insert(auditLog).values({
    id: newId(),
    actor: input.actorId,
    action: CHAMPION_ACTION,
    scopeType: "org",
    scopeId: season.orgId,
    subject: input.competitionId,
    meta: { teamId: championId, teamName: team.name },
  });

  const [people, organizers] = await Promise.all([
    teamPeopleOf(db, input.competitionId),
    organizersOf(db, season.orgId),
  ]);
  const slug = encodeURIComponent(season.seasonSlug);
  const publicTable = season.visibility === "public";
  const facts = {
    season: season.season.trim(),
    orgName: season.orgName.trim(),
    seasonSlug: season.seasonSlug,
    sport: season.sport,
    table: state.table,
    championId,
  };
  const recipients: { personId: string; name: string; teamId: string | null; owner: boolean }[] =
    organizers.map((personId) => ({ personId, name: "", teamId: null, owner: true }));
  const seen = new Set(organizers);
  for (const [teamId, members] of people) {
    for (const person of members) {
      if (seen.has(person.personId)) continue;
      seen.add(person.personId);
      recipients.push({
        personId: person.personId,
        name: person.name,
        teamId,
        owner: person.owner,
      });
    }
  }
  const everyone = recipients.map((r) => r.personId);
  const [languages, names] = await Promise.all([
    messageLanguagesOf(db, everyone),
    namesOf(db, organizers),
  ]);
  const mails: QueuedMail[] = [];
  for (const person of recipients) {
    const role =
      person.teamId === null ? "organizer" : person.teamId === championId ? "champion" : "team";
    // The table lives on the public page when the season is public, and on
    // the Table tab for club members; a private season's players get home.
    const url =
      role === "organizer"
        ? `${BASE()}/seasons/${slug}`
        : publicTable
          ? `${BASE()}/c/${slug}`
          : person.owner
            ? `${BASE()}/seasons/${slug}/standings`
            : `${BASE()}/home`;
    mails.push({
      ...(await finaleMail(
        {
          ...facts,
          name: person.teamId === null ? (names.get(person.personId) ?? "there") : person.name,
          role,
          teamId: person.teamId,
          url,
        },
        languages.get(person.personId) ?? "en",
      )),
      personId: person.personId,
      orgId: season.orgId,
      kind: "season.champion",
      dedupeKey: `season.champion:${input.competitionId}:${person.personId}`,
    });
  }
  const queued = await enqueueMail(mails, options.outboxDb);
  for (const person of recipients) {
    try {
      await logSecurityEvent(person.personId, "season.champion", {
        competitionId: input.competitionId,
        team: team.name,
      });
    } catch {
      // The mail is queued; one unwritable inbox row must not stop the rest.
    }
  }
  kickDrain();
  return { ok: true, told: queued.length };
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
