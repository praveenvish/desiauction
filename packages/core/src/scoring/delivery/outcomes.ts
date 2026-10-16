import type { DerivedResult } from "../types";
import type { InningsState, MatchState } from "./state";

function winner(
  state: MatchState,
  winnerTeamId: string,
  marginText: string,
  method: DerivedResult["method"],
): DerivedResult {
  return {
    outcome: winnerTeamId === state.teams?.home ? "home_win" : "away_win",
    winnerTeamId,
    marginText,
    method,
  };
}
function boundaryCount(innings: readonly InningsState[], teamId: string): number {
  return innings
    .filter((innings) => innings.battingTeamId === teamId)
    .flatMap((innings) => innings.overs)
    .flatMap((over) => over.balls)
    .filter((ball) => ball.boundary !== undefined).length;
}

/** Internal result calculation; the public result helpers arrive in C07. */
export function resultOf(state: MatchState): DerivedResult | null {
  if (state.outcome === "void") return null;
  if (state.outcome === "no_result" || state.outcome === "abandoned")
    return { outcome: state.outcome, winnerTeamId: null, marginText: "", method: null };
  if (state.outcome === "walkover" && state.walkoverWinner)
    return winner(state, state.walkoverWinner, "by walkover", "walkover");
  const format = state.format;
  if (!state.teams || !format || state.pendingSuperOver.length > 0) return null;
  const normal = state.innings.filter((innings) => !innings.superOver);
  if (normal.length < format.innings * 2 || normal.some((innings) => !innings.closed)) return null;
  const first = normal[normal.length - 2];
  const chase = normal[normal.length - 1];
  if (!first || !chase) return null;
  const target = chase.target ?? first.runs + 1;
  const method =
    chase.targetMethod === "dls" ? "dls" : chase.targetMethod === "manual" ? "manual_target" : null;
  if (chase.runs >= target)
    return winner(
      state,
      chase.battingTeamId,
      `by ${String(format.wicketsPerInnings - chase.wickets)} wickets`,
      method,
    );
  if (chase.runs < target - 1)
    return winner(state, first.battingTeamId, `by ${String(target - 1 - chase.runs)} runs`, method);
  const superOvers = state.innings.filter((innings) => innings.superOver);
  if (superOvers.length > 0) {
    if (superOvers.length % 2 !== 0 || superOvers.some((innings) => !innings.closed)) return null;
    const superFirst = superOvers[superOvers.length - 2];
    const superChase = superOvers[superOvers.length - 1];
    if (!superFirst || !superChase) return null;
    if (superFirst.runs !== superChase.runs)
      return winner(
        state,
        superFirst.runs > superChase.runs ? superFirst.battingTeamId : superChase.battingTeamId,
        "on super over",
        "super_over",
      );
    if (state.superOverTie === "boundary_count") {
      const home = boundaryCount(state.innings, state.teams.home);
      const away = boundaryCount(state.innings, state.teams.away);
      if (home !== away)
        return winner(
          state,
          home > away ? state.teams.home : state.teams.away,
          "on super over",
          "super_over",
        );
    }
  }
  return { outcome: "tie", winnerTeamId: null, marginText: "Match tied", method: null };
}
