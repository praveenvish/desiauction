import {
  checked,
  ids,
  integer,
  isId,
  isRecord,
  keys,
  oneOf,
  validConditions,
} from "../validate-primitives";
import type { MatchEvent, ValidationResult } from "../types";
import { rallyFormat } from "./formats";
export function validateRallyPayload(type: MatchEvent["type"], payload: unknown): ValidationResult {
  if (!isRecord(payload)) return checked(false);
  const side = (value: unknown) => oneOf(value, ["home", "away"]);
  switch (type) {
    case "match_started":
      return checked(
        keys(payload, ["format", "conditions", "homeTeamId", "awayTeamId", "competition"]) &&
          rallyFormat(payload.format) !== null &&
          validConditions(payload.conditions) &&
          isId(payload.homeTeamId) &&
          isId(payload.awayTeamId) &&
          payload.homeTeamId !== payload.awayTeamId &&
          (payload.competition === undefined ||
            (isRecord(payload.competition) &&
              keys(payload.competition, ["name", "season"]) &&
              isId(payload.competition.name) &&
              isId(payload.competition.season))),
      );
    case "lineup_confirmed":
      return checked(
        keys(payload, ["teamId", "players"]) &&
          isId(payload.teamId) &&
          ids(payload.players) &&
          payload.players.length > 0,
      );
    case "rubber_started":
      return checked(
        keys(payload, ["rubberNo", "homePlayers", "awayPlayers", "firstServer"]) &&
          integer(payload.rubberNo, 1, 5) &&
          ids(payload.homePlayers) &&
          payload.homePlayers.length > 0 &&
          ids(payload.awayPlayers) &&
          payload.awayPlayers.length > 0 &&
          side(payload.firstServer),
      );
    case "rally":
      return checked(
        keys(payload, ["winner", "endedBy", "playerId"]) &&
          side(payload.winner) &&
          (payload.endedBy === undefined ||
            oneOf(payload.endedBy, ["ace", "winner", "error", "kill", "block", "fault"])) &&
          (payload.playerId === undefined || isId(payload.playerId)),
      );
    case "game_conceded":
    case "rubber_conceded":
    case "timeout":
      return checked(keys(payload, ["side"]) && side(payload.side));
    case "substitute":
      return checked(
        keys(payload, ["side", "inId", "outId"]) &&
          side(payload.side) &&
          isId(payload.inId) &&
          isId(payload.outId) &&
          payload.inId !== payload.outId,
      );
    case "conditions_changed":
      return checked(keys(payload, ["conditions"]) && validConditions(payload.conditions));
    case "interrupt":
      return checked(
        keys(payload, ["reason", "note"]) &&
          oneOf(payload.reason, ["rain", "bad_light", "other"]) &&
          (payload.note === undefined || typeof payload.note === "string"),
      );
    case "resume":
    case "finish":
    case "void":
      return checked(keys(payload, []));
    case "amend":
      return checked(keys(payload, ["payload"]) && isRecord(payload.payload));
    case "restart":
    case "match_voided":
      return checked(
        keys(payload, ["reason"]) &&
          isId(payload.reason) &&
          payload.reason.trim().length > 0 &&
          payload.reason.length <= 500,
      );
    case "abandon":
      return checked(
        keys(payload, ["kind", "reason"]) &&
          oneOf(payload.kind, ["no_result", "abandoned"]) &&
          isId(payload.reason),
      );
    case "walkover":
      return checked(
        keys(payload, ["winnerTeamId", "reason"]) &&
          isId(payload.winnerTeamId) &&
          isId(payload.reason),
      );
    default:
      return checked(false);
  }
}
