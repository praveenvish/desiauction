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

  // The grid renders a Retained chip, but this allow-list did not accept the
  // value it produces — so `?filter=retained` parsed back as "all" and the URL
  // sync then dropped it. The filter applied, then silently reset on reload,
  // and the link was unshareable. Every value the UI can set must survive.
  it("keeps ?filter=retained, the chip the grid actually renders", () => {
    expect(parseShowcaseParams(new URLSearchParams("filter=retained")).filter).toBe("retained");
    expect(
      serializeShowcaseParams({
        view: "players",
        filter: "retained",
        sort: "number",
        query: "",
      }),
    ).toBe("filter=retained");
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
