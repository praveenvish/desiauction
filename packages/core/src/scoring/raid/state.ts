import type { Conditions } from "../conditions";
import type { MatchEvent, Phase, PlayerLine } from "../types";
import type { RaidFormat } from "./formats";
import type { Side } from "./payloads";
export type RaidStats = NonNullable<PlayerLine["raid"]>;
export interface RaidState {
  raids: { eventId: string; seq: number; clientRecordedAt: string }[];
  family: "raid";
  attempt: number;
  lastSeq: number;
  lastEventAt: string | null;
  eventHistory: readonly MatchEvent[];
  format: RaidFormat | null;
  conditions: Conditions;
  competition: { name: string; season: string } | null;
  teams: Record<Side, string> | null;
  squads: Record<string, string[]>;
  starters: Record<Side, string[]>;
  mat: Record<Side, string[]>;
  outs: Record<Side, string[]>;
  points: Record<Side, number>;
  empty: Record<Side, number>;
  cards: Record<string, { red: boolean; untilGameMs: number | null; removedFromMat: boolean }>;
  participants: Record<string, { teamId: string; stats: RaidStats }>;
  half: 0 | 1 | 2;
  halfClosed: boolean;
  halfElapsedMs: number;
  gameElapsedMs: number;
  running: boolean;
  anchorAt: number | null;
  raidStartGameMs: number | null;
  nextRaidingSide: Side;
  allOutArmed: Record<Side, boolean>;
  interrupted: boolean;
  finished: boolean;
  phase: Phase;
  terminal: "no_result" | "abandoned" | "walkover" | "void" | null;
  walkoverWinner: string | null;
}
export function emptyRaidStats(): RaidStats {
  return {
    raidPoints: 0,
    tacklePoints: 0,
    successfulRaids: 0,
    emptyRaids: 0,
    superRaids: 0,
    superTackles: 0,
    super10: 0,
    high5: 0,
    doOrDieSuccesses: 0,
    tackled: 0,
    assists: 0,
    greenCards: 0,
    yellowCards: 0,
    redCards: 0,
  };
}
export function initialRaidState(attempt = 1): RaidState {
  return {
    raids: [],
    family: "raid",
    attempt,
    lastSeq: 0,
    lastEventAt: null,
    eventHistory: [],
    format: null,
    conditions: {},
    competition: null,
    teams: null,
    squads: {},
    starters: { home: [], away: [] },
    mat: { home: [], away: [] },
    outs: { home: [], away: [] },
    points: { home: 0, away: 0 },
    empty: { home: 0, away: 0 },
    cards: {},
    participants: {},
    half: 0,
    halfClosed: true,
    halfElapsedMs: 0,
    gameElapsedMs: 0,
    running: false,
    anchorAt: null,
    raidStartGameMs: null,
    nextRaidingSide: "home",
    allOutArmed: { home: true, away: true },
    interrupted: false,
    finished: false,
    phase: "not_started",
    terminal: null,
    walkoverWinner: null,
  };
}
export function other(side: Side): Side {
  return side === "home" ? "away" : "home";
}
export function halfExpired(state: RaidState): boolean {
  return !!state.format && state.halfElapsedMs >= state.format.halfMinutes * 60000;
}
export function completed(state: RaidState): boolean {
  return state.half === 2 && state.halfClosed;
}
