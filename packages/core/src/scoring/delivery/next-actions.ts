import { canParticipateInOver } from "./overs";
import type { NextAction } from "../types";
import { deriveResult } from "./result";
import { currentInnings } from "./state";
import type { MatchState } from "./state";
import { isLoneBatter } from "./innings";

export function nextActions(state: MatchState): NextAction[] {
  if (state.finished) return [];
  const result = deriveResult(state);
  if (result)
    return [
      ...(result.outcome === "tie" && state.format?.superOver
        ? [{ kind: "start_super_over" } as const]
        : []),
      { kind: "finish", result },
    ];
  if (state.interrupted) return [{ kind: "resume" }];
  if (!state.format || !state.teams) return [{ kind: "confirm_conditions" }];
  const missing = [state.teams.home, state.teams.away].filter((id) => !state.lineups[id]);
  if (missing.length) return missing.map((teamId) => ({ kind: "confirm_lineup", teamId }));
  if (!state.toss) return [{ kind: "record_toss" }];
  const innings = currentInnings(state);
  if (!innings || innings.closed) {
    const pending = state.pendingSuperOver[0];
    const firstTeam =
      state.toss.decision === "bat"
        ? state.toss.winnerTeamId
        : state.toss.winnerTeamId === state.teams.home
          ? state.teams.away
          : state.teams.home;
    return [
      {
        kind: "start_innings",
        inningsNo: pending?.inningsNo ?? state.innings.length + 1,
        battingTeamId: pending?.battingTeamId ?? (innings ? innings.bowlingTeamId : firstTeam),
      },
    ];
  }
  const actions: NextAction[] = [];
  const lineup = state.lineups[innings.battingTeamId];
  const available =
    lineup?.battingOrder.filter(
      (id) =>
        !lineup.out.includes(id) &&
        !innings.outIds.includes(id) &&
        !innings.retiredHurt.includes(id) &&
        !innings.absentBatterIds.includes(id) &&
        id !== innings.strikerId &&
        id !== innings.nonStrikerId,
    ) ?? [];
  for (const end of ["striker", "non_striker"] as const) {
    if (
      (end === "striker" ? innings.strikerId : innings.nonStrikerId) === null &&
      !(end === "non_striker" && isLoneBatter(state, innings))
    )
      actions.push({ kind: "pick_new_batter", end, suggestedId: available.shift() ?? null });
  }
  if (innings.bowlerId === null) {
    const fielders = state.lineups[innings.bowlingTeamId];
    const allowed: string[] = [];
    const blocked: Extract<NextAction, { kind: "pick_bowler" }>["blocked"] = [];
    for (const id of [...(fielders?.battingOrder ?? []), ...(fielders?.out ?? [])]) {
      const reason = fielders?.out.includes(id)
        ? "subbed_out"
        : state.format.noConsecutiveOvers && innings.lastBowlerOfPreviousOver === id
          ? "consecutive"
          : !canParticipateInOver(innings, id, state.format.maxOversPerBowler)
            ? "quota"
            : null;
      if (reason) blocked.push({ id, reason });
      else allowed.push(id);
    }
    const recency = (id: string) => {
      let last = -1;
      innings.overs.forEach((over, index) => {
        if (over.balls.some((ball) => ball.bowlerId === id)) last = index;
      });
      return last;
    };
    const suggested = [...allowed].sort(
      (a, b) =>
        recency(a) - recency(b) ||
        (innings.bowlers[a]?.legalBalls ?? 0) - (innings.bowlers[b]?.legalBalls ?? 0),
    );
    actions.push({ kind: "pick_bowler", allowed, blocked, suggestedId: suggested[0] ?? null });
  }
  if (!actions.length) actions.push({ kind: "record_ball", freeHit: innings.freeHitNext });
  for (const id of [innings.strikerId, innings.nonStrikerId])
    if (id && !state.styles[id]?.battingHand)
      actions.push({ kind: "ask_style", registrationId: id, what: "battingHand" });
  if (innings.bowlerId && !state.styles[innings.bowlerId]?.bowlingStyle)
    actions.push({ kind: "ask_style", registrationId: innings.bowlerId, what: "bowlingStyle" });
  if (innings.retirePromptDue)
    actions.push({
      kind: "retire_prompt",
      registrationId: innings.retirePromptDue,
      atRuns: state.format.retireAt ?? 0,
    });
  return actions;
}
