import type { DerivedResult } from "../types";
import type { SeasonScoringRules } from "../season-rules";
import { completed, type RaidState } from "./state";
export function deriveRaidResult(state: RaidState): DerivedResult | null {
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
  if (!completed(state)) return null;
  const difference = state.points.home - state.points.away;
  return {
    outcome: difference > 0 ? "home_win" : difference < 0 ? "away_win" : "tie",
    winnerTeamId: difference ? state.teams[difference > 0 ? "home" : "away"] : null,
    marginText: difference ? `${String(Math.abs(difference))} points` : "Match tied",
    method: null,
  };
}
export function raidResultScore(
  state: RaidState,
  rules?: SeasonScoringRules,
): { home: Record<string, number>; away: Record<string, number> } {
  void rules;
  return { home: { points: state.points.home }, away: { points: state.points.away } };
}
