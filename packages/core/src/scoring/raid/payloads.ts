import type { EventPayloads } from "../delivery/payloads";
import type { RaidFormat } from "./formats";
export type Side = "home" | "away";
export type RaidEventPayloads = Pick<
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
    format: RaidFormat;
  };
  lineup_confirmed: { teamId: string; players: string[]; startingMat: string[] };
  half_started: { half: 1 | 2 };
  half_ended: Record<string, never>;
  clock: { running: boolean };
  raid: {
    raiderId: string;
    touchedIds: string[];
    bonus: boolean;
    tackled: boolean;
    tacklerIds: string[];
    lineOut?: string[];
  };
  technical_point: { teamId: string; reason: string };
  green_card: { playerId: string };
  yellow_card: { playerId: string };
  red_card: { playerId: string };
  amend: { payload: RaidEventPayloads[Exclude<keyof RaidEventPayloads, "amend" | "void">] };
};
