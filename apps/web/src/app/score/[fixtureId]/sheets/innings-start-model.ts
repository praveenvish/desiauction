import { nextActions, type EventPayloads, type MatchState } from "@desiauction/core/scoring";

export interface InningsIdentity {
  attempt: number;
  inningsNo: number;
  battingTeamId: string;
}
export interface OpeningPlayers {
  strikerId: string;
  nonStrikerId: string | null;
  bowlerId: string;
}
export function inningsOpening(state: MatchState) {
  const action = nextActions(state).find((item) => item.kind === "start_innings");
  if (!action || !state.teams) return null;
  const batting = state.lineups[action.battingTeamId];
  const bowlingTeamId =
    action.battingTeamId === state.teams.home ? state.teams.away : state.teams.home;
  const bowling = state.lineups[bowlingTeamId];
  const batters = batting?.battingOrder.filter((id) => !batting.out.includes(id)) ?? [];
  const bowlers = bowling?.battingOrder.filter((id) => !bowling.out.includes(id)) ?? [];
  return {
    identity: {
      attempt: state.attempt,
      inningsNo: action.inningsNo,
      battingTeamId: action.battingTeamId,
    },
    batters,
    bowlers,
    loneBatter: state.format?.lastManStands === true && batters.length === 1,
    superOver:
      state.pendingSuperOver[0]?.inningsNo === action.inningsNo &&
      state.pendingSuperOver[0].battingTeamId === action.battingTeamId,
  };
}
export function inningsStartPayload(
  state: MatchState,
  expected: InningsIdentity,
  players: OpeningPlayers,
): EventPayloads["innings_started"] {
  const opening = inningsOpening(state);
  if (
    !opening ||
    opening.identity.attempt !== expected.attempt ||
    opening.identity.inningsNo !== expected.inningsNo ||
    opening.identity.battingTeamId !== expected.battingTeamId
  )
    throw new Error("The innings changed. Reopen the innings selection.");
  if (
    !opening.batters.includes(players.strikerId) ||
    (players.nonStrikerId === null
      ? !opening.loneBatter
      : players.strikerId === players.nonStrikerId ||
        !opening.batters.includes(players.nonStrikerId)) ||
    !opening.bowlers.includes(players.bowlerId)
  )
    throw new Error("Choose eligible opening batters and an opposing bowler.");
  return {
    inningsNo: expected.inningsNo,
    battingTeamId: expected.battingTeamId,
    ...players,
    ...(opening.superOver ? { superOver: true } : {}),
  };
}
