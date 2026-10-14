import type { NameBook, PublicCharts } from "../types";
import type { MatchState } from "./state";

/** Recorded chart facts from this canonical fold, with already sanitized identities. */
export function publicCharts(state: MatchState, names: NameBook): PublicCharts {
  return {
    v: 1,
    seq: state.lastSeq,
    ballsPerOver: state.format?.ballsPerOver ?? 6,
    innings: state.innings.map((innings) => ({
      no: innings.no,
      battingTeamId: innings.battingTeamId,
      superOver: innings.superOver,
      runs: innings.runs,
      wickets: innings.wickets,
      legalBalls: innings.legalBalls,
      currentBatterIds: [innings.strikerId, innings.nonStrikerId].filter(
        (id): id is string => id !== null,
      ),
      batters: innings.battedOrder.map((id) => ({
        id,
        name: names.players[id]?.name ?? "Player",
        initials: names.players[id]?.initials ?? "?",
      })),
      shots: innings.overs.flatMap((over) =>
        over.balls.flatMap((ball) =>
          ball.shot && ball.runsBat > 0
            ? [
                {
                  seq: ball.seq,
                  batterId: ball.strikerId,
                  angle: ball.shot.angle,
                  runs: ball.runsBat,
                  boundary: ball.boundary ?? null,
                },
              ]
            : [],
        ),
      ),
      overs: innings.overs.map((over, index) => ({
        number: index + 1,
        complete: index < innings.completedOvers,
        legalBalls: over.balls.filter((ball) => ball.legal).length,
        runs: over.balls.reduce((runs, ball) => runs + ball.total, 0),
        wickets: over.balls.filter((ball) => ball.wicket).length,
      })),
      points: innings.scoreTrace.map((point) => ({
        seq: point.seq,
        kind: point.kind,
        runs: point.runs,
        wickets: point.wickets,
        legalBalls: point.legalBalls,
        completedOvers: point.completedOvers,
        ballsInOver: point.ballsInOver,
        subsequent: point.subsequent,
      })),
      adjustments: innings.scoreTrace.flatMap((point, index) => {
        if (point.kind === "delivery") return [];
        const previous = innings.scoreTrace[index - 1];
        const runs = point.runs - (previous?.runs ?? 0);
        const wickets = point.wickets - (previous?.wickets ?? 0);
        return runs || wickets
          ? [
              {
                seq: point.seq,
                kind: point.kind,
                runs,
                wickets,
                legalBalls: point.legalBalls,
                subsequent: point.subsequent,
              },
            ]
          : [];
      }),
    })),
  };
}
