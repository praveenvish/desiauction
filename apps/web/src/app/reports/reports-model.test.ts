import { describe, expect, it } from "vitest";

import { auctionStage, registrationStage, resultSentence, seasonStage } from "./reports-model";

describe("stages", () => {
  it("reads registration from the season's status", () => {
    expect(registrationStage("registration_closed", 43)).toMatchObject({
      state: "Closed",
      tone: "done",
    });
    expect(registrationStage("registration_open", 5)).toMatchObject({ state: "Open", tone: "now" });
    expect(registrationStage("setup", 0)).toMatchObject({ state: "Not open yet", tone: "next" });
  });

  it("reads the auction, with sold of the whole pool as its bar", () => {
    expect(auctionStage("completed", 30, 7, 0)).toMatchObject({
      state: "Done",
      tone: "done",
      pct: 81,
    });
    expect(auctionStage("paused", 10, 0, 30)).toMatchObject({
      state: "Paused",
      tone: "now",
      pct: 25,
    });
    expect(auctionStage(null, 0, 0, 0)).toMatchObject({
      state: "Not set up",
      tone: "next",
      pct: 0,
    });
  });

  it("reads the season from its matches", () => {
    expect(seasonStage({ played: 3, live: 1, toCome: 3 })).toMatchObject({
      state: "Playing",
      pct: 43,
    });
    expect(seasonStage({ played: 7, live: 0, toCome: 0 })).toMatchObject({
      state: "Finished",
      tone: "done",
    });
    expect(seasonStage({ played: 0, live: 0, toCome: 5 })).toMatchObject({ state: "Fixtures out" });
    expect(seasonStage({ played: 0, live: 0, toCome: 0 })).toMatchObject({
      state: "No fixtures yet",
      tone: "next",
    });
  });
});

describe("resultSentence", () => {
  const match = { fixtureId: "f", kickoffAt: null, homeName: "Mumbai", awayName: "Pune" };
  it("names the winner first", () => {
    expect(resultSentence({ ...match, outcome: "home_win" })).toEqual({
      lead: "Mumbai",
      rest: " beat Pune",
    });
    expect(resultSentence({ ...match, outcome: "away_win" })).toEqual({
      lead: "Pune",
      rest: " beat Mumbai",
    });
  });

  it("says a tie, an abandoned match and a live one plainly", () => {
    expect(resultSentence({ ...match, outcome: "tie" }).rest).toBe("Mumbai and Pune tied");
    expect(resultSentence({ ...match, outcome: "abandoned" }).rest).toContain("abandoned");
    expect(resultSentence({ ...match, outcome: null }).rest).toBe("Mumbai vs Pune");
  });
});
