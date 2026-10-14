import type { ChartInnings } from "./wagon-model";
export function manhattanModel(innings: ChartInnings) {
  return {
    bars: innings.overs.map((over) => ({
      ...over,
      label: `Over ${String(over.number)}${over.complete ? "" : " · partial"} · ${String(over.legalBalls)} legal balls`,
    })),
    adjustments: innings.adjustments,
    total:
      innings.overs.reduce((sum, over) => sum + over.runs, 0) +
      innings.adjustments.reduce((sum, adjustment) => sum + adjustment.runs, 0),
  };
}
