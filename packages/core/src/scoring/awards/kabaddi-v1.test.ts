import { expect, it } from "vitest";
import {
  scoreKabaddi,
  kabaddiDiscipline,
  pickKabaddiMatchAwards,
  kabaddiSeasonPlayers,
  pickKabaddiSeasonAwards,
  type KabaddiSeasonMatch,
} from "./kabaddi-v1";
import { emptyRaidStats } from "../raid/state";
import { detectRaidPace } from "../trust";
import type { DerivedResult, PlayerLine } from "../types";
function line(
  id: string,
  teamId = "home",
  stats: Partial<NonNullable<PlayerLine["raid"]>> = {},
): PlayerLine {
  return { registrationId: id, teamId, appeared: true, raid: { ...emptyRaidStats(), ...stats } };
}
const winner: DerivedResult = {
  outcome: "home_win",
  winnerTeamId: "home",
  marginText: "1 points",
  method: null,
};
const candidate = (id: string, teamId: string, points: number, code = "raid_points") => ({
  registrationId: id,
  teamId,
  points,
  lines: [{ code, label: code, qty: points, points }],
});
it("C51 exact eight-line arithmetic with no assist/card/team-only points", () => {
  const players = new Map([
    [
      "p",
      line("p", "home", {
        raidPoints: 10,
        tacklePoints: 5,
        superRaids: 2,
        superTackles: 2,
        super10: 1,
        high5: 1,
        doOrDieSuccesses: 2,
        tackled: 3,
        assists: 9,
        redCards: 1,
      }),
    ],
  ]);
  const score = scoreKabaddi(players).get("p");
  expect(score?.points).toBe(31.5);
  expect(score?.lines).toHaveLength(8);
  expect(kabaddiDiscipline(score?.lines ?? [])).toBe(21.5);
  expect(scoreKabaddi(new Map([["p", line("p")]])).get("p")).toEqual({ points: 0, lines: [] });
});
it("C51 match discipline separates raid/tackle totals and applies winning side and ID ties", () => {
  const split = {
    ...candidate("a", "home", 10),
    lines: [
      { code: "raid_points", label: "Raid", qty: 5, points: 5 },
      { code: "tackle_points", label: "Tackle", qty: 5, points: 5 },
    ],
  };
  expect(
    pickKabaddiMatchAwards([split, candidate("b", "home", 10)], winner).player_of_match
      ?.registrationId,
  ).toBe("b");
  expect(
    pickKabaddiMatchAwards(
      [candidate("z", "away", 10), candidate("b", "home", 10), candidate("a", "home", 10)],
      winner,
    ).player_of_match?.registrationId,
  ).toBe("a");
});
it("C51 winning-side top-three boundary and Fighter exclusion are exact", () => {
  const losing = [candidate("a", "away", 20), candidate("b", "away", 19)];
  expect(pickKabaddiMatchAwards([...losing, candidate("w", "home", 18)], winner)).toMatchObject({
    player_of_match: { registrationId: "w" },
    fighter_of_match: { registrationId: "a" },
  });
  expect(
    pickKabaddiMatchAwards(
      [...losing, candidate("c", "away", 18), candidate("w", "home", 17)],
      winner,
    ),
  ).toMatchObject({
    player_of_match: { registrationId: "a" },
    fighter_of_match: { registrationId: "b" },
  });
});
it("C51 null/Fighter semantics include played no-result without invented winning side", () => {
  const players = [candidate("a", "home", 1)];
  expect(pickKabaddiMatchAwards(players, null)).toEqual({
    player_of_match: null,
    fighter_of_match: null,
  });
  expect(pickKabaddiMatchAwards([], winner)).toEqual({
    player_of_match: null,
    fighter_of_match: null,
  });
  for (const outcome of ["tie", "no_result", "abandoned"] as const)
    expect(
      pickKabaddiMatchAwards(players, { ...winner, outcome, winnerTeamId: null }),
    ).toMatchObject({ player_of_match: { registrationId: "a" }, fighter_of_match: null });
});
function match(
  fixtureId: string,
  players: PlayerLine[],
  trust: KabaddiSeasonMatch["trust"] = "verified",
): KabaddiSeasonMatch {
  const map = new Map(players.map((p) => [p.registrationId, p]));
  return {
    fixtureId,
    players: map,
    scores: scoreKabaddi(map),
    trust,
    completed: true,
    voided: false,
    teamIds: ["home", "away"],
  };
}
it("C51 season current trust/nonvoid/distinct completed qualification and positive-stat null picks", () => {
  const good = match("m1", [
    line("a", "home", { raidPoints: 1 }),
    line("b", "away", { tacklePoints: 2 }),
  ]);
  const ignored = match("ignored", [line("a", "home", { raidPoints: 100 })], "self_scored");
  const rows = kabaddiSeasonPlayers([
    good,
    good,
    ignored,
    { ...ignored, fixtureId: "void", trust: "confirmed", voided: true },
    { ...ignored, fixtureId: "open", trust: "confirmed", completed: false },
  ]);
  expect(rows).toHaveLength(2);
  expect(rows[0]).toMatchObject({ matches: 1, teamMatches: 1, raidPoints: 1 });
  expect(pickKabaddiSeasonAwards(rows)).toMatchObject({
    best_raider: { registrationId: "a" },
    best_defender: { registrationId: "b" },
    season_mvp: { registrationId: "b" },
  });
  expect(pickKabaddiSeasonAwards(kabaddiSeasonPlayers([match("zero", [line("a")])]))).toMatchObject(
    { best_raider: null, best_defender: null },
  );
  expect(kabaddiSeasonPlayers([{ ...good, trust: "flagged" }])).toEqual([]);
});
it("C51 bestN changes only MVP points, full stats and >=50 percent denominator stay intact", () => {
  const history = [
    match("1", [line("a", "home", { raidPoints: 10 })]),
    match("2", [line("a", "home", { raidPoints: 9 }), line("b", "home", { raidPoints: 30 })]),
    match("3", [line("c", "home")]),
    match("4", [line("c", "home")]),
  ];
  const all = kabaddiSeasonPlayers(history),
    best = kabaddiSeasonPlayers(history, { bestN: 1 });
  expect(all.find((p) => p.registrationId === "a")).toMatchObject({
    points: 19,
    raidPoints: 19,
    matches: 2,
    teamMatches: 4,
    mvpEligible: true,
  });
  expect(best.find((p) => p.registrationId === "a")).toMatchObject({
    points: 10,
    raidPoints: 19,
    matches: 2,
    teamMatches: 4,
    mvpEligible: true,
  });
  expect(best.find((p) => p.registrationId === "b")?.mvpEligible).toBe(false);
  expect(pickKabaddiSeasonAwards(best).best_raider?.registrationId).toBe("b");
  expect(pickKabaddiSeasonAwards(best).season_mvp?.registrationId).toBe("a");
  for (const bestN of [0, -1, 1.5])
    expect(() => kabaddiSeasonPlayers(history, { bestN })).toThrow();
});
it("C51 season statistic/point ties resolve by registration ID without cricket thresholds", () => {
  const rows = kabaddiSeasonPlayers([
    match("tie", [
      line("z", "home", { raidPoints: 1, tacklePoints: 1 }),
      line("a", "home", { raidPoints: 1, tacklePoints: 1 }),
    ]),
  ]);
  const picks = pickKabaddiSeasonAwards(rows);
  for (const pick of Object.values(picks)) expect(pick?.registrationId).toBe("a");
  expect(pickKabaddiSeasonAwards([])).toEqual({
    season_mvp: null,
    best_raider: null,
    best_defender: null,
  });
});
it("C51 raid receipt live minimum, late/invalid ordering and absence of invented physical pace", () => {
  expect(detectRaidPace([])).toEqual({ signals: [], liveScored: false });
  const at = "2026-10-11T00:00:00Z";
  const records = Array.from({ length: 35 }, () => ({
    legal: true,
    clientRecordedAt: at,
    receivedAt: at,
  }));
  expect(detectRaidPace(records)).toEqual({ signals: [], liveScored: true });
  for (const record of [
    { ...records[0], legal: true, clientRecordedAt: "bad", receivedAt: at },
    { legal: true, clientRecordedAt: at, receivedAt: "2026-10-11T00:03:00Z" },
    { legal: true, clientRecordedAt: "2026-10-11T00:00:01Z", receivedAt: at },
  ])
    expect(detectRaidPace([record])).toEqual({ signals: ["backfilled"], liveScored: false });
});
