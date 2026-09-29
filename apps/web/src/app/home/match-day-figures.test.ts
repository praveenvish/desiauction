import { describe, expect, it } from "vitest";

import { matchDayFigures } from "./match-day-figures";

const record = { won: 2, lost: 0, played: 2 };

describe("matchDayFigures", () => {
  it("counts the days to kickoff and waits on the lineup", () => {
    const figures = matchDayFigures({
      next: { kickoffAt: "2026-10-04T15:00", announcedIn: false, time: "3:00 pm" },
      last: { result: "won", opponentName: "Pune Panthers" },
      record,
      today: "2026-09-29",
    });
    expect(figures.map((f) => [f.key, f.value, f.label])).toEqual([
      ["kickoff", "5 days", "to kickoff"],
      ["lineup", "Awaited", "lineup"],
      ["last", "Won", "last result · vs Pune Panthers"],
      ["record", "2 – 0", "won – lost"],
    ]);
  });

  it("says today and tomorrow with the time, and a place in the lineup", () => {
    const today = matchDayFigures({
      next: { kickoffAt: "2026-10-04T15:00", announcedIn: true, time: "3:00 pm" },
      last: undefined,
      record: { won: 0, lost: 0, played: 0 },
      today: "2026-10-04",
    });
    expect(today.map((f) => [f.key, f.value, f.label, f.tone])).toEqual([
      ["kickoff", "Today", "3:00 pm kickoff", undefined],
      ["lineup", "You're in", "lineup announced", "good"],
    ]);
    const tomorrow = matchDayFigures({
      next: { kickoffAt: "2026-10-04", announcedIn: false, time: null },
      last: { result: "lost", opponentName: "Thane Tuskers" },
      record: { won: 0, lost: 1, played: 1 },
      today: "2026-10-03",
    });
    expect(tomorrow[0]).toEqual({ key: "kickoff", value: "Tomorrow", label: "kickoff" });
    expect(tomorrow[2]?.tone).toBe("bad");
  });

  it("has no kickoff or lineup without a next match", () => {
    expect(
      matchDayFigures({ next: undefined, last: undefined, record, today: "2026-09-29" }).map(
        (f) => f.key,
      ),
    ).toEqual(["record"]);
  });
});
