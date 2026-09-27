import { describe, expect, it } from "vitest";

import { initialsOf, needsYou, nextStep, seasonStage, type StageInput } from "./season-stage";

const today = "2026-09-27";
type Patch = Partial<Omit<StageInput, "counts">> & {
  startsOn?: string | null;
  counts?: Partial<StageInput["counts"]>;
};
const season = (patch: Patch = {}) => {
  const { counts, ...rest } = patch;
  return {
    slug: "tpl-2026",
    status: "draft",
    endsOn: null as string | null,
    startsOn: null as string | null,
    auctionUnit: "inr" as "inr" | "points",
    settlement: null as "settling" | "settled" | null,
    ...rest,
    counts: { teams: 0, matches: 0, pending: 0, ...counts },
  };
};

describe("seasonStage", () => {
  it("reads the latest fact first", () => {
    expect(seasonStage(season(), today)).toBe("setup");
    expect(seasonStage(season({ status: "setup" }), today)).toBe("setup");
    expect(seasonStage(season({ status: "registration_open" }), today)).toBe("registration");
    expect(seasonStage(season({ status: "registration_closed" }), today)).toBe("auction");
    // Registration closed, auction run: the season is ON, not "registration closed".
    expect(
      seasonStage(season({ status: "registration_closed", counts: { auctionDone: true } }), today),
    ).toBe("season");
    expect(seasonStage(season({ settlement: "settling" }), today)).toBe("season");
    expect(seasonStage(season({ settlement: "settled" }), today)).toBe("finished");
  });

  it("ends a points season with its dates, but not while a match is being played", () => {
    const points = { auctionUnit: "points" as const, endsOn: "2026-09-01" };
    expect(seasonStage(season({ ...points, counts: { auctionDone: true } }), today)).toBe(
      "finished",
    );
    expect(seasonStage(season({ ...points, counts: { auctionDone: true, live: 1 } }), today)).toBe(
      "season",
    );
    expect(
      seasonStage(
        season({ auctionUnit: "points", endsOn: "2026-11-25", counts: { auctionDone: true } }),
        today,
      ),
    ).toBe("season");
  });
});

describe("nextStep", () => {
  it("asks for the one thing each stage is waiting on", () => {
    expect(nextStep(season(), today)).toMatchObject({ label: "Finish setup", urgent: false });
    expect(
      nextStep(season({ status: "registration_open", counts: { pending: 2 } }), today),
    ).toMatchObject({ label: "Review 2", href: "/seasons/tpl-2026/registrations", urgent: true });
    expect(
      nextStep(season({ status: "registration_open", counts: { approved: 10 } }), today),
    ).toMatchObject({ label: "Registrations", why: "10 approved so far", urgent: false });
    expect(nextStep(season({ status: "registration_closed" }), today)).toMatchObject({
      href: "/seasons/tpl-2026/auction",
      urgent: true,
    });
  });

  it("follows the season once the squads are picked", () => {
    const on = { status: "registration_closed", counts: { auctionDone: true } };
    expect(nextStep(season(on), today)).toMatchObject({ label: "Build the schedule" });
    expect(
      nextStep(season({ ...on, counts: { auctionDone: true, matches: 6, live: 1 } }), today),
    ).toMatchObject({ label: "Enter score", why: "1 match is being played now", urgent: true });
    expect(
      nextStep(season({ ...on, counts: { auctionDone: true, matches: 6, played: 3 } }), today),
    ).toMatchObject({ label: "Schedule", why: "3 of 6 matches played", urgent: false });
    expect(nextStep(season({ settlement: "settled" }), today)).toBeNull();
  });
});

describe("needsYou", () => {
  it("puts a live match first, then what waits on a person, and leaves finished seasons out", () => {
    const list = [
      season({ slug: "quiet", status: "setup", startsOn: "2026-10-01" }),
      season({ slug: "done", settlement: "settled" }),
      season({ slug: "review", status: "registration_open", counts: { pending: 3 } }),
      season({ slug: "live", counts: { auctionDone: true, matches: 6, live: 1 } }),
    ];
    expect(needsYou(list, today).map((s) => s.slug)).toEqual(["live", "review", "quiet"]);
    expect(needsYou(list, today, 1)).toHaveLength(1);
  });
});

describe("initialsOf", () => {
  it("draws a crest from a name", () => {
    expect(initialsOf("TPL 2026")).toBe("T2");
    expect(initialsOf("Demo Premier League")).toBe("DP");
    expect(initialsOf("Thane")).toBe("TH");
  });
});
