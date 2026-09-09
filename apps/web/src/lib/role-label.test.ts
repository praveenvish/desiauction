import { roleOptions } from "@desiauction/core";
import { describe, expect, it } from "vitest";

import { roleLabeller } from "./role-label";

describe("roleLabeller", () => {
  it("names a role in the season's own sport", () => {
    const football = roleLabeller(roleOptions("football"));
    expect(football("midfielder")).toBe("Midfielder");
    expect(football("goalkeeper")).toBe("Goalkeeper");
    // The one that proves it is not just prettifying the key.
    expect(roleLabeller(roleOptions("cricket"))("all_rounder")).toBe("All-rounder");
  });

  it("does not name a cricket role in a football season", () => {
    // The defect in reverse: cricket's labeller answered for every sport.
    expect(roleLabeller(roleOptions("football"))("all_rounder")).toBe("all rounder");
  });

  it("renders an absent role as nothing, not as a word", () => {
    // A sport whose pack declares no playing roles stores null, and "null" or
    // "—" on a projector would be worse than a blank.
    expect(roleLabeller(roleOptions("cricket"))(null)).toBe("");
  });
});
