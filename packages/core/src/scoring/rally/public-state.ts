import type { NameBook, PublicLiveState } from "../types";
import { deriveRallyResult, rallyResultScore } from "./result";
import type { RallyState } from "./state";
import type { Side } from "./events";
export interface RallyPanel {
  v: 1;
  formatKey: string | null;
  server: Side | null;
  rubberNo: number | null;
  gameNo: number | null;
  points: Record<Side, number>;
  score: { home: Record<string, number>; away: Record<string, number> };
  rubbers: {
    no: number;
    winner: Side | null;
    games: { no: number; home: number; away: number; winner: Side | null }[];
  }[];
  streak: { side: Side; count: number } | null;
}
export function rallyPublicLiveState(
  state: RallyState,
  names: NameBook,
): PublicLiveState<RallyPanel> {
  const team = (side: Side) => {
    const id = state.teams?.[side] ?? side;
    return names.teams[id] ?? { id, name: id, initials: id.slice(0, 2).toUpperCase() };
  };
  const shell = {
    v: 1 as const,
    seq: state.lastSeq,
    updatedAt: state.lastEventAt ?? "",
    lastBallAt: null,
    teams: { home: team("home"), away: team("away") },
    tossLine: null,
    conditionsLine: "",
    innings: [],
    situation: "",
    batters: [],
    bowler: null,
    thisOver: [],
    recent: [],
    batterShots: {},
    ballsLeft: null,
    requiredRate: null,
    currentRate: "",
    trust: "self_scored" as const,
  };
  const result = deriveRallyResult(state);
  const resultText = result
    ? `${result.winnerTeamId ? `${names.teams[result.winnerTeamId]?.name ?? "Winner"} won · ` : ""}${result.marginText}`
    : null;
  const rubber = state.rubbers.at(-1),
    game = rubber?.games.at(-1);
  return {
    ...shell,
    family: "rally",
    phase: state.phase,
    result: resultText,
    panel: {
      v: 1,
      formatKey: state.format?.key ?? null,
      server: game?.server ?? null,
      rubberNo: rubber?.no ?? null,
      gameNo: game?.no ?? null,
      points: game ? { ...game.points } : { home: 0, away: 0 },
      score: rallyResultScore(state),
      rubbers: state.rubbers.map((r) => ({
        no: r.no,
        winner: r.winner,
        games: r.games.map((g) => ({
          no: g.no,
          home: g.points.home,
          away: g.points.away,
          winner: g.winner,
        })),
      })),
      streak: state.streak ? { ...state.streak } : null,
    },
  };
}
