import type { EventPayloads } from "../delivery/payloads";
import type { RallyFormat } from "./formats";
export type Side = "home" | "away";
export type RallyEnd = "ace" | "winner" | "error" | "kill" | "block" | "fault";
export type RallyEventPayloads = Pick<
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
    format: RallyFormat;
  };
  lineup_confirmed: { teamId: string; players: string[] };
  rubber_started: {
    rubberNo: number;
    homePlayers: string[];
    awayPlayers: string[];
    firstServer: Side;
  };
  rally: { winner: Side; endedBy?: RallyEnd; playerId?: string };
  game_conceded: { side: Side };
  rubber_conceded: { side: Side };
  timeout: { side: Side };
  substitute: { side: Side; inId: string; outId: string };
  amend: { payload: RallyEventPayloads[Exclude<keyof RallyEventPayloads, "amend" | "void">] };
};
