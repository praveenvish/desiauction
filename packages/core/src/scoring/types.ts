import type { PlacementEventPayloads } from "./placement/payloads";
import type { TimedEventPayloads } from "./timed/payloads";
import type { TimedStats } from "./timed/stats";
import type { RaidEventPayloads } from "./raid/payloads";
import type { RallyEventPayloads } from "./rally/payloads";
import type { Conditions } from "./conditions";
import type { EventPayloads as DeliveryPayloadMap, Phase, TrustLevel } from "./delivery/payloads";
export * from "./delivery/payloads";
export const BATTING_HANDS = ["right", "left"] as const;
export type BattingHand = (typeof BATTING_HANDS)[number];
export type EventPayloads = DeliveryPayloadMap<BattingHand>;

/** Existing delivery payload aliases remain sealed for compatibility. */
export type DeliveryEventPayloads = EventPayloads;
export type DeliveryEventType = keyof DeliveryEventPayloads;
type FamilyPayload<T> =
  | (T extends keyof EventPayloads ? EventPayloads[T] : never)
  | (T extends keyof RallyEventPayloads ? RallyEventPayloads[T] : never)
  | (T extends keyof RaidEventPayloads ? RaidEventPayloads[T] : never)
  | (T extends keyof TimedEventPayloads ? TimedEventPayloads[T] : never)
  | (T extends keyof PlacementEventPayloads ? PlacementEventPayloads[T] : never);
export type FamilyEventPayloads = {
  [
    T in
      | keyof EventPayloads
      | keyof RallyEventPayloads
      | keyof RaidEventPayloads
      | keyof TimedEventPayloads
      | keyof PlacementEventPayloads
  ]: FamilyPayload<T>;
};
export type EventType = keyof FamilyEventPayloads;
export type PayloadOf<T extends EventType> = T extends keyof EventPayloads
  ? EventPayloads[T]
  : T extends keyof RallyEventPayloads
    ? RallyEventPayloads[T]
    : T extends keyof RaidEventPayloads
      ? RaidEventPayloads[T]
      : T extends keyof TimedEventPayloads
        ? TimedEventPayloads[T]
        : T extends keyof PlacementEventPayloads
          ? PlacementEventPayloads[T]
          : never;
export interface MatchEvent<
  T extends EventType = EventType,
  P =
    | PayloadOf<T>
    | (T extends keyof RallyEventPayloads ? RallyEventPayloads[T] : never)
    | (T extends keyof RaidEventPayloads ? RaidEventPayloads[T] : never)
    | (T extends keyof TimedEventPayloads ? TimedEventPayloads[T] : never)
    | (T extends keyof PlacementEventPayloads ? PlacementEventPayloads[T] : never),
> {
  readonly eventId: string;
  readonly seq: number;
  readonly attempt: number;
  readonly type: T;
  readonly v: 1;
  readonly payload: P;
  readonly targetEventId: string | null;
  readonly actorPersonId: string;
  readonly clientSeq: number;
  readonly clientRecordedAt: string;
}

export interface DerivedResult {
  outcome: "home_win" | "away_win" | "tie" | "no_result" | "abandoned";
  winnerTeamId: string | null;
  marginText: string;
  method: "super_over" | "dls" | "manual_target" | "walkover" | "penalties" | null;
}

export type NextAction =
  | { kind: "confirm_conditions" }
  | { kind: "confirm_lineup"; teamId: string }
  | { kind: "record_toss" }
  | { kind: "start_innings"; inningsNo: number; battingTeamId: string }
  | { kind: "pick_new_batter"; end: "striker" | "non_striker"; suggestedId: string | null }
  | {
      kind: "pick_bowler";
      allowed: string[];
      blocked: { id: string; reason: "consecutive" | "quota" | "subbed_out" }[];
      suggestedId: string | null;
    }
  | { kind: "record_ball"; freeHit: boolean }
  | { kind: "resume" }
  | { kind: "start_super_over" }
  | { kind: "finish"; result: DerivedResult }
  | { kind: "ask_style"; registrationId: string; what: "battingHand" | "bowlingStyle" }
  | { kind: "retire_prompt"; registrationId: string; atRuns: number };

export interface TeamRef {
  id: string;
  name: string;
  initials: string;
}
export interface PlayerRef {
  name: string;
  initials: string;
  photoUrl: string | null;
}
export interface NameBook {
  teams: Record<string, TeamRef>;
  players: Record<string, PlayerRef>;
}
export interface PublicCharts {
  v: 1;
  seq: number;
  ballsPerOver: number;
  innings: {
    no: number;
    battingTeamId: string;
    superOver: boolean;
    runs: number;
    wickets: number;
    legalBalls: number;
    currentBatterIds: string[];
    batters: { id: string; name: string; initials: string }[];
    shots: { seq: number; batterId: string; angle: number; runs: number; boundary: 4 | 6 | null }[];
    overs: {
      number: number;
      complete: boolean;
      legalBalls: number;
      runs: number;
      wickets: number;
    }[];
    points: {
      seq: number;
      kind: "opening" | "delivery" | "penalty" | "retirement";
      runs: number;
      wickets: number;
      legalBalls: number;
      completedOvers: number;
      ballsInOver: number;
      subsequent: boolean;
    }[];
    adjustments: {
      seq: number;
      kind: "opening" | "penalty" | "retirement";
      runs: number;
      wickets: number;
      legalBalls: number;
      subsequent: boolean;
    }[];
  }[];
}
export interface PublicScorecard {
  v: 1;
  seq: number;
  ballsPerOver: number;
  innings: {
    battingTeamId: string;
    superOver: boolean;
    batting: {
      id: string;
      name: string;
      initials: string;
      runs: number;
      balls: number;
      fours: number;
      sixes: number;
      dismissal: string | null;
      attribution?: {
        bowler: { id: string; name: string; initials: string } | null;
        fielders: { id: string; name: string; initials: string; substitute: boolean }[];
        unknownFielders: number;
      };
      notOut: boolean;
      retiredHurt: boolean;
    }[];
    bowling: {
      id: string;
      name: string;
      initials: string;
      legalBalls: number;
      overs: string;
      maidens: number;
      runs: number;
      wickets: number;
      wides: number;
      noBalls: number;
    }[];
    extras: { wides: number; noBalls: number; byes: number; legByes: number; penalty: number };
  }[];
}
export type ScoringFamily = "delivery" | "rally" | "raid" | "timed" | "placement";
export interface PublicLiveState<P = unknown> {
  family: Exclude<ScoringFamily, "placement">;
  panel: P;
  v: 1;
  seq: number;
  phase: Phase;
  updatedAt: string;
  lastBallAt: string | null;
  teams: { home: TeamRef; away: TeamRef };
  tossLine: string | null;
  conditionsLine: string;
  innings: {
    battingTeamId: string;
    runs: number;
    wickets: number;
    overs: string;
    target: number | null;
    superOver: boolean;
  }[];
  situation: string;
  batters: {
    id: string;
    name: string;
    initials: string;
    photoUrl: string | null;
    runs: number;
    balls: number;
    fours: number;
    sixes: number;
    onStrike: boolean;
    hand: BattingHand | null;
  }[];
  bowler: { id: string; name: string; style: string | null; figures: string } | null;
  thisOver: string[];
  recent: { seq: number; over: string; text: string }[];
  batterShots: Record<string, { angle: number; runs: number }[]>;
  ballsLeft: number | null;
  requiredRate: string | null;
  currentRate: string;
  result: string | null;
  trust: TrustLevel;
}
export interface PublicPlacementState extends Omit<
  PublicLiveState<import("./placement/panel-types").PlacementPanel>,
  "family" | "teams"
> {
  family: "placement";
  teams: TeamRef[];
}
export type PublicScoringState = PublicLiveState | PublicPlacementState;
export interface PlayerLine {
  placement?: { kills: number };
  timed?: TimedStats;
  registrationId: string;
  teamId: string;
  appeared: true;
  batting?: {
    runs: number;
    balls: number;
    fours: number;
    sixes: number;
    out: boolean;
    howOut: string | null;
    position: number;
    notOut: boolean;
    retiredHurt: boolean;
    dismissal?: { seq: number; conditions: Conditions };
    dismissals?: { inningsNo: number; seq: number; conditions: Conditions }[];
  };
  bowling?: {
    legalBalls: number;
    maiden: number;
    runs: number;
    wickets: number;
    dots: number;
    wides: number;
    noBalls: number;
  };
  raid?: {
    raidPoints: number;
    tacklePoints: number;
    successfulRaids: number;
    emptyRaids: number;
    superRaids: number;
    superTackles: number;
    super10: number;
    high5: number;
    doOrDieSuccesses: number;
    tackled: number;
    assists: number;
    greenCards: number;
    yellowCards: number;
    redCards: number;
  };
  rally?: {
    ralliesWon: number;
    aces: number;
    winners: number;
    errors: number;
    kills: number;
    blocks: number;
    faults: number;
  };
  fielding?: { catches: number; stumpings: number; runOutsDirect: number; runOutsAssisted: number };
}
export interface AwardLine {
  code: string;
  label: string;
  qty: number;
  points: number;
}
