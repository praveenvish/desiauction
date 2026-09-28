import { describe, expect, it } from "vitest";

import { anyLineupRecorded, matchRecord, profileAsk } from "./me-model";

describe("profileAsk", () => {
  it("names the first two things worth adding and counts the rest", () => {
    expect(profileAsk(["passkey", "photo", "email", "style", "location", "date_of_birth"])).toBe(
      "Add a photo, your playing style and 4 more",
    );
  });

  it("names one or two without a count", () => {
    expect(profileAsk(["passkey"])).toBe("Add a passkey");
    expect(profileAsk(["email", "photo"])).toBe("Add a photo and a verified email");
  });

  it("is null when the profile is complete", () => {
    expect(profileAsk([])).toBeNull();
  });
});

describe("matchRecord / anyLineupRecorded", () => {
  it("counts finished results only", () => {
    expect(
      matchRecord([{ result: "won" }, { result: "lost" }, { result: null }, { result: "won" }]),
    ).toEqual({ played: 3, won: 2, lost: 1, tied: 0 });
  });

  it("draws the You column only once a lineup says something", () => {
    expect(anyLineupRecorded([{ played: "unknown" }, { played: "unknown" }])).toBe(false);
    expect(anyLineupRecorded([{ played: "unknown" }, { played: "bench" }])).toBe(true);
  });
});
