import type { PlayerLine } from "../types";
import type { MatchState } from "./state";

export function playerLines(state: MatchState): Map<string, PlayerLine> {
  const lines = new Map<string, PlayerLine>();
  function line(id: string, teamId: string): PlayerLine {
    const existing = lines.get(id);
    if (existing) return existing;
    const added: PlayerLine = { registrationId: id, teamId, appeared: true };
    lines.set(id, added);
    return added;
  }
  for (const [teamId, lineup] of Object.entries(state.lineups))
    for (const id of [...lineup.battingOrder, ...lineup.out]) line(id, teamId);
  for (const innings of state.innings) {
    if (innings.superOver) continue;
    for (const [id, batting] of Object.entries(innings.batters)) {
      const value = line(id, innings.battingTeamId);
      const previous = value.batting;
      value.batting = {
        ...batting,
        runs: (previous?.runs ?? 0) + batting.runs,
        balls: (previous?.balls ?? 0) + batting.balls,
        fours: (previous?.fours ?? 0) + batting.fours,
        sixes: (previous?.sixes ?? 0) + batting.sixes,
        dismissals: [
          ...(previous?.dismissals ?? []),
          ...(batting.out && batting.dismissal
            ? [{ inningsNo: innings.no, ...batting.dismissal }]
            : []),
        ],
      };
    }
    for (const [id, bowling] of Object.entries(innings.bowlers)) {
      const value = line(id, innings.bowlingTeamId);
      const previous = value.bowling;
      value.bowling = {
        legalBalls: (previous?.legalBalls ?? 0) + bowling.legalBalls,
        maiden: (previous?.maiden ?? 0) + bowling.maiden,
        runs: (previous?.runs ?? 0) + bowling.runs,
        wickets: (previous?.wickets ?? 0) + bowling.wickets,
        dots: (previous?.dots ?? 0) + bowling.dots,
        wides: (previous?.wides ?? 0) + bowling.wides,
        noBalls: (previous?.noBalls ?? 0) + bowling.noBalls,
      };
    }
    for (const over of innings.overs)
      for (const ball of over.balls) {
        const wicket = ball.wicket;
        if (!wicket) continue;
        const fielders = wicket.kind === "caught_and_bowled" ? [ball.bowlerId] : wicket.fielderIds;
        for (const id of fielders) {
          if (!["caught", "caught_and_bowled", "stumped", "run_out"].includes(wicket.kind))
            continue;
          const value = line(id, innings.bowlingTeamId);
          const fielding = value.fielding ?? {
            catches: 0,
            stumpings: 0,
            runOutsDirect: 0,
            runOutsAssisted: 0,
          };
          if (wicket.kind === "caught" || wicket.kind === "caught_and_bowled") fielding.catches++;
          else if (wicket.kind === "stumped") fielding.stumpings++;
          else if (fielders.length + (wicket.unknownFielderCount ?? 0) === 1)
            fielding.runOutsDirect++;
          else fielding.runOutsAssisted++;
          value.fielding = fielding;
        }
      }
  }
  return lines;
}
