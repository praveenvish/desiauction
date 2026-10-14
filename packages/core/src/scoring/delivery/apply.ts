import type { ApplyResult, MatchEvent } from "../types";
import type { MatchState } from "./state";
import { applyTransition } from "./transition";
import { replayMatch, ReplayError } from "./replay";

export function applyEvent(state: MatchState, event: MatchEvent): ApplyResult<MatchState> {
  if (event.attempt !== state.attempt) return { ok: false, reason: "wrong_attempt" };
  if (event.type !== "void" && event.type !== "amend" && event.type !== "restart")
    return applyTransition(state, event);
  try {
    return { ok: true, state: replayMatch([...state.eventHistory, event]) };
  } catch (error) {
    if (error instanceof ReplayError) return { ok: false, reason: error.reason };
    throw error;
  }
}
