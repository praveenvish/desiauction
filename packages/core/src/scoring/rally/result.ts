import type { DerivedResult } from "../types";
import { fixtureWinner, rubberWins, type RallyState } from "./state";
import type { SeasonScoringRules } from "../season-rules";
export function deriveRallyResult(state: RallyState): DerivedResult | null {
  if (state.terminal === "void") return null;
  if (state.terminal === "abandoned" || state.terminal === "no_result")
    return {
      outcome: state.terminal,
      winnerTeamId: null,
      marginText: state.terminal === "abandoned" ? "Match abandoned" : "No result",
      method: null,
    };
  if (!state.teams) return null;
  const winner =
    state.terminal === "walkover"
      ? state.walkoverWinner === state.teams.home
        ? "home"
        : "away"
      : fixtureWinner(state);
  if (!winner) return null;
  const score = rallyResultScore(state),
    wins = rubberWins(state);
  const marginText =
    state.terminal === "walkover"
      ? "Walkover"
      : state.format?.key === "volleyball_bo5"
        ? `${String(score.home["sets"])}–${String(score.away["sets"])} sets`
        : `${String(wins.home)}–${String(wins.away)} rubbers`;
  return {
    outcome: winner === "home" ? "home_win" : "away_win",
    winnerTeamId: state.teams[winner],
    marginText,
    method: state.terminal === "walkover" ? "walkover" : null,
  };
}
export function rallyResultScore(
  state: RallyState,
  rules?: SeasonScoringRules,
): { home: Record<string, number>; away: Record<string, number> } {
  void rules; // Rally score fields do not use cricket NRR rules.
  const wins = rubberWins(state),
    games = state.rubbers.flatMap((r) => r.games),
    volleyball = state.format?.key === "volleyball_bo5";
  const side = (key: "home" | "away") =>
    volleyball
      ? {
          sets: games.filter((g) => g.winner === key).length,
          points: games.reduce((sum, g) => sum + g.points[key], 0),
        }
      : { rubbers: wins[key], games: games.filter((g) => g.winner === key).length };
  return { home: side("home"), away: side("away") };
}
