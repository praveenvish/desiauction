import { canParticipateInOver } from "./overs";
import type { ValidationResult } from "../types";
import type { InningsState, MatchState } from "./state";

export function validateBowler(
  state: MatchState,
  innings: InningsState,
  bowlerId: string,
  midOver: boolean,
): ValidationResult {
  const format = state.format;
  const lineup = state.lineups[innings.bowlingTeamId];
  if (
    !format ||
    !lineup ||
    !lineup.battingOrder.includes(bowlerId) ||
    lineup.out.includes(bowlerId)
  )
    return { ok: false, reason: "bowler_not_fielding" };
  if (!canParticipateInOver(innings, bowlerId, format.maxOversPerBowler))
    return { ok: false, reason: "bowler_quota" };
  if (!midOver && format.noConsecutiveOvers && innings.lastBowlerOfPreviousOver === bowlerId)
    return { ok: false, reason: "bowler_consecutive" };
  const over = innings.overs[innings.completedOvers];
  const hasDeliveries = (over?.balls.length ?? 0) > 0;
  if (midOver !== hasDeliveries) return { ok: false, reason: "bad_payload" };
  return { ok: true };
}
