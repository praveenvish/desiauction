import type { SeasonScoringRules } from "../season-rules";
import type { MatchState } from "./state";

export interface ResultScore {
  runs: number;
  wickets: number;
  balls: number;
  nrr_balls: number;
}
export function scoreForResult(
  state: MatchState,
  rules: SeasonScoringRules,
): { home: ResultScore; away: ResultScore } {
  function side(teamId: string | undefined): ResultScore {
    return state.innings
      .filter((i) => !i.superOver && i.battingTeamId === teamId)
      .reduce<ResultScore>(
        (score, i) => ({
          runs: score.runs + i.runs,
          wickets: score.wickets + i.wickets,
          balls: score.balls + i.legalBalls,
          nrr_balls:
            score.nrr_balls +
            (i.targetMethod !== null || (i.closed === "all_out" && rules.allOutUsesQuota)
              ? (i.maxBalls ?? i.legalBalls)
              : i.legalBalls),
        }),
        { runs: 0, wickets: 0, balls: 0, nrr_balls: 0 },
      );
  }
  return { home: side(state.teams?.home), away: side(state.teams?.away) };
}
