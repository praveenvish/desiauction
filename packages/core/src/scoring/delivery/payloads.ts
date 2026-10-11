import type { CricketBowlingStyle } from "../../sports/cricket";
import type { Conditions } from "../conditions";
import type { FormatSpec } from "../formats";
import type { SeasonScoringRules } from "../season-rules";

export type BowlingStyleKey = CricketBowlingStyle;
/** Canonical scoring wire values, independently guarded by sport-vocabulary.test.ts. */
export type Phase =
  | "not_started"
  | "toss"
  | "live"
  | "innings_break"
  | "interrupted"
  | "result_reached"
  | "finished"
  | "final"
  | "stalled"
  | "no_result"
  | "abandoned"
  | "walkover"
  | "void";
export type TrustLevel = "verified" | "confirmed" | "self_scored" | "flagged";
export type ZoneKey =
  | "long_off"
  | "cover"
  | "point"
  | "third_man"
  | "fine_leg"
  | "square_leg"
  | "mid_wicket"
  | "long_on";
export type WicketKind =
  | "bowled"
  | "caught"
  | "lbw"
  | "stumped"
  | "run_out"
  | "hit_wicket"
  | "obstructing"
  | "hit_twice"
  | "timed_out"
  | "caught_and_bowled";
export type RejectReason =
  | "not_live"
  | "wrong_attempt"
  | "unknown_player"
  | "not_batting"
  | "bowler_not_fielding"
  | "bowler_consecutive"
  | "bowler_quota"
  | "illegal_wicket_on_extra"
  | "free_hit_dismissal"
  | "runs_out_of_range"
  | "boundary_mismatch"
  | "innings_over"
  | "no_open_innings"
  | "target_reached"
  | "already_finished"
  | "unknown_target"
  | "amend_type_mismatch"
  | "amend_breaks_later_events"
  | "bad_payload"
  | "duplicate";
export type ValidationResult = { ok: true } | { ok: false; reason: RejectReason; detail?: string };
export type ApplyResult<S> =
  { ok: true; state: S } | { ok: false; reason: RejectReason; detail?: string };

export interface BallPayload {
  bowlerId: string;
  strikerId: string;
  nonStrikerId: string | null;
  runsBat: number;
  extras: { wides?: number; noBall?: true; noBallRuns?: number; byes?: number; legByes?: number };
  boundary?: 4 | 6;
  shot?: { zone: ZoneKey; angle: number };
  wicket?: {
    kind: WicketKind;
    playerOutId: string;
    fielderIds: string[];
    substituteFielderIds?: string[];
    unknownFielderCount?: number;
    where?: { x: number; y: number };
    runsCompleted?: number;
  };
}

export interface EventPayloads<Hand extends string = never> {
  match_started: {
    competition?: { name: string; season: string };
    superOverTie?: SeasonScoringRules["superOverTie"];
    format: FormatSpec;
    conditions: Conditions;
    homeTeamId: string;
    awayTeamId: string;
  };
  lineup_confirmed: {
    teamId: string;
    battingOrder: string[];
    captainId: string;
    keeperId: string;
    substitutes: string[];
  };
  toss: { winnerTeamId: string; decision: "bat" | "bowl" };
  innings_started: {
    absentBatterIds?: string[];
    miscountedOvers?: Record<string, number>;
    inningsNo: number;
    battingTeamId: string;
    strikerId: string;
    nonStrikerId: string | null;
    bowlerId: string;
    superOver?: boolean;
  };
  ball: BallPayload;
  new_batter: { registrationId: string; end: "striker" | "non_striker" };
  bowler_set: { bowlerId: string; midOver: boolean; reason?: "injury" | "suspended" | "other" };
  strike_swapped: Record<string, never>;
  retire: { registrationId: string; kind: "hurt" | "out" };
  resume_batting: { registrationId: string };
  penalty_runs: {
    teamId: string;
    runs: 5;
    reason: "fielding" | "helmet" | "time_wasting" | "pitch_damage" | "other";
  };
  substitute: {
    teamId: string;
    inId: string;
    outId: string;
    kind: "injury" | "concussion" | "impact" | "tactical";
  };
  player_added: { teamId: string; registrationId: string };
  conditions_changed: { conditions: Partial<Conditions> };
  style_set: {
    registrationId: string;
    battingHand?: Hand;
    bowlingStyle?: BowlingStyleKey;
  };
  interrupt: { reason: "rain" | "bad_light" | "other"; note?: string };
  resume: Record<string, never>;
  revise: { inningsNo: number; maxBalls: number; targetRuns?: number; method: "manual" | "dls" };
  innings_closed: { reason: "declared" | "forfeit" | "no_more_batters" };
  super_over_started: Record<string, never>;
  abandon: { kind: "no_result" | "abandoned"; reason: string };
  walkover: { winnerTeamId: string; reason: string };
  restart: { reason: string };
  match_voided: { reason: string };
  void: Record<string, never>;
  amend: { payload: EventPayloads<Hand>[Exclude<keyof EventPayloads<Hand>, "amend" | "void">] };
  finish: Record<string, never>;
}
