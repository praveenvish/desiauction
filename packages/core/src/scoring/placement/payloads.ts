import type { Conditions } from "../conditions";
import type { EventPayloads } from "../delivery/payloads";
import type { PlacementFormat } from "./format-types";
export interface LobbyRound {
  round: number;
  rows: { teamId: string; placement: number; kills: number; playerKills: Record<string, number> }[];
}
export type PlacementEventPayloads = Pick<
  EventPayloads,
  | "interrupt"
  | "resume"
  | "finish"
  | "abandon"
  | "restart"
  | "match_voided"
  | "void"
  | "conditions_changed"
> & {
  match_started: {
    format: PlacementFormat;
    conditions: Conditions;
    teamIds: string[];
    competition?: { name: string; season: string };
  };
  lineup_confirmed: { teamId: string; players: string[] };
  lobby_round: LobbyRound;
  amend: {
    payload: PlacementEventPayloads[Exclude<keyof PlacementEventPayloads, "amend" | "void">];
  };
};
