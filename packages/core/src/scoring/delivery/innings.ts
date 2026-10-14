import { actualBallLimit } from "./overs";
import type { InningsState, MatchState } from "./state";

export function closeIfComplete(state: MatchState, innings: InningsState): void {
  const format = state.format;
  if (!format || innings.closed) return;
  const wickets = innings.superOver ? 2 : format.wicketsPerInnings;
  if (innings.target !== null && innings.runs >= innings.target) innings.closed = "target";
  else if (innings.wickets >= wickets) innings.closed = "all_out";
  else if (
    innings.maxBalls !== null &&
    innings.legalBalls >=
      (actualBallLimit(innings.maxBalls, format.ballsPerOver, innings.miscountedOvers) ?? Infinity)
  )
    innings.closed = "overs";
  else if (innings.strikerId === null || innings.nonStrikerId === null) {
    const lineup = state.lineups[innings.battingTeamId];
    const available =
      lineup?.battingOrder.filter(
        (id) =>
          !innings.outIds.includes(id) &&
          !innings.absentBatterIds.includes(id) &&
          !innings.retiredHurt.includes(id) &&
          !lineup.out.includes(id) &&
          id !== innings.strikerId &&
          id !== innings.nonStrikerId,
      ) ?? [];
    if (
      format.lastManStands &&
      available.length === 0 &&
      (innings.strikerId || innings.nonStrikerId)
    ) {
      if (!innings.strikerId) {
        innings.strikerId = innings.nonStrikerId;
        innings.nonStrikerId = null;
      }
    } else if (available.length === 0) innings.closed = "no_more_batters";
  }
  innings.retirePromptDue =
    format.retireAt === null
      ? null
      : ([innings.strikerId, innings.nonStrikerId].find(
          (id) => id !== null && (innings.batters[id]?.runs ?? 0) >= (format.retireAt ?? Infinity),
        ) ?? null);
}

export function isLoneBatter(state: MatchState, innings: InningsState): boolean {
  const lineup = state.lineups[innings.battingTeamId];
  return (
    state.format?.lastManStands === true &&
    innings.strikerId !== null &&
    !!lineup &&
    lineup.battingOrder.filter(
      (id) =>
        !innings.outIds.includes(id) &&
        !lineup.out.includes(id) &&
        !innings.absentBatterIds.includes(id) &&
        !innings.retiredHurt.includes(id),
    ).length === 1
  );
}

/** Exhaustion is provisional only until a legitimate source of batting eligibility arrives. */
export function canReopenProvisional(state: MatchState, innings: InningsState): boolean {
  const format = state.format;
  return (
    innings.closed === "no_more_batters" &&
    !state.finished &&
    !state.outcome &&
    !state.interrupted &&
    state.currentInnings === state.innings.length - 1 &&
    format !== null &&
    innings.wickets < (innings.superOver ? 2 : format.wicketsPerInnings) &&
    (innings.target === null || innings.runs < innings.target) &&
    (innings.maxBalls === null ||
      innings.legalBalls <
        (actualBallLimit(innings.maxBalls, format.ballsPerOver, innings.miscountedOvers) ?? 0))
  );
}
