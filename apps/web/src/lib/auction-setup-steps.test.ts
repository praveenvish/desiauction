import { describe, expect, it } from "vitest";

import { ownerStageOf, setupSteps, type SetupFacts } from "./auction-setup-steps";

const READY = [
  { id: "intake_closed", pass: true },
  { id: "pool_present", pass: true },
  { id: "teams_present", pass: true },
];

function facts(overrides: Partial<SetupFacts> = {}): SetupFacts {
  return {
    checks: READY,
    poolSize: 20,
    teamCount: 4,
    auctionStatus: null,
    claimedTeams: 0,
    counts: null,
    ...overrides,
  };
}

const stateOf = (f: SetupFacts) =>
  Object.fromEntries(setupSteps(f).map((step) => [step.id, step.state]));

describe("the setup checklist follows the season, not a stored flag", () => {
  it("starts at players while registration is still open", () => {
    const steps = setupSteps(
      facts({ checks: [{ id: "intake_closed", pass: false }, ...READY.slice(1)] }),
    );
    expect(steps[0]).toMatchObject({ id: "players", state: "current" });
    expect(steps[0]?.summary).toContain("Close registration");
    expect(steps.slice(1).every((step) => step.state === "upcoming")).toBe(true);
  });

  it("moves to rules once the pool is locked", () => {
    expect(stateOf(facts())).toEqual({
      players: "done",
      rules: "current",
      owners: "upcoming",
      lots: "upcoming",
      live: "upcoming",
    });
  });

  it("opens owners AND lots together once the auction exists", () => {
    expect(
      stateOf(facts({ auctionStatus: "scheduled", counts: { queued: 0, prepared: 20 } })),
    ).toEqual({
      players: "done",
      rules: "done",
      owners: "current",
      lots: "current",
      live: "upcoming",
    });
  });

  it("offers go-live only when two teams can bid and the lots are queued", () => {
    const ready = facts({
      auctionStatus: "scheduled",
      claimedTeams: 2,
      counts: { queued: 20, prepared: 0 },
    });
    expect(stateOf(ready).live).toBe("current");
    expect(stateOf({ ...ready, claimedTeams: 1 }).live).toBe("upcoming");
    expect(stateOf({ ...ready, counts: { queued: 12, prepared: 8 } }).live).toBe("upcoming");
  });

  it("an abandoned auction is a season with no auction — back to rules", () => {
    expect(stateOf(facts({ auctionStatus: "abandoned" })).rules).toBe("current");
  });
});

describe("where each team stands", () => {
  const claimed = new Set<string>();
  it("walks invite → accepted → granted → claimed", () => {
    expect(ownerStageOf("t1", [], [], claimed)).toEqual({ stage: "none" });
    const invite = { id: "i1", teamId: "t1", acceptedBy: null, expired: false };
    expect(ownerStageOf("t1", [invite], [], claimed)).toEqual({ stage: "invited", inviteId: "i1" });
    const accepted = { ...invite, acceptedBy: "p1" };
    expect(ownerStageOf("t1", [accepted], [], claimed)).toEqual({
      stage: "accepted",
      inviteId: "i1",
      personId: "p1",
    });
    const grant = { teamId: "t1", personId: "p1", claimed: false };
    expect(ownerStageOf("t1", [accepted], [grant], claimed).stage).toBe("granted");
    expect(ownerStageOf("t1", [accepted], [{ ...grant, claimed: true }], claimed).stage).toBe(
      "claimed",
    );
  });

  it("prefers a live link over an expired one, and says when only an expired one is left", () => {
    const old = { id: "i1", teamId: "t1", acceptedBy: null, expired: true };
    const fresh = { id: "i2", teamId: "t1", acceptedBy: null, expired: false };
    expect(ownerStageOf("t1", [old, fresh], [], claimed)).toEqual({
      stage: "invited",
      inviteId: "i2",
    });
    expect(ownerStageOf("t1", [old], [], claimed)).toEqual({ stage: "expired", inviteId: "i1" });
  });

  it("counts a paddle claimed without the invite path", () => {
    expect(ownerStageOf("t1", [], [], new Set(["t1"])).stage).toBe("claimed");
  });
});
