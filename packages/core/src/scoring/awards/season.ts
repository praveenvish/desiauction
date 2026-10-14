import type { PlayerLine, TrustLevel } from "../types";
import { roundPoint, type MatchScore } from "./cricket-v1";
import { compareId, fieldingPoints } from "./pick";

export interface SeasonMatch {
  fixtureId: string;
  trust: TrustLevel;
  completed: boolean;
  teamIds: readonly string[];
  formatKey: string;
  players: ReadonlyMap<string, PlayerLine>;
  scores: ReadonlyMap<string, MatchScore>;
  /** Caller projects keeper-only catches/stumpings and conceded byes. */
  keepers?: ReadonlyMap<string, { catches: number; stumpings: number; byes: number }>;
}
export interface QualifiedMetric {
  value: number | null;
  qualified: boolean;
  remaining: number;
}
export interface SeasonPlayer {
  registrationId: string;
  teamId: string;
  matches: number;
  teamMatches: number;
  points: number;
  perMatch: number;
  mvpEligible: boolean;
  runs: number;
  wickets: number;
  battingInnings: number;
  bowlingInnings: number;
  balls: number;
  bowlingBalls: number;
  dismissals: number;
  conceded: number;
  fieldingPoints: number;
  directRunOuts: number;
  keeperDismissals: number;
  keeperByes: number;
  strikeRate: QualifiedMetric;
  battingAverage: QualifiedMetric;
  economy: QualifiedMetric;
  bowlingAverage: QualifiedMetric;
}
function metric(
  numerator: number,
  denominator: number,
  count: number,
  minimum: number,
  factor = 1,
): QualifiedMetric {
  const value = denominator > 0 ? (numerator / denominator) * factor : null;
  return {
    value,
    qualified: count >= minimum && value !== null,
    remaining: Math.max(0, minimum - count),
  };
}
/** Inputs are completed fixture projections; repeated fixture IDs count only once. */
export function seasonPlayers(
  matches: readonly SeasonMatch[],
  options: { bestN?: number } = {},
): SeasonPlayer[] {
  if (options.bestN !== undefined && (!Number.isSafeInteger(options.bestN) || options.bestN < 1))
    throw new Error("bestN must be a positive integer");
  const totals = new Map<string, SeasonPlayer>();
  const teamMatches = new Map<string, number>();
  const pointLists = new Map<string, number[]>();
  const economyMinimum = new Map<string, number>();
  const seen = new Set<string>();
  for (const match of matches) {
    if (
      !match.completed ||
      (match.trust !== "verified" && match.trust !== "confirmed") ||
      seen.has(match.fixtureId)
    )
      continue;
    seen.add(match.fixtureId);
    for (const team of new Set(match.teamIds))
      teamMatches.set(team, (teamMatches.get(team) ?? 0) + 1);
    for (const [id, line] of match.players) {
      let row = totals.get(id);
      if (!row) {
        const unavailable = () => metric(0, 0, 0, 0);
        row = {
          registrationId: id,
          teamId: line.teamId,
          matches: 0,
          teamMatches: 0,
          points: 0,
          perMatch: 0,
          mvpEligible: false,
          runs: 0,
          wickets: 0,
          battingInnings: 0,
          bowlingInnings: 0,
          balls: 0,
          bowlingBalls: 0,
          dismissals: 0,
          conceded: 0,
          fieldingPoints: 0,
          directRunOuts: 0,
          keeperDismissals: 0,
          keeperByes: 0,
          strikeRate: unavailable(),
          battingAverage: unavailable(),
          economy: unavailable(),
          bowlingAverage: unavailable(),
        };
        totals.set(id, row);
      }
      row.matches++;
      const score = match.scores.get(id);
      const points = pointLists.get(id) ?? [];
      points.push(score?.points ?? 0);
      pointLists.set(id, points);
      row.fieldingPoints += fieldingPoints(score?.lines ?? []);
      row.directRunOuts += line.fielding?.runOutsDirect ?? 0;
      if (line.batting) {
        row.battingInnings++;
        row.runs += line.batting.runs;
        row.balls += line.batting.balls;
        row.dismissals += Number(line.batting.out);
      }
      if (line.bowling) {
        row.bowlingInnings++;
        row.wickets += line.bowling.wickets;
        row.bowlingBalls += line.bowling.legalBalls;
        row.conceded += line.bowling.runs;
      }
      const minimum = match.formatKey === "t20" || match.formatKey === "odi" ? 60 : 30;
      economyMinimum.set(id, Math.max(economyMinimum.get(id) ?? 0, minimum));
      const keeper = match.keepers?.get(id);
      row.keeperDismissals += (keeper?.catches ?? 0) + (keeper?.stumpings ?? 0);
      row.keeperByes += keeper?.byes ?? 0;
    }
  }
  for (const [id, row] of totals) {
    row.teamMatches = teamMatches.get(row.teamId) ?? 0;
    row.mvpEligible = row.teamMatches > 0 && row.matches * 2 >= row.teamMatches;
    row.points = roundPoint(
      (pointLists.get(id) ?? [])
        .sort((a, b) => b - a)
        .slice(0, options.bestN ?? Infinity)
        .reduce((sum, value) => sum + value, 0),
    );
    row.perMatch = row.matches ? roundPoint(row.points / row.matches) : 0;
    row.strikeRate = metric(row.runs, row.balls, row.balls, 60, 100);
    row.battingAverage = metric(row.runs, row.dismissals, row.battingInnings, 3);
    row.economy = metric(
      row.conceded,
      row.bowlingBalls,
      row.bowlingBalls,
      economyMinimum.get(id) ?? 60,
      6,
    );
    row.bowlingAverage = metric(row.conceded, row.wickets, row.bowlingInnings, 3);
  }
  return [...totals.values()].sort((a, b) => compareId(a.registrationId, b.registrationId));
}
function compareMetric(a: QualifiedMetric, b: QualifiedMetric, ascending = false): number {
  return (
    Number(b.qualified) - Number(a.qualified) ||
    (a.qualified && b.qualified && a.value !== null && b.value !== null
      ? ascending
        ? a.value - b.value
        : b.value - a.value
      : 0)
  );
}
export function pickSeasonAwards(
  players: readonly SeasonPlayer[],
  options: {
    emergingEligible?: ReadonlySet<string>;
    /** Counts must already be filtered to distinct completed verified/confirmed fixtures. */
    scorers?: readonly { personId: string; completedVerifiedMatches: number }[];
  } = {},
) {
  const pick = (
    eligible: (row: SeasonPlayer) => boolean,
    compare: (a: SeasonPlayer, b: SeasonPlayer) => number,
  ) =>
    [...players]
      .filter(eligible)
      .sort((a, b) => compare(a, b) || compareId(a.registrationId, b.registrationId))[0] ?? null;
  return {
    season_mvp: pick(
      (row) => row.mvpEligible,
      (a, b) => b.points - a.points,
    ),
    best_batter: pick(
      (row) => row.battingInnings > 0,
      (a, b) =>
        b.runs - a.runs ||
        compareMetric(a.strikeRate, b.strikeRate) ||
        compareMetric(a.battingAverage, b.battingAverage) ||
        a.battingInnings - b.battingInnings,
    ),
    best_bowler: pick(
      (row) => row.bowlingInnings > 0,
      (a, b) =>
        b.wickets - a.wickets ||
        compareMetric(a.economy, b.economy, true) ||
        compareMetric(a.bowlingAverage, b.bowlingAverage, true) ||
        a.bowlingBalls - b.bowlingBalls,
    ),
    best_fielder: pick(
      (row) => row.fieldingPoints > 0,
      (a, b) => b.fieldingPoints - a.fieldingPoints || b.directRunOuts - a.directRunOuts,
    ),
    best_keeper: pick(
      (row) => row.keeperDismissals > 0,
      (a, b) => b.keeperDismissals - a.keeperDismissals || a.keeperByes - b.keeperByes,
    ),
    emerging: pick(
      (row) => options.emergingEligible?.has(row.registrationId) ?? false,
      (a, b) => b.points - a.points,
    ),
    scorer_of_season:
      [...(options.scorers ?? [])]
        .filter((row) => row.completedVerifiedMatches > 0)
        .sort(
          (a, b) =>
            b.completedVerifiedMatches - a.completedVerifiedMatches ||
            compareId(a.personId, b.personId),
        )[0] ?? null,
  };
}
