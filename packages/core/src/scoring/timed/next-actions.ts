import type { FamilyAction } from "../family";
import type { TimedState } from "./state";
import { deriveTimedResult } from "./result";
export function timedNextActions(state: TimedState): FamilyAction[] {
  if (state.finished || state.terminal === "void") return [];
  if (state.interrupted) return [{ kind: "resume" }];
  const result = deriveTimedResult(state);
  if (result) return [{ kind: "finish", result }];
  if (!state.format || !state.teams) return [{ kind: "confirm_conditions" }];
  const missing = Object.values(state.teams).filter((id) => !state.squads[id]);
  if (missing.length) return missing.map((teamId) => ({ kind: "confirm_lineup", teamId }));
  const s = state.shootout;
  if (s) {
    const side = s.nextSide;
    return [
      {
        kind: "shootout_attempt",
        teamId: state.teams[side],
        eligiblePlayerIds:
          s.used[side].length === s.eligible[side].length
            ? [...s.eligible[side]]
            : s.eligible[side].filter((id) => !s.used[side].includes(id)),
      },
    ];
  }
  if (state.periodClosed) return [{ kind: "start_period", period: state.period + 1 }];
  return [
    { kind: "record_score", scoreUnits: [...state.format.scoreUnits] },
    { kind: "end_period", period: state.period },
  ];
}
