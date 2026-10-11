import type { FamilyEngine } from "../family";
import type { PlayerLine } from "../types";
import { initialTimedState, type TimedState } from "./state";
import { applyTimed } from "./apply";
import { replayTimed } from "./replay";
import { timedNextActions } from "./next-actions";
import { deriveTimedResult, timedResultScore } from "./result";
import { timedPublicLiveState, type TimedPanel } from "./public-state";
export function timedPlayerLines(state: TimedState): Map<string, PlayerLine> {
  return new Map(
    Object.entries(state.participants).map(([registrationId, entry]) => [
      registrationId,
      { registrationId, teamId: entry.teamId, appeared: true, timed: structuredClone(entry.stats) },
    ]),
  );
}
export const timedEngine = {
  family: "timed" as const,
  initialState: initialTimedState,
  apply: applyTimed,
  replay: replayTimed,
  nextActions: timedNextActions,
  deriveResult: deriveTimedResult,
  scoreForResult: timedResultScore,
  playerLines: timedPlayerLines,
  publicLiveState: timedPublicLiveState,
} satisfies FamilyEngine<TimedState, TimedPanel>;
