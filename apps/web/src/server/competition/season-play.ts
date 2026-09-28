import { sportPackFor } from "@desiauction/core";
import type { Db } from "@desiauction/db";

import { istCalendarDate } from "../../lib/format-date";
import { teamsOf, type CompetitionSummary } from "./competitions";
import { PUBLIC_FIXTURE_STATUSES, competitionTimeline, fixtureStats } from "./fixtures";
import { resultsOf, standingsOf } from "./results";

/*
 * THE SEASON CHAPTER — the matches and the table, for the Reports page and
 * the public season page. Both used to stop at auction night; a season three
 * matches in had no word about its matches. Read from the same helpers the Schedule and Table tabs use, and
 * only the fixtures the public can see (published, live, completed), so a
 * reviewer's report never shows a draft schedule as if it were fixed.
 */

export interface SeasonMatchLine {
  fixtureId: string;
  kickoffAt: string | null;
  homeName: string | null;
  awayName: string | null;
  /** "home_win" | "away_win" | "tie" | "no_result" | "abandoned"; null while it is being played. */
  outcome: string | null;
  groundName: string | null;
}

export interface SeasonTableRow {
  teamId: string;
  name: string;
  color: string | null;
  played: number;
  won: number;
  lost: number;
  points: number;
}

export interface SeasonPlay {
  /** "lobby" seasons (battle royale) place squads per match; there is no home/away table here. */
  shape: "duel" | "lobby";
  played: number;
  live: number;
  toCome: number;
  /** Being played now. */
  liveMatches: SeasonMatchLine[];
  /** The latest results, newest first. */
  recent: SeasonMatchLine[];
  /** The next published matches from today, soonest first. */
  upcoming: SeasonMatchLine[];
  /** The table, in order; null for a lobby season. */
  table: SeasonTableRow[] | null;
}

export async function seasonPlayIn(
  db: Db,
  competition: Pick<CompetitionSummary, "id" | "sport">,
  today: string = istCalendarDate(),
): Promise<SeasonPlay> {
  const shape = sportPackFor(competition.sport).fixtureShape === "lobby" ? "lobby" : "duel";
  const [stats, timeline, results, standings, teamRows] = await Promise.all([
    fixtureStats(db, competition.id, PUBLIC_FIXTURE_STATUSES),
    competitionTimeline(db, competition.id, PUBLIC_FIXTURE_STATUSES),
    resultsOf(db, competition.id),
    shape === "duel" ? standingsOf(db, competition.id) : Promise.resolve(null),
    teamsOf(db, competition.id),
  ]);
  const line = (fixture: (typeof timeline)[number]): SeasonMatchLine => ({
    fixtureId: fixture.id,
    kickoffAt: fixture.kickoffAt,
    homeName: fixture.homeTeamName,
    awayName: fixture.awayTeamName,
    outcome: results.get(fixture.id)?.outcome ?? null,
    groundName: fixture.groundName,
  });
  const color = new Map(teamRows.map((team) => [team.id, team.primaryColor]));
  return {
    shape,
    played: stats.completed,
    live: stats.inProgress,
    toCome: stats.published,
    liveMatches: timeline.filter((fixture) => fixture.status === "in_progress").map(line),
    recent: timeline
      .filter((fixture) => fixture.status === "completed")
      .slice(-3)
      .reverse()
      .map(line),
    upcoming: timeline
      .filter(
        (fixture) =>
          fixture.status === "published" &&
          (fixture.kickoffAt === null || fixture.kickoffAt.slice(0, 10) >= today),
      )
      .slice(0, 3)
      .map(line),
    table:
      standings === null
        ? null
        : standings.rows.map((row) => ({
            teamId: row.teamId,
            name: row.teamName,
            color: color.get(row.teamId) ?? null,
            played: row.played,
            won: row.won,
            lost: row.lost,
            points: row.points,
          })),
  };
}
