import { describe, expect, it } from "vitest";

import { filterSortPlayers, type ShowcaseItem } from "./showcase-filter";

const P: ShowcaseItem[] = [
  { number: "10", name: "Zara Khan", status: "available" },
  { number: "2", name: "Amit Rao", status: "sold" },
  { number: "1", name: "amit shah", status: "available" },
];

describe("filterSortPlayers", () => {
  it("filters by status", () => {
    expect(filterSortPlayers(P, { query: "", filter: "sold", sort: "number" }).map((p) => p.number)).toEqual([
      "2",
    ]);
    expect(
      filterSortPlayers(P, { query: "", filter: "available", sort: "number" }).map((p) => p.number),
    ).toEqual(["1", "10"]);
  });

  it("free-text matches name (case-insensitive) or number", () => {
    expect(filterSortPlayers(P, { query: "amit", filter: "all", sort: "number" }).map((p) => p.name)).toEqual([
      "amit shah",
      "Amit Rao",
    ]);
    expect(filterSortPlayers(P, { query: "10", filter: "all", sort: "number" }).map((p) => p.number)).toEqual([
      "10",
    ]);
  });

  it("sorts numerically ('2' before '10'), by name, and by status", () => {
    expect(filterSortPlayers(P, { query: "", filter: "all", sort: "number" }).map((p) => p.number)).toEqual([
      "1",
      "2",
      "10",
    ]);
    expect(filterSortPlayers(P, { query: "", filter: "all", sort: "name" }).map((p) => p.name)).toEqual([
      "Amit Rao",
      "amit shah",
      "Zara Khan",
    ]);
    expect(filterSortPlayers(P, { query: "", filter: "all", sort: "status" }).map((p) => p.status)).toEqual([
      "available",
      "available",
      "sold",
    ]);
  });

  it("returns an empty array when nothing matches (and never mutates input)", () => {
    const before = [...P];
    expect(filterSortPlayers(P, { query: "nobody", filter: "all", sort: "number" })).toEqual([]);
    expect(P).toEqual(before);
  });
});
