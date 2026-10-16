import {
  parseSeasonScoringRules,
  seasonPlayers,
  type Conditions,
  type PlayerLine,
  type TrustLevel,
} from "@desiauction/core/scoring";
import {
  competitions,
  fixtures,
  fixtureResults,
  matches,
  matchLiveState,
  matchPlayerLines,
  matchAwards,
  registrations,
  teams,
  type Db,
} from "@desiauction/db";
import { publicName } from "../scoring/public-name";
import { matchAgeDate } from "../scoring/live-state";
import { alias } from "drizzle-orm/pg-core";
import { and, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";

export type CareerScope =
  { kind: "self"; personId: string } | { kind: "public"; personId: string; orgId: string };
export interface CareerPerformance {
  fixtureId: string;
  registrationId: string;
  opponent: string | null;
  format: string;
  ball: string;
  trust: TrustLevel;
  date: string;
  label: string;
  href: string;
  line: PlayerLine;
}
export function careerGroup(format: string): string {
  return format.startsWith("box_") ? "box" : format;
}
export function aggregateCareer(rows: readonly CareerPerformance[]) {
  const groups = new Map<string, CareerPerformance[]>();
  for (const row of rows) {
    for (const key of new Set(["all", `format:${careerGroup(row.format)}`, `ball:${row.ball}`])) {
      groups.set(key, [...(groups.get(key) ?? []), row]);
    }
  }
  if (!groups.has("all")) groups.set("all", []);
  return [...groups].map(([key, performances]) => {
    const batting = performances.flatMap((row) => (row.line.batting ? [row.line.batting] : []));
    const bowling = performances.flatMap((row) => (row.line.bowling ? [row.line.bowling] : []));
    const runs = batting.reduce((sum, row) => sum + row.runs, 0);
    const balls = batting.reduce((sum, row) => sum + row.balls, 0);
    const outs = batting.filter((row) => row.out).length;
    const conceded = bowling.reduce((sum, row) => sum + row.runs, 0);
    const legalBalls = bowling.reduce((sum, row) => sum + row.legalBalls, 0);
    const qualified = seasonPlayers(
      performances.map((row) => ({
        fixtureId: row.fixtureId,
        trust: row.trust,
        completed: true,
        teamIds: [row.line.teamId],
        formatKey: row.format,
        players: new Map([["career-player", { ...row.line, registrationId: "career-player" }]]),
        scores: new Map(),
      })),
    )[0];
    return {
      key,
      matches: performances.length,
      runs,
      balls,
      average: outs ? runs / outs : null,
      strikeRate: balls ? (runs * 100) / balls : null,
      best:
        [...batting].sort((a, b) => b.runs - a.runs || Number(b.notOut) - Number(a.notOut))[0] ??
        null,
      fifties: batting.filter((row) => row.runs >= 50 && row.runs < 100).length,
      sixes: batting.reduce((sum, row) => sum + row.sixes, 0),
      wickets: bowling.reduce((sum, row) => sum + row.wickets, 0),
      economy: legalBalls ? (conceded * 6) / legalBalls : null,
      bowlingBest: [...bowling].sort((a, b) => b.wickets - a.wickets || a.runs - b.runs)[0] ?? null,
      trusted: qualified
        ? {
            matches: qualified.matches,
            balls: qualified.balls,
            bowlingBalls: qualified.bowlingBalls,
            strikeRate: qualified.strikeRate,
            average: qualified.battingAverage,
            economy: qualified.economy,
            bowlingAverage: qualified.bowlingAverage,
          }
        : null,
      lastFive: performances
        .flatMap((row) =>
          row.line.batting ? [{ fixtureId: row.fixtureId, batting: row.line.batting }] : [],
        )
        .slice(0, 5),
    };
  });
}
export function careerProjectionEligible(
  trust: TrustLevel,
  updatedAt: Date | null,
  rules: unknown,
  now: Date,
): boolean {
  if (!updatedAt) return false;
  const delay = trust === "verified" ? 0 : parseSeasonScoringRules(rules).publicDelaySeconds;
  return updatedAt.getTime() <= now.getTime() - delay * 1000;
}
/** Explicit reader and audience; no implicit elevated pool or cross-club publication. */
export async function cricketCareerFor(db: Db, scope: CareerScope, now = new Date()) {
  const home = alias(teams, "career_home");
  const away = alias(teams, "career_away");
  const rows = await db
    .select({
      fixtureId: fixtures.id,
      registrationId: registrations.id,
      dateOfBirth: registrations.dateOfBirth,
      kickoffAt: fixtures.kickoffAt,
      startedAt: matches.startedAt,
      opponent: sql<
        string | null
      >`CASE WHEN ${matchPlayerLines.teamId} = ${fixtures.homeTeamId} THEN ${away.name} WHEN ${matchPlayerLines.teamId} = ${fixtures.awayTeamId} THEN ${home.name} ELSE NULL END`,
      format: matchPlayerLines.formatKey,
      conditions: matchPlayerLines.conditions,
      stats: matchPlayerLines.stats,
      trust: matches.trustLevel,
      date: matches.finishedAt,
      label: fixtures.fixtureNumber,
      slug: competitions.slug,
      updatedAt: matchLiveState.updatedAt,
      rules: competitions.scoringRules,
    })
    .from(matchPlayerLines)
    .innerJoin(
      registrations,
      and(
        eq(registrations.id, matchPlayerLines.registrationId),
        eq(registrations.orgId, matchPlayerLines.orgId),
        eq(registrations.competitionId, matchPlayerLines.competitionId),
      ),
    )
    .innerJoin(
      fixtures,
      and(
        eq(fixtures.id, matchPlayerLines.fixtureId),
        eq(fixtures.orgId, matchPlayerLines.orgId),
        eq(fixtures.competitionId, matchPlayerLines.competitionId),
      ),
    )
    .leftJoin(
      home,
      and(
        eq(home.id, fixtures.homeTeamId),
        eq(home.orgId, fixtures.orgId),
        eq(home.competitionId, fixtures.competitionId),
      ),
    )
    .leftJoin(
      away,
      and(
        eq(away.id, fixtures.awayTeamId),
        eq(away.orgId, fixtures.orgId),
        eq(away.competitionId, fixtures.competitionId),
      ),
    )
    .innerJoin(
      competitions,
      and(eq(competitions.id, fixtures.competitionId), eq(competitions.orgId, fixtures.orgId)),
    )
    .innerJoin(
      matches,
      and(
        eq(matches.fixtureId, fixtures.id),
        eq(matches.orgId, fixtures.orgId),
        eq(matches.competitionId, fixtures.competitionId),
      ),
    )
    .innerJoin(
      fixtureResults,
      and(
        eq(fixtureResults.fixtureId, fixtures.id),
        eq(fixtureResults.orgId, fixtures.orgId),
        eq(fixtureResults.competitionId, fixtures.competitionId),
      ),
    )
    .leftJoin(
      matchLiveState,
      and(
        eq(matchLiveState.fixtureId, fixtures.id),
        eq(matchLiveState.orgId, fixtures.orgId),
        eq(matchLiveState.competitionId, fixtures.competitionId),
        eq(matchLiveState.seq, matches.lastSeq),
      ),
    )
    .where(
      and(
        eq(registrations.personId, scope.personId),
        eq(matchPlayerLines.sport, "cricket"),
        eq(competitions.sport, "cricket"),
        eq(fixtures.status, "completed"),
        eq(fixtureResults.source, "scored"),
        inArray(matches.phase, ["finished", "final", "no_result", "abandoned", "walkover"]),
        isNotNull(matches.finishedAt),
        scope.kind === "public"
          ? and(
              eq(competitions.orgId, scope.orgId),
              eq(competitions.visibility, "public"),
              eq(registrations.status, "approved"),
              isNotNull(fixtures.publishedAt),
            )
          : undefined,
      ),
    )
    .orderBy(desc(matches.finishedAt), desc(fixtures.id));
  const eligible = rows.filter(
    (row) =>
      scope.kind === "self" ||
      (row.startedAt !== null &&
        !publicName({ name: null }, row, matchAgeDate(row.kickoffAt, row.startedAt)).minor &&
        careerProjectionEligible(row.trust, row.updatedAt, row.rules, now)),
  );
  const performances: CareerPerformance[] = eligible.map((row) => ({
    fixtureId: row.fixtureId,
    registrationId: row.registrationId,
    opponent: row.opponent,
    format: row.format,
    ball: (row.conditions as Conditions).ball?.type ?? "unspecified",
    trust: row.trust,
    date: row.date?.toISOString() ?? "",
    label: row.label,
    href: `/c/${row.slug}/m/${encodeURIComponent(row.label)}`,
    line: row.stats as PlayerLine,
  }));
  const awardRows = eligible.length
    ? await db
        .select()
        .from(matchAwards)
        .where(
          and(
            eq(matchAwards.scope, "match"),
            inArray(
              matchAwards.fixtureId,
              eligible.map((row) => row.fixtureId),
            ),
            scope.kind === "public" ? eq(matchAwards.orgId, scope.orgId) : undefined,
          ),
        )
        .orderBy(desc(matchAwards.createdAt), desc(matchAwards.id))
    : [];
  const seen = new Set<string>();
  const awards: Record<string, number> = {};
  for (const award of awardRows) {
    const key = `${award.fixtureId ?? ""}:${award.kind}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (
      eligible.some(
        (row) =>
          row.fixtureId === award.fixtureId && row.registrationId === award.winnerRegistrationId,
      )
    )
      awards[award.kind] = (awards[award.kind] ?? 0) + 1;
  }
  return {
    groups: aggregateCareer(performances),
    awards,
    recent: performances.slice(0, 10).map((row) => ({
      fixtureId: row.fixtureId,
      opponent: row.opponent,
      format: row.format,
      ball: row.ball,
      trust: row.trust,
      date: row.date,
      label: row.label,
      href: row.href,
      batting: row.line.batting ?? null,
      bowling: row.line.bowling ?? null,
    })),
  };
}
export type CricketCareer = Awaited<ReturnType<typeof cricketCareerFor>>;
