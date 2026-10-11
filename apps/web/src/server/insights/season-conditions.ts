import type { Conditions, MatchState } from "@desiauction/core/scoring";
import type { InsightFilter } from "./sample";
/** URL16 filters complete canonical matches, never partial award inputs. */
export function wholeMatchConditions(state: MatchState, filter: InsightFilter) {
  if (filter.formatKey !== undefined && state.format?.key !== filter.formatKey) return false;
  const observations: Conditions[] = [];
  for (const innings of state.innings) {
    if (innings.superOver) continue;
    for (const over of innings.overs)
      for (const ball of over.balls) observations.push(ball.conditions);
    for (const line of Object.values(innings.batters))
      if (line.dismissal) observations.push(line.dismissal.conditions);
  }
  const selected = [
    [filter.ballType, (c: Conditions) => c.ball?.type],
    [filter.timeOfDay, (c: Conditions) => c.timeOfDay],
    [filter.pitch, (c: Conditions) => c.pitch],
    [filter.groundType, (c: Conditions) => c.ground],
  ] as const;
  return selected.every(
    ([value, read]) =>
      value === undefined ||
      (observations.length > 0 && observations.every((c) => read(c) === value)),
  );
}
