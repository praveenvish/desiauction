import { expect, it } from "vitest";
import { wagonModel, type ChartInnings } from "./wagon-model";
import { wormModel } from "./worm-model";
import { manhattanModel } from "./manhattan-model";
const innings: ChartInnings = {
  no: 1,
  battingTeamId: "home",
  superOver: false,
  runs: 13,
  wickets: 1,
  legalBalls: 5,
  currentBatterIds: ["a", "b"],
  batters: [],
  shots: [
    { seq: 1, batterId: "a", angle: 90, runs: 4, boundary: 4 },
    { seq: 2, batterId: "b", angle: 270, runs: 5, boundary: null },
  ],
  overs: [{ number: 1, complete: true, legalBalls: 5, runs: 8, wickets: 1 }],
  points: [
    {
      seq: 0,
      kind: "opening",
      runs: 0,
      wickets: 0,
      legalBalls: 0,
      completedOvers: 0,
      ballsInOver: 0,
      subsequent: false,
    },
    {
      seq: 1,
      kind: "delivery",
      runs: 8,
      wickets: 1,
      legalBalls: 5,
      completedOvers: 1,
      ballsInOver: 0,
      subsequent: false,
    },
    {
      seq: 2,
      kind: "penalty",
      runs: 13,
      wickets: 1,
      legalBalls: 5,
      completedOvers: 1,
      ballsInOver: 0,
      subsequent: true,
    },
  ],
  adjustments: [{ seq: 2, kind: "penalty", runs: 5, wickets: 0, legalBalls: 5, subsequent: true }],
};
it("uses recorded angles once and preserves All, batter filters and unusual run categories", () => {
  const shots = wagonModel(innings);
  expect(shots[0]).toMatchObject({ category: "four", x: 178, y: 100 });
  expect(shots[1]).toMatchObject({ category: "other", x: 35 });
  expect(wagonModel(innings, "b")).toHaveLength(1);
  expect(wagonModel(innings, "missing")).toEqual([]);
});
it("preserves repeated legal-ball positions for penalties and uses numeric balls-per-over coordinates", () => {
  expect(wormModel(innings, 6).map((point) => [point.x, point.runs])).toEqual([
    [0, 0],
    [5 / 6, 8],
    [5 / 6, 13],
  ]);
  expect(wormModel(innings, 4)[1]?.x).toBe(1.25);
});
it("keeps actual five-ball completed overs and reconciles separate adjustments", () => {
  const model = manhattanModel(innings);
  expect(model.bars[0]).toMatchObject({ legalBalls: 5, complete: true, runs: 8, wickets: 1 });
  expect(model.total).toBe(13);
  expect(model.adjustments[0]).toMatchObject({ subsequent: true, runs: 5 });
  const firstOver = innings.overs[0];
  if (!firstOver) throw new Error("Expected an over");
  expect(
    manhattanModel({ ...innings, overs: [{ ...firstOver, complete: false }] }).bars[0]?.label,
  ).toContain("partial");
});

it("keeps coincident fours and sixes visible without changing recorded angles", () => {
  const shots = wagonModel({
    ...innings,
    shots: [
      { seq: 1, batterId: "a", angle: 67, runs: 4, boundary: 4 },
      { seq: 2, batterId: "a", angle: 67, runs: 6, boundary: 6 },
      { seq: 3, batterId: "a", angle: 67, runs: 6, boundary: 6 },
    ],
  });
  expect(shots.map((shot) => [shot.seq, shot.category, shot.angle, shot.radius])).toEqual([
    [2, "six", 67, 90],
    [3, "six", 67, 90],
    [1, "four", 67, 78],
  ]);
  expect(shots.reduce((sum, shot) => sum + shot.runs, 0)).toBe(16);
});
