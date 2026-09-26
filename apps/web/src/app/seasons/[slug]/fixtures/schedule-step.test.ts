import { describe, expect, it } from "vitest";

import { pairingTeams, scheduleStep } from "./schedule-step";

const base = { slug: "s", orgSlug: "o", teams: 4, grounds: 1, canManage: true };

describe("the empty schedule's next step", () => {
  it("points at the venue when the club has no ground", () => {
    expect(scheduleStep({ ...base, grounds: 0 })).toMatchObject({
      label: "Add a venue",
      href: "/org/o/venues",
    });
  });

  it("asks for teams before grounds", () => {
    expect(scheduleStep({ ...base, teams: 1, grounds: 0 }).label).toBe("Add teams");
  });

  it("builds the schedule when both are in place, or for a reader who cannot manage", () => {
    expect(scheduleStep(base).label).toBe("Build the schedule");
    expect(scheduleStep({ ...base, grounds: 0, canManage: false }).href).toBe(
      "/seasons/s/fixtures",
    );
  });
});

describe("pairingTeams", () => {
  const teams = ["Mumbai Mavericks", "Pune Panthers", "Thane Tuskers"];

  it("pairs every team of a duel sport", () => {
    expect(pairingTeams("duel", teams)).toEqual(teams);
    expect(pairingTeams(undefined, teams)).toEqual(teams);
  });

  it("offers no pairings for a lobby sport, where every squad plays every lobby", () => {
    expect(pairingTeams("lobby", teams)).toEqual([]);
  });
});
