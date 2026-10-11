import type { Conditions } from "../conditions";
import type { FormatSpec } from "../formats";
import type { SeasonScoringRules } from "../season-rules";
import type {
  BallPayload,
  BattingHand,
  DeliveryEventType,
  DeliveryEventPayloads,
  MatchEvent,
  Phase,
  PlayerLine,
} from "../types";

export type TypedMatchEvent = {
  [T in DeliveryEventType]: MatchEvent<T, DeliveryEventPayloads[T]>;
}[DeliveryEventType];
export type BatterLine = NonNullable<PlayerLine["batting"]>;
export type BowlerLine = NonNullable<PlayerLine["bowling"]>;
export interface BallSummary extends BallPayload {
  eventId: string;
  seq: number;
  legal: boolean;
  total: number;
  over: string;
  clientRecordedAt: string;
  conditions: Conditions;
  batterHand?: BattingHand;
  bowlerStyle?: string;
}
export interface InningsScorePoint {
  seq: number;
  kind: "opening" | "delivery" | "penalty" | "retirement";
  runs: number;
  wickets: number;
  legalBalls: number;
  completedOvers: number;
  ballsInOver: number;
  subsequent: boolean;
}
export interface InningsState {
  scoreTrace: InningsScorePoint[];
  miscountedOvers: Record<string, number>;
  completedOvers: number;
  ballsInOver: number;
  targetMethod: "manual" | "dls" | null;
  no: number;
  superOver: boolean;
  battingTeamId: string;
  bowlingTeamId: string;
  runs: number;
  wickets: number;
  legalBalls: number;
  maxBalls: number | null;
  target: number | null;
  extras: { wides: number; noBalls: number; byes: number; legByes: number; penalty: number };
  strikerId: string | null;
  nonStrikerId: string | null;
  bowlerId: string | null;
  batters: Record<string, BatterLine>;
  bowlers: Record<string, BowlerLine>;
  battedOrder: string[];
  outIds: string[];
  retiredHurt: string[];
  absentBatterIds: string[];
  overs: { bowlerId: string; balls: BallSummary[] }[];
  fallOfWickets: { runs: number; wickets: number; legalBalls: number; playerOutId: string }[];
  freeHitNext: boolean;
  closed: null | "all_out" | "overs" | "target" | "declared" | "forfeit" | "no_more_batters";
  lastBowlerOfPreviousOver: string | null;
  conditionsAtBall: Conditions;
  retirePromptDue: string | null;
}
export interface MatchState {
  readonly eventHistory: readonly MatchEvent[];
  originalTieSetting: SeasonScoringRules["superOverTie"] | null;
  superOverTie: SeasonScoringRules["superOverTie"];
  pendingSuperOver: { inningsNo: number; battingTeamId: string }[];
  phase: Phase;
  attempt: number;
  competition: { name: string; season: string } | null;
  format: FormatSpec | null;
  conditions: Conditions;
  teams: { home: string; away: string } | null;
  lineups: Record<
    string,
    {
      battingOrder: string[];
      captainId: string;
      keeperId: string;
      substitutes: string[];
      out: string[];
    }
  >;
  toss: { winnerTeamId: string; decision: "bat" | "bowl" } | null;
  innings: InningsState[];
  currentInnings: number | null;
  interrupted: { reason: string } | null;
  outcome: "no_result" | "abandoned" | "walkover" | "void" | null;
  walkoverWinner: string | null;
  finished: boolean;
  styles: Record<string, { battingHand?: BattingHand; bowlingStyle?: string }>;
  penaltyRuns: { teamId: string; runs: number; inningsNo: number | null }[];
  lastSeq: number;
  lastEventAt: string | null;
  lastBallAt: string | null;
}

export function initialState(attempt = 1): MatchState {
  return {
    eventHistory: [],
    originalTieSetting: null,
    superOverTie: "another",
    pendingSuperOver: [],
    phase: "not_started",
    attempt,
    competition: null,
    format: null,
    conditions: {},
    teams: null,
    lineups: {},
    toss: null,
    innings: [],
    currentInnings: null,
    interrupted: null,
    outcome: null,
    walkoverWinner: null,
    finished: false,
    styles: {},
    penaltyRuns: [],
    lastSeq: 0,
    lastEventAt: null,
    lastBallAt: null,
  };
}

export function copyConditions(conditions: Conditions): Conditions {
  return { ...conditions, ...(conditions.ball ? { ball: { ...conditions.ball } } : {}) };
}

export function batterLine(position: number): BatterLine {
  return {
    runs: 0,
    balls: 0,
    fours: 0,
    sixes: 0,
    out: false,
    howOut: null,
    position,
    notOut: true,
    retiredHurt: false,
  };
}

export function bowlerLine(): BowlerLine {
  return { legalBalls: 0, maiden: 0, runs: 0, wickets: 0, dots: 0, wides: 0, noBalls: 0 };
}

export function currentInnings(state: MatchState): InningsState | undefined {
  return state.currentInnings === null ? undefined : state.innings[state.currentInnings];
}

/** Copy only the inning that a transition is about to change. */
export function copyInnings(innings: InningsState): InningsState {
  return {
    ...innings,
    scoreTrace: [...innings.scoreTrace],
    miscountedOvers: { ...innings.miscountedOvers },
    extras: { ...innings.extras },
    batters: Object.fromEntries(
      Object.entries(innings.batters).map(([id, line]) => [id, { ...line }]),
    ),
    bowlers: Object.fromEntries(
      Object.entries(innings.bowlers).map(([id, line]) => [id, { ...line }]),
    ),
    battedOrder: [...innings.battedOrder],
    outIds: [...innings.outIds],
    retiredHurt: [...innings.retiredHurt],
    absentBatterIds: [...innings.absentBatterIds],
    overs: innings.overs.map((over) => ({ ...over, balls: [...over.balls] })),
    fallOfWickets: [...innings.fallOfWickets],
    conditionsAtBall: copyConditions(innings.conditionsAtBall),
  };
}
