import { describe, expect, it } from "vitest";

import { hue, isTeamBadge, shieldColourFor, shieldSvg, shieldTones } from "./team-shield";

describe("the default team shield (0111)", () => {
  it("knows its two badges and nothing else", () => {
    expect(isTeamBadge("shield")).toBe(true);
    expect(isTeamBadge("initials")).toBe(true);
    expect(isTeamBadge("crest")).toBe(false);
    expect(isTeamBadge(null)).toBe(false);
  });

  it("keeps a team's own colour, and gives colourless teams distinct steady ones", () => {
    expect(shieldColourFor(hue("EA580C"), "DF")).toBe(hue("EA580C"));
    const picks = ["DF", "DP", "DT", "DW"].map((seed) => shieldColourFor(null, seed));
    expect(new Set(picks).size).toBe(4);
    expect(shieldColourFor(null, "DF")).toBe(picks[0]);
  });

  it("writes dark initials on a light shield and white on a dark one", () => {
    expect(shieldTones(hue("FACC15")).ink).not.toBe(hue("FFFFFF"));
    expect(shieldTones(hue("1E3A8A")).ink).toBe(hue("FFFFFF"));
  });

  it("trims a gold team in white, so the rim still shows", () => {
    expect(shieldTones(hue("FACC15")).rim).toBe(hue("FFFFFF"));
    expect(shieldTones(hue("2563EB")).rim).not.toBe(hue("FFFFFF"));
  });

  it("is shape only — no text for the rasterizer to shape", () => {
    expect(shieldSvg(hue("2563EB"))).not.toContain("<text");
  });
});
