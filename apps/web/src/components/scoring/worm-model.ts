import type { ChartInnings } from "./wagon-model";
export function wormModel(innings: ChartInnings, ballsPerOver: number) {
  return innings.points.map((point) => ({
    ...point,
    x: point.legalBalls / ballsPerOver,
    label: `${String(point.completedOvers)}.${String(point.ballsInOver)}`,
  }));
}
