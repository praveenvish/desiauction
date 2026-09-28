import { describe, expect, it } from "vitest";

import {
  anyLineupRecorded,
  clubsOf,
  liveStage,
  matchRecord,
  profileAsk,
  recentForm,
  seasonRecordLine,
  soldOf,
} from "./me-model";

describe("profileAsk", () => {
  it("names the first two things worth adding and counts the rest", () => {
    expect(profileAsk(["passkey", "photo", "email", "style", "location", "date_of_birth"])).toBe(
      "Add a photo, your playing style and 4 more",
    );
  });

  it("names one or two without a count", () => {
    expect(profileAsk(["passkey"])).toBe("Add a passkey");
    expect(profileAsk(["email", "photo"])).toBe("Add a photo and a verified email");
  });

  it("is null when the profile is complete", () => {
    expect(profileAsk([])).toBeNull();
  });
});

describe("matchRecord / anyLineupRecorded", () => {
  it("counts finished results only", () => {
    expect(
      matchRecord([{ result: "won" }, { result: "lost" }, { result: null }, { result: "won" }]),
    ).toEqual({ played: 3, won: 2, lost: 1, tied: 0 });
  });

  it("draws the You column only once a lineup says something", () => {
    expect(anyLineupRecorded([{ played: "unknown" }, { played: "unknown" }])).toBe(false);
    expect(anyLineupRecorded([{ played: "unknown" }, { played: "bench" }])).toBe(true);
  });
});

describe("liveStage", () => {
  const base = {
    status: "approved",
    auction: null,
    teamName: null,
    endsOn: "2026-12-31",
    startsOn: "2026-09-01",
    auctionStatus: "scheduled",
  } as const;
  const today = "2026-09-28";

  it("puts a waiting registration on the first step", () => {
    expect(liveStage({ ...base, status: "submitted" }, today)).toEqual({ at: 0, kind: "waiting" });
  });

  it("puts an approved player with no team in the pool, or in a live auction", () => {
    expect(liveStage(base, today)).toEqual({ at: 2, kind: "pool" });
    expect(liveStage({ ...base, auctionStatus: "live" }, today)).toEqual({
      at: 2,
      kind: "auction_live",
    });
  });

  it("puts a sold or pre-signed player in their season", () => {
    expect(
      liveStage({ ...base, auction: { kind: "sold", soldPrice: 100 }, teamName: "A" }, today),
    ).toEqual({ at: 3, kind: "season" });
    expect(liveStage({ ...base, auction: { kind: "captain" } }, today)).toEqual({
      at: 3,
      kind: "season",
    });
  });

  it("drops a season that is over for the player", () => {
    expect(liveStage({ ...base, auction: { kind: "unsold" } }, today)).toBeNull();
    expect(liveStage({ ...base, status: "rejected" }, today)).toBeNull();
    expect(liveStage({ ...base, endsOn: "2026-09-27" }, today)).toBeNull();
    // No end date: over a year after it started.
    expect(liveStage({ ...base, endsOn: null, startsOn: "2025-09-01" }, today)).toBeNull();
    expect(liveStage({ ...base, endsOn: null, startsOn: "2026-01-01" }, today)).toEqual({
      at: 2,
      kind: "pool",
    });
  });
});

describe("clubsOf", () => {
  it("counts seasons per club, most first", () => {
    expect(clubsOf([{ orgName: "B" }, { orgName: "A" }, { orgName: "A" }])).toEqual([
      { name: "A", seasons: 2 },
      { name: "B", seasons: 1 },
    ]);
  });
});

describe("recentForm", () => {
  it("reads the newest finished results, oldest first, skipping unfinished ones", () => {
    const newestFirst = [
      { result: null },
      { result: "won" },
      { result: "lost" },
      { result: "no_result" },
      { result: "tied" },
      { result: "won" },
      { result: "won" },
      { result: "lost" },
    ] as const;
    expect(recentForm(newestFirst)).toEqual(["W", "W", "T", "L", "W"]);
  });
});

describe("seasonRecordLine", () => {
  it("says one season's record, or nothing before its first result", () => {
    const matches = [
      { registrationId: "r1", result: "won" },
      { registrationId: "r1", result: "lost" },
      { registrationId: "r2", result: "won" },
    ] as const;
    expect(seasonRecordLine(matches, "r1")).toBe("2 played · 1 won");
    expect(seasonRecordLine(matches, "r3")).toBeNull();
  });
});

describe("soldOf", () => {
  it("counts sold nights out of the nights under the hammer", () => {
    expect(
      soldOf([
        { auction: { kind: "sold", soldPrice: 1 } },
        { auction: { kind: "unsold" } },
        { auction: { kind: "icon" } },
        { auction: null },
      ]),
    ).toEqual({ sold: 1, auctioned: 2 });
  });
});
