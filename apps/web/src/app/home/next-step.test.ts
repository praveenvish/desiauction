import { describe, expect, it } from "vitest";

import { chooseNextStep, type NextStepInput } from "./next-step";

const EMPTY: NextStepInput = {
  ownedTeam: null,
  managedLive: null,
  attention: [],
  latestEntry: null,
  brandNew: false,
};
const team = (auctionStatus: string) => ({
  teamName: "Cup Kings",
  competitionSlug: "demo-cup",
  competitionName: "Demo Cup",
  auctionStatus,
});

describe("the one next step /home leads with", () => {
  it("an owner whose auction is live goes straight to the room — above everything else", () => {
    const step = chooseNextStep({
      ...EMPTY,
      ownedTeam: team("live"),
      managedLive: { competitionSlug: "other", competitionName: "Other" },
      attention: [{ label: "2 registrations to review", detail: "PL", href: "/x" }],
    });
    expect(step?.key).toBe("owner-live");
    expect(step?.cta.href).toBe("/seasons/demo-cup/auction/live");
    expect(step?.tone).toBe("live");
  });

  it("an organizer's live night outranks their to-do list", () => {
    const step = chooseNextStep({
      ...EMPTY,
      managedLive: { competitionSlug: "pl", competitionName: "PL" },
      attention: [{ label: "2 registrations to review", detail: "PL", href: "/x" }],
    });
    expect(step?.key).toBe("organizer-live");
  });

  it("otherwise the first thing waiting on an organizer, and says how many more", () => {
    const step = chooseNextStep({
      ...EMPTY,
      attention: [
        {
          label: "2 registrations to review",
          detail: "Demo PL",
          href: "/seasons/pl/registrations",
        },
        { label: "Add teams", detail: "Demo Cup", href: "/seasons/cup/teams" },
      ],
    });
    expect(step?.title).toBe("2 registrations to review");
    expect(step?.cta.href).toBe("/seasons/pl/registrations");
    expect(step?.cta.label).toBe("Review now");
    expect(step?.why).toContain("1 more thing is waiting");
  });

  it("an owner before the auction is sent to their plan", () => {
    expect(chooseNextStep({ ...EMPTY, ownedTeam: team("scheduled") })?.cta.href).toBe(
      "/seasons/demo-cup/auction/plan",
    );
  });

  it("an owner whose auction is over has no banner from the team", () => {
    expect(chooseNextStep({ ...EMPTY, ownedTeam: team("completed") })).toBeNull();
  });

  it("a player waiting on approval is told so, and nothing organizer-shaped", () => {
    const step = chooseNextStep({
      ...EMPTY,
      latestEntry: { competitionName: "Monsoon Cup", status: "submitted" },
    });
    expect(step?.key).toBe("player-waiting");
    expect(step?.cta.href).toBe("/me");
  });

  it("a brand-new account chooses a path instead of being handed a club ladder", () => {
    const step = chooseNextStep({ ...EMPTY, brandNew: true });
    expect(step?.key).toBe("choose-path");
    expect(step?.createClub).toBe(true);
    expect(step?.secondary?.href).toBe("/c");
  });

  it("someone with nothing waiting gets no banner rather than a filler one", () => {
    expect(chooseNextStep(EMPTY)).toBeNull();
  });
});
