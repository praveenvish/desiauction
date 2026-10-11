import { CRICKET_BOWLING_STYLE_KEYS } from "@desiauction/core";
import { aggregateDismissals } from "./dismissals";
import type { Db } from "@desiauction/db";
import {
  aggregateFacts,
  sample,
  withSample,
  type InsightFilter,
  type InsightScope,
} from "./sample";

export async function batterInsights(
  db: Db,
  scope: InsightScope,
  filter: InsightFilter = {},
  now = new Date(),
) {
  const dimensions = [
    "all",
    "zone",
    "bowler_style",
    "phase",
    "ball_type",
    "time_of_day",
    "pitch",
    "ground_type",
    "shot",
    "wicket_position",
  ] as const;
  const groups = await Promise.all(
    dimensions.map((dimension) => aggregateFacts(db, scope, "batting", dimension, filter, now)),
  );
  const dismissals = await aggregateFacts(db, scope, "dismissed", "wicket_kind", filter, now);
  const total = groups[0]?.[0];
  const averageDimensions = ["all", "ball_type", "time_of_day", "pitch", "ground_type"] as const;
  const denominators = await Promise.all(
    averageDimensions.map((dimension) => aggregateDismissals(db, scope, dimension, filter, now)),
  );
  const totalDenominator = denominators[0]?.[0];
  const average =
    totalDenominator && !totalDenominator.historical && totalDenominator.dismissals > 0
      ? (total?.runs ?? 0) / totalDenominator.dismissals
      : null;
  function conditionAverages(rows: Awaited<ReturnType<typeof aggregateFacts>>, index: number) {
    const denominatorRows = denominators[index] ?? [];
    const keys = new Set([
      ...rows.map((row) => row.key),
      ...denominatorRows.filter((row) => row.dismissals > 0).map((row) => row.key),
    ]);
    return [...keys].map((key) => {
      const denominator = denominatorRows.find((candidate) => candidate.key === key);
      const row = rows.find((candidate) => candidate.key === key) ?? {
        key,
        balls: 0,
        matches: denominator?.matches ?? 0,
        runs: 0,
        conceded: 0,
        dots: 0,
        fours: 0,
        sixes: 0,
        wickets: 0,
        deliveries: 0,
      };
      return {
        ...withSample(row),
        strikeRate: row.balls ? (row.runs * 100) / row.balls : null,
        average:
          denominator && !denominator.historical && denominator.dismissals > 0
            ? row.runs / denominator.dismissals
            : null,
      };
    });
  }
  const batting = (rows: typeof dismissals) =>
    rows.map((row) => ({
      ...withSample(row),
      strikeRate: row.balls ? (row.runs * 100) / row.balls : null,
    }));
  return {
    sample: sample(total?.balls ?? 0, total?.matches ?? 0),
    runs: total?.runs ?? 0,
    average,
    fours: total?.fours ?? 0,
    sixes: total?.sixes ?? 0,
    strikeRate: total?.balls ? (total.runs * 100) / total.balls : null,
    zones: batting(groups[1] ?? []),
    shots: (groups[8] ?? []).filter((row) => row.key !== null),
    dismissalPositions: (groups[9] ?? []).filter((row) => row.key !== null),
    bowlingTypes: batting(groups[2] ?? []),
    phases: batting(groups[3] ?? []),
    conditions: {
      ball: conditionAverages(groups[4] ?? [], 1),
      light: conditionAverages(groups[5] ?? [], 2),
      pitch: conditionAverages(groups[6] ?? [], 3),
      ground: conditionAverages(groups[7] ?? [], 4),
    },
    dismissals: dismissals.map((row) => ({ kind: row.key, count: row.deliveries })),
  };
}
export type BatterInsights = Awaited<ReturnType<typeof batterInsights>>;

/** Rank only known styles with enough deliveries to support a matchup hint. */
export function slowestBowlingMatchup(insights: Pick<BatterInsights, "bowlingTypes">) {
  const eligible = insights.bowlingTypes
    .filter(
      (row) =>
        row.key !== null &&
        CRICKET_BOWLING_STYLE_KEYS.some((key) => key === row.key) &&
        !row.sample.small &&
        row.balls > 0,
    )
    .map((row) => ({ style: row.key ?? "", rate: (row.runs * 6) / row.balls, sample: row.sample }))
    .sort((a, b) => a.rate - b.rate || a.style.localeCompare(b.style));
  return eligible[0] ?? null;
}
