import { parseBowlingStyle } from "@desiauction/core";
import { nextActions, type MatchState, type NextAction } from "@desiauction/core/scoring";
import type { SetupPlayer } from "../setup/setup-model";
export function effectiveStyle(state: MatchState, _player: SetupPlayer | undefined, id: string) {
  return {
    battingHand: state.styles[id]?.battingHand ?? null,
    bowlingStyle: parseBowlingStyle(state.styles[id]?.bowlingStyle ?? "") ?? null,
  };
}
export const dismissalKey = (fixtureId: string, id: string, what: string) =>
  `ls1:style-dismissed:${fixtureId}:${id}:${what}`;
export function scoringActions(
  state: MatchState,
  players: SetupPlayer[],
  dismissed: ReadonlySet<string>,
) {
  return nextActions(state).filter(
    (action) =>
      action.kind !== "ask_style" ||
      (!effectiveStyle(
        state,
        players.find((p) => p.id === action.registrationId),
        action.registrationId,
      )[action.what] &&
        !dismissed.has(`${action.registrationId}:${action.what}`)),
  );
}
export function bowlerRows(action: Extract<NextAction, { kind: "pick_bowler" }>) {
  const allowed = [...action.allowed].sort(
    (a, b) => Number(b === action.suggestedId) - Number(a === action.suggestedId),
  );
  return [
    ...allowed.map((id) => ({ id, reason: null })),
    ...action.blocked.map(({ id, reason }) => ({
      id,
      reason: {
        consecutive: "Just bowled the last over",
        quota: "Over quota used",
        subbed_out: "Substituted out",
      }[reason],
    })),
  ];
}
