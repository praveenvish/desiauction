import { integer } from "../validate-primitives";
import { raidTransition } from "./transition";
import type { ApplyResult, MatchEvent } from "../types";
import { ReplayError } from "../replay-error";
import type { RaidState } from "./state";
import { replayRaid } from "./replay";
export function applyRaid(state: RaidState, event: MatchEvent): ApplyResult<RaidState> {
  const stamp = Date.parse(event.clientRecordedAt);
  if (
    !integer(event.v, 1, 1) ||
    !integer(event.seq, 1) ||
    event.seq <= state.lastSeq ||
    !Number.isFinite(stamp) ||
    (state.lastEventAt !== null && stamp < Date.parse(state.lastEventAt))
  )
    return { ok: false, reason: "bad_payload" };
  if (state.eventHistory.some((entry) => entry.eventId === event.eventId))
    return { ok: false, reason: "duplicate" };
  if (event.type !== "void" && event.type !== "amend" && event.targetEventId !== null)
    return { ok: false, reason: "bad_payload" };
  if (event.type !== "void" && event.type !== "amend" && event.type !== "restart")
    return raidTransition(state, event);
  try {
    return { ok: true, state: replayRaid([...state.eventHistory, event]) };
  } catch (error) {
    if (error instanceof ReplayError) return { ok: false, reason: error.reason };
    throw error;
  }
}
