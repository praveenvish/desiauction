import { describe, expect, it } from "vitest";

import { formOf, nextOf, type FormFixture } from "./standings-form";

const fixture = (
  id: string,
  home: string,
  away: string,
  kickoffAt: string | null,
  status: string,
): FormFixture => ({
  id,
  homeTeamId: home,
  awayTeamId: away,
  homeTeamName: home.toUpperCase(),
  awayTeamName: away.toUpperCase(),
  kickoffAt,
  status,
});

describe("formOf", () => {
  it("reads each result from both sides, oldest first", () => {
    const fixtures = [
      fixture("f3", "mm", "pp", "2026-09-27T09:30", "completed"),
      fixture("f1", "pp", "tt", "2026-09-20T09:30", "completed"),
      fixture("f2", "tt", "mm", "2026-09-21T09:30", "completed"),
    ];
    const outcomes = new Map([
      ["f1", "home_win"],
      ["f2", "away_win"],
      ["f3", "home_win"],
    ]);
    const form = formOf(fixtures, outcomes);
    expect(form.get("mm")).toEqual(["W", "W"]);
    expect(form.get("pp")).toEqual(["W", "L"]);
    expect(form.get("tt")).toEqual(["L", "L"]);
  });

  it("skips unscored, abandoned, unplayed and lobby matches, and keeps the last five", () => {
    const fixtures = [
      ...Array.from({ length: 6 }, (_, i) =>
        fixture(`t${String(i)}`, "a", "b", `2026-09-0${String(i + 1)}T10:00`, "completed"),
      ),
      fixture("x", "a", "b", "2026-09-10T10:00", "completed"),
      fixture("y", "a", "b", "2026-09-11T10:00", "published"),
      { ...fixture("z", "a", "b", "2026-09-12T10:00", "completed"), homeTeamId: null },
    ];
    const outcomes = new Map<string, string>([
      ["t0", "away_win"],
      ["t1", "home_win"],
      ["t2", "tie"],
      ["t3", "no_result"],
      ["t4", "abandoned"],
      ["t5", "home_win"],
      ["y", "home_win"],
      ["z", "home_win"],
    ]);
    expect(formOf(fixtures, outcomes).get("a")).toEqual(["L", "W", "T", "N", "W"]);
  });
});

describe("nextOf", () => {
  it("prefers the match being played, then the next dated one to come", () => {
    const fixtures = [
      fixture("done", "mm", "pp", "2026-09-27T09:30", "completed"),
      fixture("live", "tt", "pp", "2026-09-27T14:30", "in_progress"),
      fixture("mon", "mm", "tt", "2026-09-28T09:30", "published"),
      fixture("mon2", "pp", "mm", "2026-09-28T14:30", "published"),
      fixture("past", "mm", "pp", "2026-09-26T09:30", "published"),
    ];
    const next = nextOf(fixtures, "2026-09-27T15:00");
    expect(next.get("tt")).toEqual({
      fixtureId: "live",
      opponent: "PP",
      kickoffAt: "2026-09-27T14:30",
      live: true,
    });
    expect(next.get("pp")?.fixtureId).toBe("live");
    expect(next.get("mm")).toEqual({
      fixtureId: "mon",
      opponent: "TT",
      kickoffAt: "2026-09-28T09:30",
      live: false,
    });
  });

  it("keeps an unplayed match from earlier today as the next, not next week's", () => {
    // Census 2026-09-28: at 18:00 a team playing at 9:30 that morning (not
    // yet played) was shown "Sun, 4 Oct" — this minute was the cut-off.
    const fixtures = [
      fixture("morning", "mm", "tt", "2026-09-28T09:30", "published"),
      fixture("nextweek", "mm", "pp", "2026-10-04T15:00", "published"),
      fixture("yesterday", "mm", "pp", "2026-09-27T09:30", "published"),
    ];
    expect(nextOf(fixtures, "2026-09-28T18:00").get("mm")?.fixtureId).toBe("morning");
  });
});
