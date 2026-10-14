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
  if (format.noConsecutiveOvers && previousOverBowlers(innings).has(bowlerId))
    return { ok: false, reason: "bowler_consecutive" };
  const over = innings.overs[innings.completedOvers];
  const hasDeliveries = (over?.balls.length ?? 0) > 0;
  if (midOver !== hasDeliveries) return { ok: false, reason: "bad_payload" };
  return { ok: true };
}

/**
 * Everyone who bowled any ball of the previous over (Law 17.8): none of them may
 * bowl any part of the next one, whether they start it or replace a bowler mid-over.
 */
export function previousOverBowlers(innings: InningsState): Set<string> {
  const bowlers = new Set<string>();
  if (innings.lastBowlerOfPreviousOver) bowlers.add(innings.lastBowlerOfPreviousOver);
  const previous = innings.overs[innings.completedOvers - 1];
  for (const ball of previous?.balls ?? []) bowlers.add(ball.bowlerId);
  return bowlers;
}
