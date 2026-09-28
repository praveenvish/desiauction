import { describe, expect, it } from "vitest";

import { captainOf, preSigned, roleMix, setupSteps } from "./teams-model";

const ROLES = [
  { key: "batter", label: "Batter" },
  { key: "bowler", label: "Bowler" },
  { key: "all_rounder", label: "All-rounder" },
];

describe("roleMix", () => {
  it("counts roles in the pack's order and drops the empty ones", () => {
    expect(
      roleMix([{ role: "bowler" }, { role: "batter" }, { role: "bowler" }, { role: null }], ROLES),
    ).toEqual([
      { key: "batter", label: "Batter", count: 1, slot: 0 },
      { key: "bowler", label: "Bowler", count: 2, slot: 1 },
    ]);
  });

  it("keeps a role the pack doesn't know, after the known ones", () => {
    expect(roleMix([{ role: "libero" }, { role: "batter" }], ROLES)).toEqual([
      { key: "batter", label: "Batter", count: 1, slot: 0 },
      { key: "libero", label: "libero", count: 1, slot: 3 },
    ]);
  });
});

describe("captainOf and preSigned", () => {
  const roster = [
    { name: "A", isCaptain: false, isIcon: false, isRetained: true },
    { name: "B", isCaptain: false, isIcon: true, isRetained: false },
    { name: "C", isCaptain: true, isIcon: false, isRetained: false },
    { name: "D", isCaptain: false, isIcon: false, isRetained: false },
  ];

  it("finds the captain", () => {
    expect(captainOf(roster)?.name).toBe("C");
    expect(captainOf([])).toBeNull();
  });

  it("lists the pre-signed captain first, then icons, then retained", () => {
    expect(preSigned(roster).map((row) => row.name)).toEqual(["C", "B", "A"]);
  });
});

describe("setupSteps", () => {
  it("says the owner waits for the auction, and offers Pick for the captain", () => {
    const steps = setupSteps({ ownerName: null, coachName: null }, null, false, true);
    expect(steps.map((step) => [step.label, step.action?.label ?? null])).toEqual([
      ["Owner — invited once the auction exists", null],
      ["Captain", "Pick"],
      ["Coach (optional)", "Add"],
    ]);
  });

  it("offers Invite once the auction exists, and states what is done", () => {
    const steps = setupSteps({ ownerName: null, coachName: "Anil" }, { name: "Rahul" }, true, true);
    expect(steps.map((step) => [step.done, step.label, step.action?.label ?? null])).toEqual([
      [false, "Owner", "Invite"],
      [true, "Captain · Rahul", null],
      [true, "Coach · Anil", null],
    ]);
  });

  it("offers nothing to someone who can't manage the team", () => {
    const steps = setupSteps({ ownerName: null, coachName: null }, null, true, false);
    expect(steps.every((step) => step.action === null)).toBe(true);
  });
});
