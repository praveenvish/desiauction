import type { PublicCharts } from "@desiauction/core/scoring";
export type ChartInnings = PublicCharts["innings"][number];
export function wagonModel(innings: ChartInnings, batterId: string | null = null) {
  return innings.shots
    .filter((shot) => batterId === null || shot.batterId === batterId)
    .map((shot) => {
      const category =
        shot.boundary === 4
          ? "four"
          : shot.boundary === 6
            ? "six"
            : shot.runs >= 1 && shot.runs <= 3
              ? "runs"
              : "other";
      const radius =
        category === "six"
          ? 90
          : category === "four"
            ? 78
            : category === "runs"
              ? 25 + shot.runs * 15
              : 65;
      const radians = (shot.angle * Math.PI) / 180;
      return {
        ...shot,
        category,
        radius,
        x: 100 + Math.sin(radians) * radius,
        y: 100 - Math.cos(radians) * radius,
      };
    })
    .sort((left, right) => right.radius - left.radius);
}
