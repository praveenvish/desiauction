import type { MatchState } from "../delivery/state";
import { BOWLER_WICKETS } from "../delivery/wickets";
import type { AwardLine, PlayerLine } from "../types";

export interface MatchScore {
  points: number;
  lines: AwardLine[];
}
export const roundPoint = (value: number): number => Math.round(value * 10) / 10;
export function scoreMatch(
  players: ReadonlyMap<string, PlayerLine>,
  state: MatchState,
  formatKey: string,
): Map<string, MatchScore> {
  const box = formatKey === "box_6";
  const long = formatKey === "t20" || formatKey === "odi";
  const cap = long ? 10 : box ? 6 : 8;
  const innings = state.innings.filter((value) => !value.superOver);
  const balls = innings.reduce((sum, value) => sum + value.legalBalls, 0);
  const rate = balls ? innings.reduce((sum, value) => sum + value.runs, 0) / balls : 0;
  const bonuses = new Map<string, { bowled: number; top: number; assists: number }>();
  const bonus = (id: string) => {
    let value = bonuses.get(id);
    if (!value) {
      value = { bowled: 0, top: 0, assists: 0 };
      bonuses.set(id, value);
    }
    return value;
  };
  for (const inning of innings)
    for (const over of inning.overs)
      for (const ball of over.balls) {
        const wicket = ball.wicket;
        if (!wicket) continue;
        if (BOWLER_WICKETS.includes(wicket.kind)) {
          const value = bonus(ball.bowlerId);
          if (["bowled", "lbw", "hit_wicket"].includes(wicket.kind)) value.bowled++;
          const batter = inning.batters[wicket.playerOutId];
          // Fall-of-wicket position in the effective record supplies the dismissal's run total.
          const priorRuns = inning.overs
            .flatMap((item) => item.balls)
            .filter((item) => item.seq <= ball.seq && item.strikerId === wicket.playerOutId)
            .reduce((sum, item) => sum + item.runsBat, 0);
          if (batter && (batter.position <= 3 || priorRuns >= 20)) value.top++;
        }
        if (
          wicket.kind === "run_out" &&
          new Set(wicket.fielderIds).size + (wicket.unknownFielderCount ?? 0) === 2
        )
          for (const id of new Set(wicket.fielderIds)) bonus(id).assists++;
      }
  const scores = new Map<string, MatchScore>();
  for (const [id, player] of players) {
    const lines: AwardLine[] = [];
    const add = (code: string, label: string, qty: number, points: number) => {
      if (qty !== 0) lines.push({ code, label, qty, points: roundPoint(points) });
    };
    const context = (value: number) => Math.max(-cap, Math.min(cap, value));
    const batting = player.batting;
    if (batting) {
      add("runs", "Runs", batting.runs, batting.runs);
      add("fours", "Fours", batting.fours, batting.fours);
      add("sixes", "Sixes", batting.sixes, batting.sixes * 2);
      const milestones: readonly (readonly [number, number])[] = long
        ? [
            [100, 16],
            [50, 8],
            [30, 4],
          ]
        : box
          ? [
              [30, 8],
              [20, 4],
            ]
          : [
              [50, 10],
              [25, 4],
            ];
      const milestone = milestones.find(([runs]) => batting.runs >= runs);
      if (milestone)
        add(
          `milestone_${String(milestone[0])}`,
          `Reached ${String(milestone[0])}`,
          1,
          milestone[1],
        );
      if (balls && batting.balls >= (long ? 10 : box ? 5 : 6))
        add(
          "pace_vs_match",
          "Faster than the match",
          batting.balls,
          context(0.5 * (batting.runs - batting.balls * rate)),
        );
      if (batting.out && batting.runs === 0 && batting.balls >= 1 && batting.position <= 7 && !box)
        add("duck", "Duck", 1, -2);
    }
    const bowling = player.bowling;
    const extra = bonuses.get(id);
    if (bowling) {
      add("wickets", "Wickets", bowling.wickets, bowling.wickets * (box ? 15 : 20));
      add(
        "bowled_lbw_bonus",
        "Bowled, LBW or hit wicket",
        extra?.bowled ?? 0,
        (extra?.bowled ?? 0) * 4,
      );
      add(
        "top_order_bonus",
        "Top-order or set batter",
        extra?.top ?? 0,
        (extra?.top ?? 0) * (box ? 3 : 4),
      );
      const hauls: readonly (readonly [number, number])[] = long
        ? [
            [5, 16],
            [4, 10],
            [3, 6],
          ]
        : [
            [3, 8],
            [2, 4],
          ];
      const haul = hauls.find(([count]) => bowling.wickets >= count);
      if (haul) add("haul", "Wicket haul", 1, haul[1]);
      add("dots", "Dot balls", bowling.dots, bowling.dots * (long ? 0.5 : 1));
      add("maidens", "Maiden overs", bowling.maiden, bowling.maiden * (long ? 8 : 12));
      if (balls && bowling.legalBalls >= (long ? 12 : 6))
        add(
          "economy_vs_match",
          "Cheaper than the match",
          bowling.legalBalls,
          context(0.5 * (bowling.legalBalls * rate - bowling.runs)),
        );
    }
    if (player.fielding) {
      add("catches", "Catches", player.fielding.catches, player.fielding.catches * 8);
      add("stumpings", "Stumpings", player.fielding.stumpings, player.fielding.stumpings * 10);
      add(
        "run_out_direct",
        "Direct run-outs",
        player.fielding.runOutsDirect,
        player.fielding.runOutsDirect * 10,
      );
      add("run_out_assist", "Assisted run-outs", extra?.assists ?? 0, (extra?.assists ?? 0) * 5);
    }
    scores.set(id, {
      points: roundPoint(lines.reduce((sum, line) => sum + line.points, 0)),
      lines,
    });
  }
  return scores;
}
