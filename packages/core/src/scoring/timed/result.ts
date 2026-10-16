import type { DerivedResult } from "../types";
import type { SeasonScoringRules } from "../season-rules";
import { timedCompleted, type TimedState } from "./state";
import { timedSport } from "./formats";
export function deriveTimedResult(state: TimedState): DerivedResult | null {
  if (state.terminal === "void") return null;
  if (state.terminal === "no_result" || state.terminal === "abandoned")
    return {
      outcome: state.terminal,
      winnerTeamId: null,
      marginText: state.terminal === "abandoned" ? "Match abandoned" : "No result",
      method: null,
    };
  if (!state.teams) return null;
  if (state.terminal === "walkover")
    return {
      outcome: state.walkoverWinner === state.teams.home ? "home_win" : "away_win",
      winnerTeamId: state.walkoverWinner,
      marginText: "Walkover",
      method: "walkover",
    };
  if (!timedCompleted(state)) return null;
  if (state.shootout) {
    const winner = state.shootout.winner;
    return winner
      ? {
          outcome: winner === "home" ? "home_win" : "away_win",
          winnerTeamId: state.teams[winner],
          marginText: `${String(state.shootout.points.home)}–${String(state.shootout.points.away)} on penalties`,
          method: "penalties",
        }
      : null;
  }
  const diff = state.points.home - state.points.away;
  return {
    outcome: diff > 0 ? "home_win" : diff < 0 ? "away_win" : "tie",
    winnerTeamId: diff ? state.teams[diff > 0 ? "home" : "away"] : null,
    marginText: diff
      ? `${String(Math.abs(diff))} ${state.format && timedSport(state.format) === "basketball" ? "points" : "goals"}`
      : "Match tied",
    method: null,
  };
}
export function timedResultScore(
  state: TimedState,
  rules?: SeasonScoringRules,
): { home: Record<string, number>; away: Record<string, number> } {
  void rules;
  const key = state.format && timedSport(state.format) === "basketball" ? "points" : "goals";
  return { home: { [key]: state.points.home }, away: { [key]: state.points.away } };
}
