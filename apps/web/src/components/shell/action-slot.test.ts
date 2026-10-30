import { describe, expect, it } from "vitest";

import { actionSlotIsCurrent } from "./action-slot";

describe("actionSlotIsCurrent", () => {
  it("shows the slot rendered for this page", () => {
    expect(actionSlotIsCurrent(["home"], "/home")).toBe(true);
    expect(
      actionSlotIsCurrent(["seasons", "spring-cup", "teams"], "/seasons/spring-cup/teams"),
    ).toBe(true);
  });

  it("hides a slot left over from the page before", () => {
    expect(
      actionSlotIsCurrent(["seasons", "spring-cup", "teams"], "/seasons/spring-cup/registrations"),
    ).toBe(false);
    expect(actionSlotIsCurrent(["tournaments"], "/seasons/spring-cup")).toBe(false);
    expect(actionSlotIsCurrent(["home"], "/")).toBe(false);
  });

  it("hides the default slot and a missing router context", () => {
    expect(actionSlotIsCurrent(["__DEFAULT__"], "/help")).toBe(false);
    expect(actionSlotIsCurrent([], "/help")).toBe(false);
    expect(actionSlotIsCurrent(null, "/home")).toBe(false);
  });

  it("ignores route groups, trailing slashes and encoding", () => {
    expect(actionSlotIsCurrent(["(console)", "orgs"], "/orgs/")).toBe(true);
    expect(
      actionSlotIsCurrent(["seasons", "kabaddi cup", "teams"], "/seasons/kabaddi%20cup/teams"),
    ).toBe(true);
  });
});
