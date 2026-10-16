import { expect, it } from "vitest";
import type { SeasonPlayer } from "@desiauction/core/scoring";
import { leaderboardOrder, type LeaderboardTab } from "./leaderboard";
const qualified = (value: number | null, yes = true) => ({
  value,
  qualified: yes,
  remaining: yes ? 0 : 10,
});
function player(id: string, changes: Partial<SeasonPlayer> = {}): SeasonPlayer {
  return {
    registrationId: id,
    teamId: "team",
    matches: 1,
    teamMatches: 1,
    points: 20,
    perMatch: 20,
    mvpEligible: true,
    runs: 20,
    wickets: 2,
    battingInnings: 1,
    bowlingInnings: 1,
    balls: 30,
    bowlingBalls: 30,
    dismissals: 1,
    conceded: 10,
    fieldingPoints: 0,
    directRunOuts: 0,
    keeperDismissals: 0,
    keeperByes: 0,
    strikeRate: qualified(100),
    battingAverage: qualified(20),
    economy: qualified(5),
    bowlingAverage: qualified(5),
    ...changes,
  };
}
function first(a: SeasonPlayer, b: SeasonPlayer, tab: LeaderboardTab) {
  return [a, b].sort((x, y) => leaderboardOrder(x, y, tab, { a: 1, b: 2 }))[0]?.registrationId;
}
it("uses all runs tiebreaks without ranking unqualified or unavailable rates as zero", () => {
  expect(first(player("a", { runs: 21 }), player("b"), "Runs")).toBe("a");
  expect(first(player("a", { strikeRate: qualified(500, false) }), player("b"), "Runs")).toBe("b");
  expect(first(player("a", { strikeRate: qualified(101) }), player("b"), "Runs")).toBe("a");
  expect(first(player("a", { battingAverage: qualified(21) }), player("b"), "Runs")).toBe("a");
  expect(first(player("a", { battingInnings: 2 }), player("b"), "Runs")).toBe("b");
  expect(first(player("b"), player("a"), "Runs")).toBe("a");
});
it("uses wicket, qualified economy, qualified average, fewer balls then ID", () => {
  expect(first(player("a", { wickets: 3 }), player("b"), "Wickets")).toBe("a");
  expect(first(player("a", { economy: qualified(0, false) }), player("b"), "Wickets")).toBe("b");
  expect(first(player("a", { economy: qualified(4) }), player("b"), "Wickets")).toBe("a");
  expect(first(player("a", { bowlingAverage: qualified(4) }), player("b"), "Wickets")).toBe("a");
  expect(first(player("a", { bowlingBalls: 31 }), player("b"), "Wickets")).toBe("b");
  expect(first(player("b"), player("a"), "Wickets")).toBe("a");
});
it("keeps MVP participation, SR/economy qualification and six counts independent", () => {
  expect(first(player("a", { points: 1000, mvpEligible: false }), player("b"), "MVP")).toBe("b");
  expect(first(player("a", { strikeRate: qualified(null, false) }), player("b"), "SR")).toBe("b");
  expect(first(player("a", { economy: qualified(null, false) }), player("b"), "Economy")).toBe("b");
  expect(first(player("a", { points: 1000 }), player("b"), "Sixes")).toBe("b");
});
