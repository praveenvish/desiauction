import type { Phase } from "../types";
import { currentInnings } from "./state";
import type { MatchState } from "./state";
import { resultOf } from "./outcomes";

export function phaseOf(state: MatchState): Phase {
  if (state.outcome) return state.outcome;
  if (state.finished) return "finished";
  if (resultOf(state)) return "result_reached";
  if (state.interrupted) return "interrupted";
  const innings = currentInnings(state);
  if (innings?.closed) return "innings_break";
  if (innings) return "live";
  return state.toss ? "toss" : "not_started";
}
