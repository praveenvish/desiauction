import { describe, expect, it } from "vitest";

import { seasonJourney, type SeasonJourneyInput } from "./season-journey";

const BASE: SeasonJourneyInput = {
  status: "draft",
  teams: 0,
  registrations: 0,
  auctionStatus: null,
  settlement: null,
};

const states = (input: SeasonJourneyInput, withTeams = true) =>
  seasonJourney(input, { withTeams }).map((step) => `${step.key}:${step.state}`);

describe("a season's road, derived", () => {
  it("a fresh draft is on its first step and nothing is done", () => {
    expect(states(BASE)).toEqual([
      "setup:current",
      "teams:upcoming",
      "registration:upcoming",
      "auction:upcoming",
      "settlement:upcoming",
    ]);
  });

  it("open registration with teams is current, and says how many registered", () => {
    const steps = seasonJourney(
      { ...BASE, status: "registration_open", teams: 4, registrations: 12 },
      { withTeams: true },
    );
    expect(steps.map((step) => step.state)).toEqual([
      "done",
      "done",
      "current",
      "upcoming",
      "upcoming",
    ]);
    expect(steps[2]?.hint).toBe("Open · 12 registered");
  });

  it("a live auction is the current step, labelled Live", () => {
    const steps = seasonJourney(
      { ...BASE, status: "registration_closed", teams: 4, auctionStatus: "live" },
      { withTeams: false },
    );
    expect(steps.map((step) => step.key)).toEqual([
      "setup",
      "registration",
      "auction",
      "settlement",
    ]);
    expect(steps[2]).toMatchObject({ state: "current", hint: "Live", label: "Auction night" });
  });

  it("a settling case proves the auction ran and leaves settlement current", () => {
    expect(
      states({ ...BASE, status: "registration_closed", teams: 4, settlement: "settling" }, false),
    ).toEqual(["setup:done", "registration:done", "auction:done", "settlement:current"]);
  });

  it("settled books finish the road; a voided case never happened", () => {
    expect(states({ ...BASE, status: "registration_closed", settlement: "closed" }, false)).toEqual(
      ["setup:done", "registration:done", "auction:done", "settlement:done"],
    );
    expect(
      states({ ...BASE, status: "registration_closed", teams: 2, settlement: "voided" }, false),
    ).toEqual(["setup:done", "registration:done", "auction:current", "settlement:upcoming"]);
  });

  it("the four-stage row folds teams into set up", () => {
    expect(states({ ...BASE, status: "registration_open", teams: 0 }, false)[0]).toBe(
      "setup:current",
    );
  });
});
