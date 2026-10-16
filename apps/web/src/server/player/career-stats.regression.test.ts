import { initialState, playerLines, type InningsState } from "@desiauction/core/scoring";
import { describe, expect, it } from "vitest";
import { aggregateCareer, careerProjectionEligible, type CareerPerformance } from "./career-stats";
function required<T>(value: T | null | undefined): T {
  if (value == null) throw new Error("Required test fixture");
  return value;
}
const performance = (
  id: string,
  format: string,
  ball: string,
  trust: CareerPerformance["trust"],
  runs: number,
): CareerPerformance => ({
  fixtureId: id,
  registrationId: `registration-${id}`,
  opponent: null,
  format,
  ball,
  trust,
  date: "2026-10-09",
  label: id,
  href: "/",
  line: {
    registrationId: `registration-${id}`,
    teamId: "team",
    appeared: true,
    batting: {
      runs,
      balls: 30,
      fours: 2,
      sixes: 1,
      out: true,
      howOut: "bowled",
      position: 1,
      notOut: false,
      retiredHurt: false,
    },
    bowling: { legalBalls: 30, maiden: 0, runs: 20, wickets: 2, dots: 10, wides: 0, noBalls: 0 },
  },
});
describe("C37 career projection", () => {
  it("aggregates canonical normal innings without super-over runs or wickets", () => {
    const state = initialState();
    const normal = performance("normal", "t10", "tennis", "confirmed", 20).line;
    const innings: InningsState = {
      no: 1,
      superOver: false,
      battingTeamId: "team",
      bowlingTeamId: "other",
      batters: { player: required(normal.batting) },
      bowlers: {},
      overs: [],
      scoreTrace: [],
      miscountedOvers: {},
      completedOvers: 0,
      ballsInOver: 0,
      targetMethod: null,
      runs: 20,
      wickets: 1,
      legalBalls: 30,
      maxBalls: 60,
      target: null,
      extras: { wides: 0, noBalls: 0, byes: 0, legByes: 0, penalty: 0 },
      strikerId: null,
      nonStrikerId: null,
      bowlerId: null,
      battedOrder: ["player"],
      outIds: ["player"],
      retiredHurt: [],
      absentBatterIds: [],
      fallOfWickets: [],
      freeHitNext: false,
      closed: "overs",
      lastBowlerOfPreviousOver: null,
      conditionsAtBall: {},
      retirePromptDue: null,
    };
    state.innings = [
      innings,
      {
        ...innings,
        no: 3,
        superOver: true,
        batters: { player: { ...required(normal.batting), runs: 100 } },
        bowlers: { bowler: required(normal.bowling) },
      },
    ];
    const line = required(playerLines(state).get("player"));
    const totals = required(
      aggregateCareer([{ ...performance("normal", "t10", "tennis", "confirmed", 20), line }])[0],
    );
    expect(totals.runs).toBe(20);
    expect(totals.wickets).toBe(0);
    expect(totals.matches).toBe(1);
  });

  it("groups frozen formats and ball conditions without mixing totals", () => {
    const rows = aggregateCareer([
      performance("a", "t20", "leather", "verified", 40),
      performance("b", "t10", "tennis", "confirmed", 20),
    ]);
    expect(rows.find((row) => row.key === "all")?.runs).toBe(60);
    expect(rows.find((row) => row.key === "format:t20")?.runs).toBe(40);
    expect(rows.find((row) => row.key === "ball:tennis")?.runs).toBe(20);
    expect(rows.find((row) => row.key === "ball:leather")?.wickets).toBe(2);
  });
  it("all-trust totals do not certify trusted metrics", () => {
    const trusted = [
      performance("a", "t20", "leather", "verified", 40),
      performance("b", "t20", "leather", "confirmed", 20),
    ];
    const before = required(aggregateCareer(trusted)[0]);
    const after = required(
      aggregateCareer([...trusted, performance("c", "t20", "leather", "self_scored", 100)])[0],
    );
    expect(after.runs).toBe(160);
    expect(after.strikeRate).not.toBe(before.strikeRate);
    expect(after.trusted).toEqual(before.trusted);
    expect(after.trusted?.strikeRate).toEqual({ value: 100, qualified: true, remaining: 0 });
    expect(after.trusted?.average.qualified).toBe(false);
  });
  it("withholds corrected public projection until exact delay cutoff", () => {
    const now = new Date("2026-10-09T10:00:00Z");
    const rules = { publicDelaySeconds: 60 };
    expect(
      careerProjectionEligible("self_scored", new Date(now.getTime() - 59999), rules, now),
    ).toBe(false);
    expect(careerProjectionEligible("confirmed", new Date(now.getTime() - 60000), rules, now)).toBe(
      true,
    );
    expect(careerProjectionEligible("verified", now, rules, now)).toBe(true);
    expect(careerProjectionEligible("verified", null, rules, now)).toBe(false);
  });
});
