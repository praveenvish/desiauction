import { describe, expect, it } from "vitest";

import { lotSeed } from "./player-seed";

describe("lotSeed", () => {
  it("seeds a lot by the registration behind it, so the block and the rosters agree", () => {
    expect(lotSeed("lot-1", { "lot-1": { registrationId: "reg-9" } })).toBe("reg-9");
  });

  it("falls back to the lot id for a lot the page's media has not seen", () => {
    expect(lotSeed("lot-2", { "lot-1": { registrationId: "reg-9" } })).toBe("lot-2");
    expect(lotSeed("lot-2", undefined)).toBe("lot-2");
  });
});
