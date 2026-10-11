import type { FamilyAction } from "../family";
import { deriveRallyResult } from "./result";
import type { RallyState } from "./state";
export function rallyNextActions(state: RallyState): FamilyAction[] {
  if (state.finished) return [];
  if (state.interrupted) return [{ kind: "resume" }];
  const result = deriveRallyResult(state);
  if (result) return [{ kind: "finish", result }];
  if (!state.format || !state.teams) return [{ kind: "confirm_conditions" }];
  const missing = Object.values(state.teams).filter((id) => !state.squads[id]);
  if (missing.length) return missing.map((teamId) => ({ kind: "confirm_lineup", teamId }));
  const current = state.rubbers.at(-1);
  if (!current || current.winner)
    return [{ kind: "start_rubber", rubberNo: (current?.no ?? 0) + 1, gameNo: 1 }];
  if (current.games.at(-1)?.winner)
    return [{ kind: "start_rubber", rubberNo: current.no, gameNo: current.games.length + 1 }];
  return [{ kind: "record_rally" }];
}
