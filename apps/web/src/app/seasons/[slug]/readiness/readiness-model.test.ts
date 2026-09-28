import { describe, expect, it } from "vitest";

import { readinessSteps, readinessTitle, shortfallSentence } from "./readiness-model";

const base = "/seasons/s";
const gate = (id: string, pass: boolean) => ({ id, label: id, pass });

describe("readinessSteps", () => {
  it("counts the missing auction as a step, and sends the organizer to the waiting first", () => {
    const steps = readinessSteps({
      checks: [
        gate("intake_closed", false),
        gate("pool_present", true),
        gate("teams_present", true),
      ],
      auctionCreated: false,
      pending: 2,
      base,
    });
    expect(steps.map((s) => s.label)).toEqual(["Close registration", "Create the auction"]);
    expect(steps[0]?.action).toEqual({
      label: "Review the 2 waiting",
      href: "/seasons/s/registrations?status=submitted",
    });
    expect(steps[0]?.detail).toContain("2 registrations are still waiting");
  });

  it("closes directly when nothing is waiting", () => {
    const [step] = readinessSteps({
      checks: [gate("intake_closed", false)],
      auctionCreated: true,
      pending: 0,
      base,
    });
    expect(step?.action.label).toBe("Close registration");
  });

  it("is empty when every gate passes and the auction exists", () => {
    expect(
      readinessSteps({
        checks: [gate("intake_closed", true)],
        auctionCreated: true,
        pending: 0,
        base,
      }),
    ).toEqual([]);
  });
});

describe("readinessTitle", () => {
  it("says how far auction night is", () => {
    expect(readinessTitle(0)).toBe("Ready for auction night");
    expect(readinessTitle(1)).toBe("One step to auction night");
    expect(readinessTitle(2)).toBe("Two steps to auction night");
  });
});

describe("shortfallSentence", () => {
  const short = { ok: false, poolSize: 10, teamCount: 4, squadMin: 8, needed: 32, shortfall: 22 };

  it("says the size of the gap and the ways out", () => {
    const s = shortfallSentence(short, 2);
    expect(s?.lead).toBe("The pool is 22 players short.");
    expect(s?.body).toContain("10 players can't fill 4 squads of at least 8 (32 needed).");
    expect(s?.body).toContain("Approve the 2 waiting");
  });

  it("is silent when the pool fits", () => {
    expect(shortfallSentence({ ...short, ok: true, shortfall: 0 }, 0)).toBeNull();
  });
});
