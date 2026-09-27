import { describe, expect, it } from "vitest";

import { nowRows, resultWords } from "./season-now-model";

const f = (id: string, kickoffAt: string, status: string) => ({
  id,
  kickoffAt,
  status,
  homeTeamName: "Home",
  awayTeamName: "Away",
});

describe("nowRows", () => {
  const rows = [
    f("a", "2026-09-26T09:30", "completed"),
    f("b", "2026-09-27T09:30", "completed"),
    f("c", "2026-09-27T14:30", "in_progress"),
    f("d", "2026-09-28T09:30", "published"),
    f("e", "2026-09-28T14:30", "published"),
    f("g", "2026-09-29T09:30", "published"),
    f("h", "2026-09-26T08:00", "draft"),
  ];

  it("lists what is live, the next two, then the latest result", () => {
    const out = nowRows(rows, "2026-09-27T15:00", () => true);
    expect(out.map((row) => [row.fixture.id, row.state])).toEqual([
      ["c", "live"],
      ["d", "next"],
      ["e", "next"],
      ["b", "result"],
    ]);
  });

  it("skips a finished match nobody has scored", () => {
    const out = nowRows(rows, "2026-09-27T15:00", (id) => id === "a");
    expect(out.at(-1)).toMatchObject({ fixture: { id: "a" }, state: "result" });
  });

  it("never offers a past, unplayed kickoff as next", () => {
    const out = nowRows([f("x", "2026-09-20T09:00", "published")], "2026-09-27T15:00", () => true);
    expect(out).toEqual([]);
  });
});

describe("resultWords", () => {
  it("names the winner", () => {
    expect(resultWords("home_win", "Mavericks", "Panthers")).toBe("Mavericks won");
    expect(resultWords("away_win", "Mavericks", "Panthers")).toBe("Panthers won");
    expect(resultWords("tie", null, null)).toBe("Tied");
  });
});
