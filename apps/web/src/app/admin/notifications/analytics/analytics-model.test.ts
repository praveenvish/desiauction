import { describe, expect, it } from "vitest";

import { headlineFigures, totalsOf } from "./analytics-model";

describe("the delivery headline", () => {
  const channels = [
    { sent: 0, failed: 0, suppressed: 4896, pending: 0 },
    { sent: 4472, failed: 3, suppressed: 0, pending: 2 },
  ];

  it("adds the channels up, pending counted as queued", () => {
    expect(totalsOf(channels)).toEqual({
      queued: 9373,
      sent: 4472,
      suppressed: 4896,
      failed: 3,
    });
  });

  it("gives each figure the one fact that reads it", () => {
    const figures = headlineFigures(totalsOf(channels), 30);
    expect(figures.map((f) => [f.label, f.value, f.hint])).toEqual([
      ["Queued", 9373, "Last 30 days"],
      ["Sent", 4472, "47.7% of queued"],
      ["Suppressed", 4896, "Not sent — see the reasons"],
      ["Failed", 3, "0.1% failure rate"],
    ]);
    expect(figures.find((f) => f.key === "failed")?.alarm).toBe(true);
  });

  it("stays calm over an empty window", () => {
    const figures = headlineFigures(totalsOf([]), 7);
    expect(figures.map((f) => f.hint)).toEqual([
      "Last 7 days",
      "— of queued",
      "None held back",
      "— failure rate",
    ]);
    expect(figures.some((f) => f.alarm)).toBe(false);
  });
});
