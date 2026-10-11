import { expect, it } from "vitest";
import { dismissalText, scoringRate } from "./scorecard-model";
import type { PublicScorecard } from "@desiauction/core/scoring";
type Batter = PublicScorecard["innings"][number]["batting"][number];
const line: Batter = {
  id: "batter",
  name: "Batter",
  initials: "B",
  runs: 41,
  balls: 27,
  fours: 4,
  sixes: 2,
  dismissal: "caught",
  notOut: false,
  retiredHurt: false,
};
it("derives strike rate and economy using canonical legal balls, including four-ball overs", () => {
  expect(scoringRate(41, 27, 100, 1)).toBe("151.9");
  expect(scoringRate(17, 15, 6, 2)).toBe("6.80");
  expect(scoringRate(17, 15, 4, 2)).toBe("4.53");
  expect(scoringRate(0, 0, 100, 1)).toBe("—");
});
it("renders sanitized participant attribution and unknown/substitute fielders honestly", () => {
  const attribution = {
    bowler: { id: "bowler", name: "Ravi", initials: "R" },
    fielders: [{ id: "minor", name: "A Y", initials: "AY", substitute: true }],
    unknownFielders: 1,
  };
  expect(dismissalText({ ...line, attribution })).toBe("c A Y (sub) / Unknown fielder b Ravi");
  expect(dismissalText({ ...line, attribution, dismissal: "caught_and_bowled" })).toBe(
    "c & b Ravi",
  );
  expect(dismissalText({ ...line, attribution, dismissal: "stumped" })).toBe(
    "st A Y (sub) / Unknown fielder b Ravi",
  );
  expect(
    dismissalText({ ...line, attribution: { ...attribution, bowler: null }, dismissal: "run_out" }),
  ).toBe("Run out (A Y (sub) / Unknown fielder)");
  expect(dismissalText({ ...line, notOut: true })).toBe("Not out");
  expect(dismissalText({ ...line, retiredHurt: true })).toBe("Retired hurt");
  expect(dismissalText({ ...line, dismissal: "timed_out" })).toBe("timed out");
});
