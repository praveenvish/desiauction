import type { SeasonPlayer, QualifiedMetric } from "@desiauction/core/scoring";
export type LeaderboardTab = "MVP" | "Runs" | "Wickets" | "SR" | "Economy" | "Sixes";
function metric(a: QualifiedMetric, b: QualifiedMetric, ascending = false) {
  return (
    Number(b.qualified) - Number(a.qualified) ||
    (a.qualified && b.qualified && a.value !== null && b.value !== null
      ? ascending
        ? a.value - b.value
        : b.value - a.value
      : 0)
  );
}
/** Same qualification-aware secondary chain as A5; unavailable metrics never rank as zero. */
export function leaderboardOrder(
  a: SeasonPlayer,
  b: SeasonPlayer,
  tab: LeaderboardTab,
  sixes: Readonly<Record<string, number>>,
) {
  let order = 0;
  if (tab === "MVP") order = Number(b.mvpEligible) - Number(a.mvpEligible) || b.points - a.points;
  if (tab === "Runs")
    order =
      b.runs - a.runs ||
      metric(a.strikeRate, b.strikeRate) ||
      metric(a.battingAverage, b.battingAverage) ||
      a.battingInnings - b.battingInnings;
  if (tab === "Wickets")
    order =
      b.wickets - a.wickets ||
      metric(a.economy, b.economy, true) ||
      metric(a.bowlingAverage, b.bowlingAverage, true) ||
      a.bowlingBalls - b.bowlingBalls;
  if (tab === "SR") order = metric(a.strikeRate, b.strikeRate);
  if (tab === "Economy") order = metric(a.economy, b.economy, true);
  if (tab === "Sixes") order = (sixes[b.registrationId] ?? 0) - (sixes[a.registrationId] ?? 0);
  return (
    order ||
    (a.registrationId < b.registrationId ? -1 : a.registrationId > b.registrationId ? 1 : 0)
  );
}
