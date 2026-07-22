import { describe, expect, it } from "vitest";

import { showcaseToCsv, squadsToCsv, type ShowcaseCsvRow } from "./showcase-csv";

const rows: ShowcaseCsvRow[] = [
  {
    number: "1",
    name: "Amit Rao",
    role: "all_rounder",
    age: 24,
    battingStyle: "right_hand",
    bowlingStyle: "off_break",
    status: "sold",
    teamName: "Alpha, B",
  },
  {
    number: "2",
    name: "Zara",
    role: "batter",
    age: null,
    battingStyle: null,
    bowlingStyle: null,
    status: "available",
    teamName: null,
  },
];

describe("showcaseToCsv", () => {
  it("emits header + a row per player, escaping and blanking nulls (no phone)", () => {
    const csv = showcaseToCsv(rows);
    const lines = csv.split("\n");
    expect(lines[0]).toBe("number,name,role,age,batting,bowling,status,team");
    expect(lines[1]).toBe('1,Amit Rao,all_rounder,24,right_hand,off_break,sold,"Alpha, B"');
    expect(lines[2]).toBe("2,Zara,batter,,,,available,");
    expect(csv).not.toContain("phone");
  });

  it("emits just the header for an empty pool", () => {
    expect(showcaseToCsv([])).toBe("number,name,role,age,batting,bowling,status,team");
  });
});

describe("squadsToCsv", () => {
  const roster = [
    { number: "3", name: "C", role: "bowler", status: "sold" as const, teamName: "Zeta" },
    { number: "1", name: "A", role: "batter", status: "sold" as const, teamName: "Alpha" },
    { number: "2", name: "B", role: "all_rounder", status: "sold" as const, teamName: "Alpha" },
    { number: "9", name: "X", role: "batter", status: "available" as const, teamName: null },
  ];

  it("emits sold players grouped by team (A→Z, players by number); excludes available", () => {
    expect(squadsToCsv(roster)).toBe(
      ["team,number,name,role", "Alpha,1,A,batter", "Alpha,2,B,all_rounder", "Zeta,3,C,bowler"].join(
        "\n",
      ),
    );
  });

  it("emits just the header pre-auction (no sold players)", () => {
    expect(squadsToCsv([{ number: "1", name: "A", role: "batter", status: "available", teamName: null }])).toBe(
      "team,number,name,role",
    );
  });
});
