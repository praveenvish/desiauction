import { describe, expect, it } from "vitest";

import { filterSortPlayers, groupSquads, type ShowcaseItem } from "./showcase-filter";

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

describe("groupSquads", () => {
  const S = [
    { number: "3", name: "C", status: "sold" as const, teamName: "Zeta" },
    { number: "1", name: "A", status: "sold" as const, teamName: "Alpha" },
    { number: "2", name: "B", status: "sold" as const, teamName: "Alpha" },
    { number: "4", name: "D", status: "available" as const, teamName: null },
    { number: "5", name: "E", status: "sold" as const, teamName: null },
  ];

  it("groups sold players by team (A→Z), players by number; excludes available/teamless", () => {
    const squads = groupSquads(S);
    expect(squads.map((s) => s.teamName)).toEqual(["Alpha", "Zeta"]);
    expect(squads[0]?.players.map((p) => p.number)).toEqual(["1", "2"]);
    expect(squads[1]?.players.map((p) => p.number)).toEqual(["3"]);
    // "E" is sold but teamless → excluded; "D" is available → excluded.
    expect(squads.flatMap((s) => s.players.map((p) => p.name))).not.toContain("E");
    expect(squads.flatMap((s) => s.players.map((p) => p.name))).not.toContain("D");
  });

  it("returns [] pre-auction (no sold players)", () => {
    expect(groupSquads([{ number: "1", name: "A", status: "available", teamName: null }])).toEqual(
      [],
    );
  });
});
