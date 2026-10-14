import type { AwardLine, DerivedResult, PlayerLine, TrustLevel } from "../types";
import type { MatchScore } from "./cricket-v1";
import { compareId, type AwardCandidate } from "./pick";
export function scoreKabaddi(players: ReadonlyMap<string, PlayerLine>): Map<string, MatchScore> {
  return new Map(
    [...players].map(([id, player]) => {
      if (!player.raid) throw new Error("Canonical kabaddi player has no raid statistics");
      const stats = player.raid,
        lines: AwardLine[] = [];
      const add = (code: string, label: string, qty: number, rate: number) => {
        if (qty) lines.push({ code, label, qty, points: qty * rate });
      };
      add("raid_points", "Raid points", stats.raidPoints, 1);
      add("tackle_points", "Tackle points", stats.tacklePoints, 1);
      add("super_tackle", "Super tackle", stats.superTackles, 1);
      add("super_raid", "Super raid", stats.superRaids, 3);
      add("super_10", "Super 10", stats.super10, 5);
      add("high_5", "High 5", stats.high5, 3);
      add("do_or_die", "Do-or-die success", stats.doOrDieSuccesses, 1);
      add("tackled", "Tackled", stats.tackled, -0.5);
      return [id, { points: lines.reduce((sum, line) => sum + line.points, 0), lines }];
    }),
  );
}
export function kabaddiDiscipline(lines: readonly AwardLine[]): number {
  const raid = new Set(["raid_points", "super_raid", "super_10", "do_or_die", "tackled"]);
  const tackle = new Set(["tackle_points", "super_tackle", "high_5"]);
  return Math.max(
    lines.reduce((sum, line) => sum + (raid.has(line.code) ? line.points : 0), 0),
    lines.reduce((sum, line) => sum + (tackle.has(line.code) ? line.points : 0), 0),
  );
}
export function pickKabaddiMatchAwards(
  candidates: readonly AwardCandidate[],
  result: DerivedResult | null,
) {
  if (!result) return { player_of_match: null, fighter_of_match: null };
  const winner = result.winnerTeamId;
  const ranked = [...candidates].sort(
    (a, b) =>
      b.points - a.points ||
      Number(b.teamId === winner) - Number(a.teamId === winner) ||
      kabaddiDiscipline(b.lines) - kabaddiDiscipline(a.lines) ||
      compareId(a.registrationId, b.registrationId),
  );
  let player = ranked[0] ?? null;
  if (winner && player?.teamId !== winner)
    player = ranked.slice(0, 3).find((entry) => entry.teamId === winner) ?? player;
  const fighter = winner
    ? (ranked.find(
        (entry) => entry.teamId !== winner && entry.registrationId !== player?.registrationId,
      ) ?? null)
    : null;
  return { player_of_match: player, fighter_of_match: fighter };
}
export interface KabaddiSeasonMatch {
  fixtureId: string;
  completed: boolean;
  voided: boolean;
  trust: TrustLevel;
  teamIds: readonly string[];
  players: ReadonlyMap<string, PlayerLine>;
  scores: ReadonlyMap<string, MatchScore>;
}
export interface KabaddiSeasonPlayer {
  registrationId: string;
  teamId: string;
  matches: number;
  teamMatches: number;
  points: number;
  raidPoints: number;
  tacklePoints: number;
  mvpEligible: boolean;
}
export function kabaddiSeasonPlayers(
  matches: readonly KabaddiSeasonMatch[],
  options: { bestN?: number } = {},
): KabaddiSeasonPlayer[] {
  if (options.bestN !== undefined && (!Number.isSafeInteger(options.bestN) || options.bestN < 1))
    throw new Error("bestN must be a positive integer");
  const seen = new Set<string>(),
    totals = new Map<string, KabaddiSeasonPlayer>(),
    teams = new Map<string, number>(),
    scores = new Map<string, number[]>();
  for (const match of matches) {
    if (
      !match.completed ||
      match.voided ||
      !["verified", "confirmed"].includes(match.trust) ||
      seen.has(match.fixtureId)
    )
      continue;
    seen.add(match.fixtureId);
    for (const team of new Set(match.teamIds)) teams.set(team, (teams.get(team) ?? 0) + 1);
    for (const [id, line] of match.players) {
      if (!line.raid) throw new Error("Canonical kabaddi player has no raid statistics");
      const row = totals.get(id) ?? {
        registrationId: id,
        teamId: line.teamId,
        matches: 0,
        teamMatches: 0,
        points: 0,
        raidPoints: 0,
        tacklePoints: 0,
        mvpEligible: false,
      };
      if (row.teamId !== line.teamId) throw new Error("Kabaddi season registration changed team");
      row.matches++;
      row.raidPoints += line.raid.raidPoints;
      row.tacklePoints += line.raid.tacklePoints;
      const points = match.scores.get(id);
      if (!points) throw new Error("Canonical kabaddi player has no award score");
      const list = scores.get(id) ?? [];
      list.push(points.points);
      scores.set(id, list);
      totals.set(id, row);
    }
  }
  for (const row of totals.values()) {
    row.teamMatches = teams.get(row.teamId) ?? 0;
    row.mvpEligible = row.teamMatches > 0 && row.matches * 2 >= row.teamMatches;
    row.points = (scores.get(row.registrationId) ?? [])
      .sort((a, b) => b - a)
      .slice(0, options.bestN)
      .reduce((sum, points) => sum + points, 0);
  }
  return [...totals.values()].sort((a, b) => compareId(a.registrationId, b.registrationId));
}
export function pickKabaddiSeasonAwards(players: readonly KabaddiSeasonPlayer[]) {
  const pick = (
    eligible: (row: KabaddiSeasonPlayer) => boolean,
    key: "points" | "raidPoints" | "tacklePoints",
  ) =>
    [...players]
      .filter(eligible)
      .sort((a, b) => b[key] - a[key] || compareId(a.registrationId, b.registrationId))[0] ?? null;
  return {
    season_mvp: pick((row) => row.mvpEligible, "points"),
    best_raider: pick((row) => row.raidPoints > 0, "raidPoints"),
    best_defender: pick((row) => row.tacklePoints > 0, "tacklePoints"),
  };
}
