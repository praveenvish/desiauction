import { FOOTBALL_ROLE_KEYS } from "../../sports/football";
import type { AwardLine, DerivedResult, PlayerLine } from "../types";
import type { MatchScore } from "./cricket-v1";
import { compareId, type AwardCandidate } from "./pick";
import { timedCompleted, type TimedState } from "../timed/state";
import { timedSport } from "../timed/formats";
/** Unrecorded in-play penalty saves/misses never become observed zeroes or award lines. */
export function scoreTimed(
  players: ReadonlyMap<string, PlayerLine>,
  state: TimedState,
): Map<string, MatchScore> {
  if (!state.format) throw new Error("Timed format is missing");
  const sport = timedSport(state.format);
  if (sport === "hockey") throw new Error("Player awards are unavailable for hockey scoring");
  return new Map(
    [...players].map(([id, player]) => {
      const stats = player.timed;
      if (!stats) throw new Error("Canonical timed player has no statistics");
      const lines: AwardLine[] = [];
      const add = (code: string, label: string, qty: number, rate: number) => {
        if (qty) lines.push({ code, label, qty, points: qty * rate });
      };
      if (sport === "basketball") {
        add("points", "Points", stats.points, 1);
        add("fouls", "Fouls", stats.fouls, -1);
      } else {
        const keeper = stats.role === FOOTBALL_ROLE_KEYS[0],
          defender = stats.role === FOOTBALL_ROLE_KEYS[1];
        add("goals", "Goals", stats.goals, keeper || defender ? 12 : 10);
        add("assists", "Assists", stats.assists, 6);
        const opposing = player.teamId === state.teams?.home ? "away" : "home";
        if (
          !state.terminal &&
          timedCompleted(state) &&
          stats.activeIntervals.length &&
          (keeper || defender) &&
          state.points[opposing] === 0
        )
          add("clean_sheet", "Clean sheet", 1, keeper ? 8 : 4);
        add("own_goals", "Own goals", stats.ownGoals, -4);
        add("yellow_cards", "Yellow cards", stats.yellowCards, -1);
        add("red_cards", "Red cards", stats.redCards, -5);
      }
      return [id, { points: lines.reduce((sum, line) => sum + line.points, 0), lines }];
    }),
  );
}
export function timedDiscipline(lines: readonly AwardLine[]): number {
  const sum = (codes: readonly string[]) =>
    lines.reduce((n, line) => n + (codes.includes(line.code) ? line.points : 0), 0);
  return Math.max(sum(["goals", "assists"]), sum(["clean_sheet"]), sum(["points"]));
}
export function pickTimedMatchAwards(
  candidates: readonly AwardCandidate[],
  result: DerivedResult | null,
) {
  if (!result) return { player_of_match: null, fighter_of_match: null };
  const winner = result.winnerTeamId;
  const ranked = [...candidates].sort(
    (a, b) =>
      b.points - a.points ||
      Number(b.teamId === winner) - Number(a.teamId === winner) ||
      timedDiscipline(b.lines) - timedDiscipline(a.lines) ||
      compareId(a.registrationId, b.registrationId),
  );
  let player = ranked[0] ?? null;
  if (winner && player?.teamId !== winner)
    player = ranked.slice(0, 3).find((row) => row.teamId === winner) ?? player;
  return {
    player_of_match: player,
    fighter_of_match: winner
      ? (ranked.find(
          (row) => row.teamId !== winner && row.registrationId !== player?.registrationId,
        ) ?? null)
      : null,
  };
}
