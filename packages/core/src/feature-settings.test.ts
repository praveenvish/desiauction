import { describe, expect, it } from "vitest";

import { FEATURES, isFeature, resolveFeature } from "./feature-settings";
import type { FeatureSettingLike } from "./feature-settings";

/**
 * LAYERS ONLY SUBTRACT (WR-1).
 *
 * env → tier → platform → org → auction. The platform row replaces the code
 * default; everything below it can only say no. These tests hold that order
 * so a later "convenience" that lets an auction row switch a feature back on
 * over a club's no fails here first.
 */
const row = (over: Partial<FeatureSettingLike>): FeatureSettingLike => ({
  scopeType: "auction",
  feature: "my_plan",
  enabled: false,
  ...over,
});

describe("resolveFeature", () => {
  it("is on by default with no rows, no env, no tier asked", () => {
    expect(FEATURES.my_plan.defaultEnabled).toBe(true);
    expect(resolveFeature("my_plan", [])).toEqual({ enabled: true, deniedBy: null });
  });

  it("the environment kill switch wins over everything", () => {
    expect(
      resolveFeature("my_plan", [row({ scopeType: "platform", enabled: true })], {
        envEnabled: false,
      }),
    ).toEqual({ enabled: false, deniedBy: "env" });
  });

  it("a tier below the feature's floor denies, and only when a tier is asked", () => {
    expect(resolveFeature("my_plan", [], { tier: "free" }).enabled).toBe(true);
    expect(resolveFeature("my_plan", [], { tier: "association" }).enabled).toBe(true);
    // No feature currently sits above free; the branch is held by construction:
    // asking with no tier never denies on tier.
    expect(resolveFeature("my_plan", []).deniedBy).toBeNull();
  });

  it("a platform row replaces the default in both directions", () => {
    expect(resolveFeature("my_plan", [row({ scopeType: "platform", enabled: false })])).toEqual({
      enabled: false,
      deniedBy: "platform",
    });
    expect(resolveFeature("my_plan", [row({ scopeType: "platform", enabled: true })])).toEqual({
      enabled: true,
      deniedBy: null,
    });
  });

  it("an org row can switch off, and an auction row cannot switch back on", () => {
    expect(
      resolveFeature("my_plan", [
        row({ scopeType: "org", enabled: false }),
        row({ scopeType: "auction", enabled: true }),
      ]),
    ).toEqual({ enabled: false, deniedBy: "org" });
  });

  it("an auction row can switch off on its own", () => {
    expect(resolveFeature("my_plan", [row({ scopeType: "auction", enabled: false })])).toEqual({
      enabled: false,
      deniedBy: "auction",
    });
  });

  it("an org row saying yes does not override a platform no", () => {
    expect(
      resolveFeature("my_plan", [
        row({ scopeType: "platform", enabled: false }),
        row({ scopeType: "org", enabled: true }),
      ]),
    ).toEqual({ enabled: false, deniedBy: "platform" });
  });

  it("ignores rows about other features", () => {
    expect(
      resolveFeature("my_plan", [row({ feature: "something_else", scopeType: "org" })]),
    ).toEqual({ enabled: true, deniedBy: null });
  });

  it("names its features and nothing else", () => {
    expect(isFeature("my_plan")).toBe(true);
    expect(isFeature("toString")).toBe(false);
    expect(isFeature("")).toBe(false);
  });
});
