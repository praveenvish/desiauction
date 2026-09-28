import { describe, expect, it } from "vitest";

import {
  groupByDay,
  isScored,
  lineupSummary,
  primaryScore,
  relativeDay,
  resultSentence,
  rowStep,
  suggestedOutcome,
  wallDay,
  type ModelFixture,
} from "./schedule-model";

const duel = (patch: Partial<ModelFixture> = {}): ModelFixture => ({
  id: "f1",
  number: "T-F001",
  status: "published",
  kickoffAt: "2026-09-28T09:30",
  homeTeamId: "mm",
  homeTeamName: "Mumbai Mavericks",
  awayTeamName: "Thane Tuskers",
  squadCount: 0,
  placedCount: 0,
  ...patch,
});
const lobby = (patch: Partial<ModelFixture> = {}): ModelFixture =>
  duel({ homeTeamId: null, homeTeamName: null, awayTeamName: null, squadCount: 4, ...patch });
const today = "2026-09-27";

describe("rowStep", () => {
  it("walks a match through its lifecycle, one step at a time", () => {
    expect(rowStep(duel({ status: "draft" }), { scored: false, today })).toMatchObject({
      action: "schedule",
    });
    expect(rowStep(duel({ status: "scheduled" }), { scored: false, today })).toMatchObject({
      action: "publish",
    });
    expect(
      rowStep(duel({ kickoffAt: "2026-09-27T14:30" }), {
        scored: false,
        today,
        lineups: { home: null, away: null },
      }),
    ).toMatchObject({ action: "start" });
  });

  it("asks for the score, not a start, once a published match's day has passed", () => {
    expect(
      rowStep(duel({ kickoffAt: "2026-09-01T14:30" }), { scored: false, today }),
    ).toMatchObject({ action: "start", label: "Enter score" });
  });

  it("asks for lineups before a match days away, and not once both are in", () => {
    expect(
      rowStep(duel(), { scored: false, today, lineups: { home: 11, away: null } }),
    ).toMatchObject({ kind: "lineups" });
    expect(
      rowStep(duel(), { scored: false, today, lineups: { home: 11, away: 11 } }),
    ).toMatchObject({ kind: "lifecycle", action: "start" });
  });

  it("never asks a lobby for lineups", () => {
    expect(rowStep(lobby(), { scored: false, today })).toMatchObject({ action: "start" });
  });

  it("asks for the score while playing and after, until it is in", () => {
    expect(rowStep(duel({ status: "in_progress" }), { scored: false, today })).toEqual({
      kind: "score",
      label: "Enter score",
      urgent: true,
    });
    expect(rowStep(lobby({ status: "completed" }), { scored: false, today })).toEqual({
      kind: "score",
      label: "Enter placings",
      urgent: false,
    });
    expect(rowStep(duel({ status: "completed" }), { scored: true, today })).toBeNull();
    expect(rowStep(duel({ status: "cancelled" }), { scored: false, today })).toBeNull();
  });
});

describe("isScored", () => {
  it("reads a duel's result row and a lobby's placings", () => {
    expect(isScored(duel(), { f1: { outcome: "home_win", score: null } })).toBe(true);
    expect(isScored(duel(), {})).toBe(false);
    expect(isScored(lobby({ placedCount: 3 }), {})).toBe(false);
    expect(isScored(lobby({ placedCount: 4 }), {})).toBe(true);
  });
});

describe("groupByDay", () => {
  it("groups by day in kickoff order and leaves undated matches out", () => {
    const groups = groupByDay([
      { id: "b", kickoffAt: "2026-09-28T14:30" },
      { id: "u", kickoffAt: null },
      { id: "a", kickoffAt: "2026-09-27T09:30" },
      { id: "c", kickoffAt: "2026-09-28T09:30" },
    ]);
    expect(groups.map((g) => [g.date, g.rows.map((r) => r.id)])).toEqual([
      ["2026-09-27", ["a"]],
      ["2026-09-28", ["c", "b"]],
    ]);
  });
});

describe("relativeDay", () => {
  it("names the days either side of today", () => {
    expect(relativeDay("2026-09-27", today)).toBe("Today");
    expect(relativeDay("2026-09-28", today)).toBe("Tomorrow");
    expect(relativeDay("2026-09-26", today)).toBe("Yesterday");
    expect(relativeDay("2026-10-01", today)).toBeNull();
  });
});

describe("scores and results", () => {
  it("reads the primary component, dashing a side never recorded", () => {
    expect(primaryScore({ runs: 189, wickets: 6 })).toBe("189");
    expect(primaryScore({ goals: 0 })).toBe("0");
    expect(primaryScore(undefined)).toBe("—");
  });

  it("says the result in words", () => {
    expect(resultSentence("away_win", "Thane Tuskers", "Mumbai Mavericks")).toBe(
      "Mumbai Mavericks won",
    );
    expect(resultSentence("no_result", "A", "B")).toBe("No result");
  });

  it("suggests the winner only from two whole scores", () => {
    expect(suggestedOutcome("172", "158")).toBe("home_win");
    expect(suggestedOutcome("141", "145")).toBe("away_win");
    expect(suggestedOutcome("150", "150")).toBe("tie");
    expect(suggestedOutcome("150", "")).toBeNull();
    expect(suggestedOutcome("15.3", "12")).toBeNull();
  });

  it("summarises lineups", () => {
    expect(lineupSummary({ home: 11, away: 11 }, "MM", "TT")).toBe("Lineups set");
    expect(lineupSummary({ home: null, away: 11 }, "MM", "TT")).toBe("Lineup: TT set · MM not yet");
    expect(lineupSummary({ home: null, away: null }, "MM", "TT")).toBe("Lineups not set");
  });
});

describe("wallDay", () => {
  it("names a day without touching time zones", () => {
    expect(wallDay("2026-09-27")).toEqual({ weekday: "Sun", date: "27 Sep", label: "Sun, 27 Sep" });
    expect(wallDay("2026-08-01", true).label).toBe("Sat, 1 Aug 2026");
  });
});
