import { describe, expect, it } from "vitest";

import { parseShowcaseParams, serializeShowcaseParams } from "./showcase-params";

describe("showcase URL params", () => {
  it("parses valid params and falls back for absent/invalid ones", () => {
    expect(
      parseShowcaseParams(new URLSearchParams("view=squads&filter=sold&sort=name&q=amit")),
    ).toEqual({
      view: "squads",
      filter: "sold",
      sort: "name",
      query: "amit",
    });
    // invalid values fall back to defaults; missing q → ""
    expect(parseShowcaseParams(new URLSearchParams("view=nope&filter=x&sort=y"))).toEqual({
      view: "players",
      filter: "all",
      sort: "number",
      query: "",
    });
  });

  it("serializes omitting defaults for clean URLs", () => {
    expect(
      serializeShowcaseParams({ view: "players", filter: "all", sort: "number", query: "" }),
    ).toBe("");
    expect(
      serializeShowcaseParams({ view: "squads", filter: "sold", sort: "name", query: "raj" }),
    ).toBe("view=squads&filter=sold&sort=name&q=raj");
  });

  it("round-trips (parse ∘ serialize is identity on valid state)", () => {
    const state = {
      view: "squads" as const,
      filter: "available" as const,
      sort: "status" as const,
      query: "x",
    };
    expect(parseShowcaseParams(new URLSearchParams(serializeShowcaseParams(state)))).toEqual(state);
  });
});
