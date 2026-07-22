import { describe, expect, it } from "vitest";

import { OUTCOME_ACTIONS, summarizeOutcomes } from "./outcomes";

describe("summarizeOutcomes", () => {
  it("maps grouped action counts onto named metrics", () => {
    const m = summarizeOutcomes({
      windowDays: 30,
      actionCounts: [
        { action: "competition.created", count: 10 },
        { action: "competition.cloned", count: 3 },
        { action: "team.created", count: 40 },
        { action: "registration.submitted", count: 120 },
        { action: "registration.team_assigned", count: 88 },
      ],
      orgCompetitionCounts: [3, 1, 1],
    });
    expect(m).toMatchObject({
      windowDays: 30,
      competitionsCreated: 10,
      competitionsCloned: 3,
      teamsCreated: 40,
      registrationsSubmitted: 120,
      playersAssigned: 88,
    });
  });

  it("computes repeat-org rate from per-org creation counts", () => {
    // 4 orgs created; 2 of them created ≥2 → 0.5 repeat rate.
    const m = summarizeOutcomes({
      windowDays: 30,
      actionCounts: [],
      orgCompetitionCounts: [5, 2, 1, 1],
    });
    expect(m.orgsCreating).toBe(4);
    expect(m.orgsRepeating).toBe(2);
    expect(m.repeatOrgRate).toBe(0.5);
  });

  it("computes clone adoption as clones over creations", () => {
    const m = summarizeOutcomes({
      windowDays: 30,
      actionCounts: [
        { action: "competition.created", count: 8 },
        { action: "competition.cloned", count: 2 },
      ],
      orgCompetitionCounts: [8],
    });
    expect(m.cloneAdoptionRate).toBe(0.25);
  });

  it("never divides by zero — empty input yields all-zero metrics", () => {
    const m = summarizeOutcomes({ windowDays: 7, actionCounts: [], orgCompetitionCounts: [] });
    expect(m.repeatOrgRate).toBe(0);
    expect(m.cloneAdoptionRate).toBe(0);
    expect(m.orgsCreating).toBe(0);
    expect(m.competitionsCreated).toBe(0);
  });

  it("ignores unknown actions and floors negative/fractional counts", () => {
    const m = summarizeOutcomes({
      windowDays: 30,
      actionCounts: [
        { action: "auction.owner_join", count: 99 },
        { action: "competition.created", count: 4.9 },
      ],
      orgCompetitionCounts: [4],
    });
    expect(m.competitionsCreated).toBe(4);
    // The unknown action does not leak into any field.
    expect(m.teamsCreated).toBe(0);
  });

  it("exposes exactly the five audit actions it aggregates", () => {
    expect(OUTCOME_ACTIONS).toContain("competition.cloned");
    expect(OUTCOME_ACTIONS).toHaveLength(5);
  });
});
