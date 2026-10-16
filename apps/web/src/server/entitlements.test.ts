import { expect, it } from "vitest";
import { can } from "./entitlements";
it("grants briefs only to Pro or association seasons and keeps sponsors available", () => {
  for (const tier of ["free", "pro", "association", "unknown"]) {
    expect(can({ tier }, "captain_brief")).toBe(["pro", "association"].includes(tier));
    expect(can({ tier }, "overlay_sponsor")).toBe(true);
  }
});
