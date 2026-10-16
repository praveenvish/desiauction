import type { ApplyResult, MatchEvent } from "../types";
import { ReplayError } from "../replay-error";
import { integer } from "../validate-primitives";
import type { RallyState } from "./state";
import { replayRally } from "./replay";
import { rallyTransition } from "./transition";
export function applyRally(state: RallyState, event: MatchEvent): ApplyResult<RallyState> {
  if (!integer(event.v, 1, 1) || !integer(event.seq, 1) || event.seq <= state.lastSeq)
    return { ok: false, reason: "bad_payload" };
  if (event.type !== "void" && event.type !== "amend" && event.targetEventId !== null)
    return { ok: false, reason: "bad_payload" };
  if (state.eventHistory.some((previous) => previous.eventId === event.eventId))
    return { ok: false, reason: "duplicate" };
  if (event.type !== "void" && event.type !== "amend" && event.type !== "restart")
    return rallyTransition(state, event);
  try {
    return { ok: true, state: replayRally([...state.eventHistory, event]) };
  } catch (error) {
    if (error instanceof ReplayError) return { ok: false, reason: error.reason };
    throw error;
  }
}
