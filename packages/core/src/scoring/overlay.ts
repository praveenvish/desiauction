import { currentInnings, type MatchState } from "./delivery/state";
import type { BallPayload } from "./types";

export type OverlaySting = "four" | "six" | "wicket";
export interface OverlayProjection {
  seq: number;
  attempt: number;
  inningsNo: number | null;
  betweenOvers: boolean;
  lastDelivery: {
    seq: number;
    boundary: 4 | 6 | null;
    dismissal: boolean;
    sting: OverlaySting | null;
  } | null;
}
export function deliverySting(ball: Pick<BallPayload, "boundary" | "wicket">): OverlaySting | null {
  return ball.wicket ? "wicket" : ball.boundary === 6 ? "six" : ball.boundary === 4 ? "four" : null;
}
/** Separate from the lean live projection; corrections retain original delivery identity. */
export function overlayProjection(state: MatchState): OverlayProjection {
  const innings = currentInnings(state);
  const ball = innings?.overs.flatMap((over) => over.balls).at(-1);
  const original = ball && state.eventHistory.find((event) => event.eventId === ball.eventId);
  const classification = ball ? deliverySting(ball) : null;
  return {
    seq: state.lastSeq,
    attempt: state.attempt,
    inningsNo: innings?.no ?? null,
    betweenOvers: Boolean(
      state.phase === "live" &&
      !state.interrupted &&
      !state.finished &&
      innings &&
      innings.closed === null &&
      innings.completedOvers > 0 &&
      innings.ballsInOver === 0 &&
      (innings.overs[innings.completedOvers]?.balls.length ?? 0) === 0,
    ),
    lastDelivery: ball
      ? {
          seq: ball.seq,
          boundary: ball.boundary ?? null,
          dismissal: Boolean(ball.wicket),
          sting:
            original?.type === "ball" &&
            deliverySting(original.payload as BallPayload) === classification
              ? classification
              : null,
        }
      : null,
  };
}
