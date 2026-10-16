import type { MatchEvent, PlayerLine } from "../types";
import {
  initialPlacementState,
  placementPlayers,
  placementTable,
  type PlacementState,
} from "./state";
import { applyPlacement } from "./apply";
import { replayPlacement } from "./replay";
import { placementPublicState } from "./public-state";
export interface PlacementResult {
  family: "placement";
  outcome: "completed" | "abandoned";
  placements: ReturnType<typeof placementTable>;
}
export function derivePlacementResult(state: PlacementState): PlacementResult | null {
  if (state.terminal === "void" || !state.format) return null;
  if (state.terminal === "abandoned")
    return { family: "placement", outcome: "abandoned", placements: [] };
  return state.rounds.length === state.format.rounds
    ? { family: "placement", outcome: "completed", placements: placementTable(state) }
    : null;
}
export function placementPlayerLines(state: PlacementState): Map<string, PlayerLine> {
  return new Map(
    [...placementPlayers(state)].map(([registrationId, p]) => [
      registrationId,
      { registrationId, teamId: p.teamId, appeared: true, placement: { kills: p.kills } },
    ]),
  );
}
export const placementEngine = {
  family: "placement" as const,
  initialState: initialPlacementState,
  replay: replayPlacement,
  apply: applyPlacement,
  nextActions: (state: PlacementState) =>
    state.finished
      ? []
      : derivePlacementResult(state)
        ? [{ kind: "finish" as const, result: derivePlacementResult(state) }]
        : [{ kind: "record_lobby_round" as const, round: state.rounds.length + 1 }],
  deriveResult: derivePlacementResult,
  playerLines: placementPlayerLines,
  publicLiveState: placementPublicState,
};
export function placementActivity(
  state: PlacementState,
): Pick<MatchEvent, "eventId" | "clientRecordedAt">[] {
  return state.rounds.map(({ eventId, clientRecordedAt }) => ({ eventId, clientRecordedAt }));
}
