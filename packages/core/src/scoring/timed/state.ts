import type { TimedStats } from "./stats";
export type { TimedStats } from "./stats";
import type { Conditions } from "../conditions";
import type { MatchEvent, Phase } from "../types";
import type { TimedFormat } from "./formats";
import type { Side, TimedEventPayloads } from "./payloads";
export interface TimedState {
  family: "timed";
  attempt: number;
  lastSeq: number;
  lastEventAt: string | null;
  eventHistory: readonly MatchEvent[];
  format: TimedFormat | null;
  conditions: Conditions;
  competition: { name: string; season: string } | null;
  teams: Record<Side, string> | null;
  squads: Record<string, string[]>;
  active: Record<Side, string[]>;
  roles: Record<string, string>;
  red: string[];
  participants: Record<string, { teamId: string; stats: TimedStats }>;
  points: Record<Side, number>;
  period: number;
  periodClosed: boolean;
  periodElapsedMs: number;
  gameClockMs: number;
  running: boolean;
  anchorAt: number | null;
  interrupted: boolean;
  finished: boolean;
  phase: Phase;
  terminal: "no_result" | "abandoned" | "walkover" | "void" | null;
  walkoverWinner: string | null;
  timeline: ({ seq: number; gameClockMs: number; period: number } & (
    | { type: "score"; payload: TimedEventPayloads["score"] }
    | { type: "card"; payload: TimedEventPayloads["card"] }
  ))[];
  shootout: {
    eligible: Record<Side, string[]>;
    used: Record<Side, string[]>;
    attempts: Record<Side, number>;
    points: Record<Side, number>;
    nextSide: Side;
    winner: Side | null;
  } | null;
}
export function emptyTimedStats(role: string | null): TimedStats {
  return {
    role,
    goals: 0,
    points: 0,
    assists: 0,
    ownGoals: 0,
    penaltiesScored: 0,
    fouls: 0,
    yellowCards: 0,
    redCards: 0,
    greenCards: 0,
    shootoutAttempts: 0,
    shootoutConversions: 0,
    activeIntervals: [],
  };
}
export function initialTimedState(attempt = 1): TimedState {
  return {
    family: "timed",
    attempt,
    lastSeq: 0,
    lastEventAt: null,
    eventHistory: [],
    format: null,
    conditions: {},
    competition: null,
    teams: null,
    squads: {},
    active: { home: [], away: [] },
    roles: {},
    red: [],
    participants: {},
    points: { home: 0, away: 0 },
    period: 0,
    periodClosed: true,
    periodElapsedMs: 0,
    gameClockMs: 0,
    running: false,
    anchorAt: null,
    interrupted: false,
    finished: false,
    phase: "not_started",
    terminal: null,
    walkoverWinner: null,
    timeline: [],
    shootout: null,
  };
}
export function timedCompleted(state: TimedState): boolean {
  return !!state.format && state.period === state.format.periods && state.periodClosed;
}
export function other(side: Side): Side {
  return side === "home" ? "away" : "home";
}
