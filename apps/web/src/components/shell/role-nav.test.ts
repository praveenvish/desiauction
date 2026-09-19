import { describe, expect, it } from "vitest";

import { RAIL, railFor, roleNavGroups, type ShellRoles } from "./nav";

const NOBODY: ShellRoles = { team: null, plays: false, onlyPlays: false };

describe("the rail offers by role", () => {
  it("a brand-new account keeps the organizer's four — they may be about to start a club", () => {
    expect(railFor(NOBODY).map((item) => item.key)).toEqual(RAIL.map((item) => item.key));
    expect(roleNavGroups(NOBODY, "/home")).toEqual([]);
  });

  it("someone who only plays is not offered empty organizer indexes", () => {
    const player: ShellRoles = { team: null, plays: true, onlyPlays: true };
    expect(railFor(player).map((item) => item.key)).toEqual(["home", "help"]);
    const groups = roleNavGroups(player, "/me/cricket");
    expect(groups.map((group) => group.label)).toEqual(["Play"]);
    const sports = groups[0]?.items.find((item) => item.key === "sports");
    expect(sports?.href).toBe("/me");
    expect(sports?.active).toBe(true);
  });

  it("a team owner gets their team, their plan and the room — and only the page they are on is lit", () => {
    const owner: ShellRoles = {
      team: { name: "Demo Panthers", seasonSlug: "demo-pl", live: true },
      plays: false,
      onlyPlays: false,
    };
    const [team] = roleNavGroups(owner, "/seasons/demo-pl/auction/plan");
    expect(team?.label).toBe("My team");
    expect(team?.items.map((item) => [item.label, item.href])).toEqual([
      ["Demo Panthers", "/seasons/demo-pl/teams"],
      ["My plan", "/seasons/demo-pl/auction/plan"],
      ["Auction room", "/seasons/demo-pl/auction/live"],
    ]);
    expect(team?.items.filter((item) => item.active).map((item) => item.key)).toEqual(["plan"]);
    expect(team?.items.find((item) => item.key === "room")?.live).toBe(true);
  });

  it("an organizer who also plays keeps the full rail and gains the Play group", () => {
    const both: ShellRoles = { team: null, plays: true, onlyPlays: false };
    expect(railFor(both)).toEqual(RAIL);
    expect(roleNavGroups(both, "/home").map((group) => group.key)).toEqual(["play"]);
  });
});
