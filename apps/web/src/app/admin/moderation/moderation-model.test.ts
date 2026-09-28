import { describe, expect, it } from "vitest";

import { entryState } from "./moderation-model";

describe("entryState", () => {
  it("says whether strangers can register right now", () => {
    expect(entryState("registration_open")).toEqual({ label: "Registration open", tone: "green" });
    expect(entryState("registration_closed").label).toBe("Registration closed");
  });
});
