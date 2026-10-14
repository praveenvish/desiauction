import type { NameBook, PublicLiveState } from "../types";
import type { TimedState } from "./state";
import type { Side } from "./payloads";
import { deriveTimedResult } from "./result";
export interface TimedPanel {
  v: 1;
  formatKey: string | null;
  period: number;
  periodClosed: boolean;
  periodDurationMs: number;
  periodElapsedMs: number;
  gameClockMs: number;
  clockAnchorAtMs: number | null;
  running: boolean;
  points: Record<Side, number>;
  shootout: {
    points: Record<Side, number>;
    attempts: Record<Side, number>;
    nextSide: Side;
    winner: Side | null;
  } | null;
  timeline: {
    seq: number;
    period: number;
    gameClockMs: number;
    kind: "score" | "card";
    side: Side | null;
    points: number;
    playerName: string | null;
    assistName: string | null;
    colour: "yellow" | "red" | "green" | null;
  }[];
}
export function timedPublicLiveState(
  state: TimedState,
  names: NameBook,
): PublicLiveState<TimedPanel> {
  const team = (side: Side) => {
    const id = state.teams?.[side] ?? side;
    return names.teams[id] ?? { id, name: id, initials: id.slice(0, 2).toUpperCase() };
  };
  const result = deriveTimedResult(state);
  const playerName = (id: string | undefined) => (id ? (names.players[id]?.name ?? null) : null);
  return {
    family: "timed",
    v: 1,
    seq: state.lastSeq,
    phase: state.phase,
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
    trust: "self_scored",
    result: result
      ? `${result.winnerTeamId ? `${names.teams[result.winnerTeamId]?.name ?? "Winner"} won · ` : ""}${result.marginText}`
      : null,
    panel: {
      v: 1,
      formatKey: state.format?.key ?? null,
      period: state.period,
      periodClosed: state.periodClosed,
      periodDurationMs: (state.format?.periodMinutes ?? 0) * 60000,
      periodElapsedMs: state.periodElapsedMs,
      gameClockMs: state.gameClockMs,
      clockAnchorAtMs: state.anchorAt,
      running: state.running,
      points: { ...state.points },
      shootout: state.shootout
        ? {
            points: { ...state.shootout.points },
            attempts: { ...state.shootout.attempts },
            nextSide: state.shootout.nextSide,
            winner: state.shootout.winner,
          }
        : null,
      timeline: state.timeline.slice(-12).map((entry) => ({
        seq: entry.seq,
        period: entry.period,
        gameClockMs: entry.gameClockMs,
        kind: entry.type,
        side:
          entry.type === "score"
            ? entry.payload.teamId === state.teams?.home
              ? "home"
              : "away"
            : null,
        points: entry.type === "score" ? entry.payload.points : 0,
        playerName: playerName(
          entry.type === "score" ? entry.payload.scorerId : entry.payload.playerId,
        ),
        assistName: entry.type === "score" ? playerName(entry.payload.assistId) : null,
        colour: entry.type === "card" ? entry.payload.colour : null,
      })),
    },
  };
}
