import type { SeasonScoringRules } from "../season-rules";
import type { InningsState, MatchState } from "./state";

export interface ResultScore {
  runs: number;
  wickets: number;
  balls: number;
  nrr_runs: number;
  nrr_balls: number;
}

/**
 * Net run rate inputs, following the ICC playing conditions:
 *
 * - A side bowled out, or left with no batter able to come in, is charged its
 *   full quota of overs (when the season uses that rule). A winning chase is
 *   charged only the balls it faced.
 * - In a match with a revised target (manual or DLS), the side that batted
 *   first is credited with (target − 1) runs off the chasing side's allotted
 *   balls, and the chasing side keeps its own runs and balls.
 *
 * Super overs never count.
 */
export function scoreForResult(
  state: MatchState,
  rules: SeasonScoringRules,
): { home: ResultScore; away: ResultScore } {
  const main = state.innings.filter((i) => !i.superOver);
  const revisedChase = main.find((i, index) => index > 0 && i.targetMethod !== null);
  const firstInnings = revisedChase ? main[main.indexOf(revisedChase) - 1] : undefined;

  function quotaCharged(i: InningsState): boolean {
    return (
      rules.allOutUsesQuota &&
      (i.closed === "all_out" || i.closed === "no_more_batters") &&
      i.maxBalls !== null
    );
  }

  function side(teamId: string | undefined): ResultScore {
    return main
      .filter((i) => i.battingTeamId === teamId)
      .reduce<ResultScore>(
        (score, i) => {
          const credited =
            i === firstInnings && revisedChase && revisedChase.target !== null
              ? {
                  runs: revisedChase.target - 1,
                  balls: revisedChase.maxBalls ?? revisedChase.legalBalls,
                }
              : {
                  runs: i.runs,
                  balls: quotaCharged(i) ? (i.maxBalls ?? i.legalBalls) : i.legalBalls,
                };
          return {
            runs: score.runs + i.runs,
            wickets: score.wickets + i.wickets,
            balls: score.balls + i.legalBalls,
            nrr_runs: score.nrr_runs + credited.runs,
            nrr_balls: score.nrr_balls + credited.balls,
          };
        },
        { runs: 0, wickets: 0, balls: 0, nrr_runs: 0, nrr_balls: 0 },
      );
  }
  return { home: side(state.teams?.home), away: side(state.teams?.away) };
}
