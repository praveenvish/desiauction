import type { EventPayloads } from "../delivery/payloads";
import type { TimedFormat } from "./formats";
export type Side = "home" | "away";
export type TimedEventPayloads = Pick<
  EventPayloads,
  | "conditions_changed"
  | "interrupt"
  | "resume"
  | "abandon"
  | "walkover"
  | "finish"
  | "restart"
  | "match_voided"
  | "void"
> & {
  match_started: Omit<EventPayloads["match_started"], "format" | "superOverTie"> & {
    format: TimedFormat;
  };
  lineup_confirmed: {
    teamId: string;
    players: string[];
    startingActive: string[];
    roles?: Record<string, string>;
  };
  period_started: { period: number };
  period_ended: { period: number };
  clock: { running: boolean };
  score: {
    teamId: string;
    points: number;
    scorerId?: string;
    assistId?: string;
    ownGoal?: boolean;
    penalty?: boolean;
  };
  card: { playerId: string; colour: "yellow" | "red" | "green" };
  sub: { teamId: string; inId: string; outId: string };
  foul: { playerId: string; teamId: string };
  shootout_attempt: { teamId: string; playerId: string; scored: boolean };
  amend: { payload: TimedEventPayloads[Exclude<keyof TimedEventPayloads, "amend" | "void">] };
};
