import type { PlayerLine } from "../types";
import type { RallyState } from "./state";
export function rallyPlayerLines(state: RallyState): Map<string, PlayerLine> {
  return new Map(
    Object.entries(state.participants).map(([registrationId, player]) => [
      registrationId,
      { registrationId, teamId: player.teamId, appeared: true, rally: { ...player.stats } },
    ]),
  );
}
