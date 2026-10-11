import type { NameBook, PublicLiveState } from "../types";
import type { RaidState } from "./state";
import type { Side } from "./payloads";
import { deriveRaidResult } from "./result";
export interface RaidPanel {
  v: 1;
  formatKey: "pkl_40" | "kabaddi_30" | null;
  half: 0 | 1 | 2;
  halfClosed: boolean;
  clockAnchorAtMs: number | null;
  halfDurationMs: number;
  halfElapsedMs: number;
  running: boolean;
  raidElapsedMs: number;
  nextRaidingSide: Side;
  points: Record<Side, number>;
  matCount: Record<Side, number>;
  outCount: Record<Side, number>;
  doOrDie: Record<Side, boolean>;
}
export function raidPublicLiveState(state: RaidState, names: NameBook): PublicLiveState<RaidPanel> {
  const team = (side: Side) => {
    const id = state.teams?.[side] ?? side;
    return names.teams[id] ?? { id, name: id, initials: id.slice(0, 2).toUpperCase() };
  };
  const result = deriveRaidResult(state);
  return {
    family: "raid",
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
      formatKey: (state.format?.key as RaidPanel["formatKey"]) ?? null,
      half: state.half,
      halfClosed: state.halfClosed,
      clockAnchorAtMs: state.anchorAt,
      halfDurationMs: (state.format?.halfMinutes ?? 0) * 60000,
      halfElapsedMs: state.halfElapsedMs,
      running: state.running,
      raidElapsedMs: Math.min(
        30000,
        state.raidStartGameMs === null ? 0 : state.gameElapsedMs - state.raidStartGameMs,
      ),
      nextRaidingSide: state.nextRaidingSide,
      points: { ...state.points },
      matCount: { home: state.mat.home.length, away: state.mat.away.length },
      outCount: { home: state.outs.home.length, away: state.outs.away.length },
      doOrDie: { home: state.empty.home >= 2, away: state.empty.away >= 2 },
    },
  };
}
