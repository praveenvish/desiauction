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
import { raidFormat } from "./formats";
export function validateRaidPayload(type: MatchEvent["type"], payload: unknown): ValidationResult {
  if (!isRecord(payload)) return checked(false);
  switch (type) {
    case "match_started":
      return checked(
        keys(payload, ["format", "conditions", "homeTeamId", "awayTeamId", "competition"]) &&
          raidFormat(payload.format) !== null &&
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
        keys(payload, ["teamId", "players", "startingMat"]) &&
          isId(payload.teamId) &&
          ids(payload.players) &&
          payload.players.length >= 7 &&
          ids(payload.startingMat) &&
          payload.startingMat.length === 7 &&
          payload.startingMat.every((id) => (payload.players as string[]).includes(id)),
      );
    case "half_started":
      return checked(keys(payload, ["half"]) && integer(payload.half, 1, 2));
    case "half_ended":
      return checked(keys(payload, []));
    case "clock":
      return checked(keys(payload, ["running"]) && typeof payload.running === "boolean");
    case "raid":
      return checked(
        keys(payload, ["raiderId", "touchedIds", "bonus", "tackled", "tacklerIds", "lineOut"]) &&
          isId(payload.raiderId) &&
          ids(payload.touchedIds) &&
          ids(payload.tacklerIds) &&
          typeof payload.bonus === "boolean" &&
          typeof payload.tackled === "boolean" &&
          (payload.lineOut === undefined || ids(payload.lineOut)),
      );
    case "technical_point":
      return checked(
        keys(payload, ["teamId", "reason"]) && isId(payload.teamId) && isId(payload.reason),
      );
    case "green_card":
    case "yellow_card":
    case "red_card":
      return checked(keys(payload, ["playerId"]) && isId(payload.playerId));
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
