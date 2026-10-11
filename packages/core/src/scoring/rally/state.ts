import type { Conditions } from "../conditions";
import type { MatchEvent, Phase, PlayerLine } from "../types";
import type { RallyFormat } from "./formats";
import type { RallyEnd, Side } from "./events";
export interface RallyGame {
  no: number;
  points: Record<Side, number>;
  firstServer: Side;
  server: Side;
  winner: Side | null;
}
export interface Rubber {
  no: number;
  active: Record<Side, string[]>;
  games: RallyGame[];
  winner: Side | null;
}
export interface RallyState {
  family: "rally";
  attempt: number;
  lastSeq: number;
  lastEventAt: string | null;
  eventHistory: readonly MatchEvent[];
  format: RallyFormat | null;
  conditions: Conditions;
  competition: { name: string; season: string } | null;
  teams: Record<Side, string> | null;
  squads: Record<string, string[]>;
  rubbers: Rubber[];
  rallies: {
    eventId: string;
    seq: number;
    clientRecordedAt: string;
    winner: Side;
    endedBy?: RallyEnd;
    playerId?: string;
  }[];
  participants: Record<string, { teamId: string; stats: NonNullable<PlayerLine["rally"]> }>;
  interrupted: boolean;
  finished: boolean;
  phase: Phase;
  terminal: "no_result" | "abandoned" | "walkover" | "void" | null;
  walkoverWinner: string | null;
  streak: { side: Side; count: number } | null;
}
export function initialRallyState(attempt = 1): RallyState {
  return {
    family: "rally",
    attempt,
    lastSeq: 0,
    lastEventAt: null,
    eventHistory: [],
    format: null,
    conditions: {},
    competition: null,
    teams: null,
    squads: {},
    rubbers: [],
    participants: {},
    rallies: [],
    interrupted: false,
    finished: false,
    phase: "not_started",
    terminal: null,
    walkoverWinner: null,
    streak: null,
  };
}
export function other(side: Side): Side {
  return side === "home" ? "away" : "home";
}
export function rubberWins(state: RallyState): Record<Side, number> {
  return {
    home: state.rubbers.filter((r) => r.winner === "home").length,
    away: state.rubbers.filter((r) => r.winner === "away").length,
  };
}
export function fixtureWinner(state: RallyState): Side | null {
  if (!state.format) return null;
  const wins = rubberWins(state),
    needed = Math.ceil(state.format.rubbers / 2);
  return wins.home >= needed ? "home" : wins.away >= needed ? "away" : null;
}
