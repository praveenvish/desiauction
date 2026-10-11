import type { AwardLine, DerivedResult } from "../types";

export interface AwardCandidate {
  registrationId: string;
  teamId: string;
  points: number;
  lines: readonly AwardLine[];
}
export const compareId = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const battingCodes = new Set([
  "runs",
  "fours",
  "sixes",
  "milestone_20",
  "milestone_25",
  "milestone_30",
  "milestone_50",
  "milestone_100",
  "pace_vs_match",
  "duck",
]);
const bowlingCodes = new Set([
  "wickets",
  "bowled_lbw_bonus",
  "top_order_bonus",
  "haul",
  "dots",
  "maidens",
  "economy_vs_match",
]);
export function disciplinePoints(lines: readonly AwardLine[]): number {
  const total = (codes: Set<string>) =>
    lines.reduce((sum, line) => sum + (codes.has(line.code) ? line.points : 0), 0);
  return Math.max(total(battingCodes), total(bowlingCodes));
}
export function fieldingPoints(lines: readonly AwardLine[]): number {
  return lines.reduce(
    (sum, line) =>
      sum +
      (["catches", "stumpings", "run_out_direct", "run_out_assist"].includes(line.code)
        ? line.points
        : 0),
    0,
  );
}
export function pickMatchAwards(
  candidates: readonly AwardCandidate[],
  result: DerivedResult | null,
): {
  player_of_match: AwardCandidate | null;
  fighter_of_match: AwardCandidate | null;
} {
  if (!result) return { player_of_match: null, fighter_of_match: null };
  const winner = result.winnerTeamId;
  const ranked = [...candidates].sort(
    (a, b) =>
      b.points - a.points ||
      Number(b.teamId === winner) - Number(a.teamId === winner) ||
      disciplinePoints(b.lines) - disciplinePoints(a.lines) ||
      compareId(a.registrationId, b.registrationId),
  );
  let player = ranked[0] ?? null;
  if (winner && player?.teamId !== winner)
    player = ranked.slice(0, 3).find((candidate) => candidate.teamId === winner) ?? player;
  const fighter = winner
    ? (ranked.find(
        (candidate) =>
          candidate.teamId !== winner && candidate.registrationId !== player?.registrationId,
      ) ?? null)
    : null;
  return { player_of_match: player, fighter_of_match: fighter };
}
