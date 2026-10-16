import type { Db } from "@desiauction/db";
import {
  aggregateFacts,
  sample,
  withSample,
  type InsightFilter,
  type InsightScope,
} from "./sample";

export async function bowlerInsights(
  db: Db,
  scope: InsightScope,
  filter: InsightFilter = {},
  now = new Date(),
) {
  const dimensions = [
    "all",
    "zone",
    "wicket_kind",
    "phase",
    "batter_hand",
    "ball_type",
    "shot",
  ] as const;
  const groups = await Promise.all(
    dimensions.map((dimension) => aggregateFacts(db, scope, "bowling", dimension, filter, now)),
  );
  const total = groups[0]?.[0];
  const bowling = (rows: NonNullable<(typeof groups)[0]>) =>
    rows.map((row) => ({
      ...withSample(row),
      economy: row.balls ? (row.conceded * 6) / row.balls : null,
    }));
  return {
    sample: sample(total?.balls ?? 0, total?.matches ?? 0),
    wickets: total?.wickets ?? 0,
    conceded: total?.conceded ?? 0,
    economy: total?.balls ? (total.conceded * 6) / total.balls : null,
    dots: total?.dots ?? 0,
    dotPercent: total?.balls ? (total.dots * 100) / total.balls : null,
    zones: bowling(groups[1] ?? []),
    shots: (groups[6] ?? []).filter((row) => row.key !== null),
    dismissals: (groups[2] ?? [])
      .filter((row) => row.wickets > 0)
      .map((row) => ({ kind: row.key, count: row.wickets })),
    phases: bowling(groups[3] ?? []),
    hands: bowling(groups[4] ?? []),
    ballTypes: bowling(groups[5] ?? []),
  };
}
export type BowlerInsights = Awaited<ReturnType<typeof bowlerInsights>>;
