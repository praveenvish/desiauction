import type { BallPayload, ValidationResult, WicketKind } from "../types";
import { copyConditions, type InningsState, type MatchState } from "./state";
import type { Conditions } from "../conditions";

export const BOWLER_WICKETS: readonly WicketKind[] = [
  "bowled",
  "caught",
  "caught_and_bowled",
  "lbw",
  "stumped",
  "hit_wicket",
];

export function validateDismissal(
  state: MatchState,
  innings: InningsState,
  ball: BallPayload,
): ValidationResult {
  const wicket = ball.wicket;
  if (!wicket) return { ok: true };
  if (wicket.kind === "lbw" && !state.format?.lbw)
    return { ok: false, reason: "illegal_wicket_on_extra", detail: "lbw_off" };
  if (
    ball.extras.wides &&
    !["stumped", "run_out", "hit_wicket", "obstructing"].includes(wicket.kind)
  )
    return { ok: false, reason: "illegal_wicket_on_extra", detail: "wide" };
  if (ball.extras.noBall && !["run_out", "obstructing", "hit_twice"].includes(wicket.kind))
    return { ok: false, reason: "illegal_wicket_on_extra", detail: "no_ball" };
  if (innings.freeHitNext && !["run_out", "obstructing"].includes(wicket.kind))
    return { ok: false, reason: "free_hit_dismissal" };
  if (wicket.playerOutId !== innings.strikerId && wicket.playerOutId !== innings.nonStrikerId)
    return { ok: false, reason: "not_batting" };
  if (
    !["run_out", "obstructing", "timed_out"].includes(wicket.kind) &&
    wicket.playerOutId !== innings.strikerId
  )
    return { ok: false, reason: "not_batting" };
  const lineup = state.lineups[innings.bowlingTeamId];
  if (
    !lineup ||
    wicket.fielderIds.length + (wicket.unknownFielderCount ?? 0) >
      (state.format?.playersPerSide ?? 0) ||
    wicket.fielderIds.some(
      (id) =>
        lineup.out.includes(id) ||
        (!lineup.battingOrder.includes(id) &&
          !(wicket.substituteFielderIds?.includes(id) && lineup.substitutes.includes(id))),
    ) ||
    wicket.substituteFielderIds?.some((id) => !lineup.substitutes.includes(id))
  )
    return { ok: false, reason: "unknown_player" };
  if (wicket.kind === "caught_and_bowled" && wicket.fielderIds.some((id) => id !== ball.bowlerId))
    return { ok: false, reason: "bad_payload" };
  if (
    wicket.runsCompleted !== undefined &&
    wicket.runsCompleted !==
      ball.runsBat +
        (ball.extras.byes ?? 0) +
        (ball.extras.legByes ?? 0) +
        (ball.extras.noBall
          ? (ball.extras.noBallRuns ?? state.format?.noBallRuns ?? 0) -
            (state.format?.noBallRuns ?? 0)
          : 0)
  )
    return { ok: false, reason: "bad_payload" };
  return { ok: true };
}

export function dismiss(
  innings: InningsState,
  playerId: string,
  howOut: string,
  seq: number,
  conditions: Conditions,
): void {
  const batter = innings.batters[playerId];
  if (batter) {
    batter.out = true;
    batter.notOut = false;
    batter.howOut = howOut;
    batter.retiredHurt = false;
    batter.dismissal = { seq, conditions: copyConditions(conditions) };
  }
  innings.wickets += 1;
  innings.outIds.push(playerId);
  if (innings.strikerId === playerId) innings.strikerId = null;
  if (innings.nonStrikerId === playerId) innings.nonStrikerId = null;
  innings.fallOfWickets.push({
    runs: innings.runs,
    wickets: innings.wickets,
    legalBalls: innings.legalBalls,
    playerOutId: playerId,
  });
}

export function recordDismissal(
  innings: InningsState,
  ball: BallPayload,
  seq: number,
  conditions: Conditions,
): void {
  const wicket = ball.wicket;
  if (!wicket) return;
  dismiss(innings, wicket.playerOutId, wicket.kind, seq, conditions);
  const bowler = innings.bowlers[ball.bowlerId];
  if (bowler && BOWLER_WICKETS.includes(wicket.kind)) bowler.wickets += 1;
}
