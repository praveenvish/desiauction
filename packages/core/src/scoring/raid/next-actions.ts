import type { FamilyAction } from "../family";
import { completed, halfExpired, type RaidState } from "./state";
import { deriveRaidResult } from "./result";
export function raidNextActions(state: RaidState): FamilyAction[] {
  if (state.finished) return [];
  if (state.interrupted) return [{ kind: "resume" }];
  const result = deriveRaidResult(state);
  if (result) return [{ kind: "finish", result }];
  if (!state.format || !state.teams) return [{ kind: "confirm_conditions" }];
  const missing = Object.values(state.teams).filter((id) => !state.squads[id]);
  if (missing.length) return missing.map((teamId) => ({ kind: "confirm_lineup", teamId }));
  if (state.halfClosed && !completed(state))
    return [{ kind: "start_half", half: state.half === 0 ? 1 : 2 }];
  if (halfExpired(state)) return [{ kind: "end_half" }];
  if (!state.running) return [{ kind: "start_clock" }];
  return [
    {
      kind: "record_raid",
      side: state.nextRaidingSide,
      doOrDie: state.empty[state.nextRaidingSide] >= state.format.doOrDieAfterEmpty,
    },
  ];
}
