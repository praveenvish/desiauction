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
import { timedFormat } from "./formats";
export function validateTimedPayload(type: MatchEvent["type"], payload: unknown): ValidationResult {
  if (!isRecord(payload)) return checked(false);
  switch (type) {
    case "match_started":
      return checked(
        keys(payload, ["format", "conditions", "homeTeamId", "awayTeamId", "competition"]) &&
          timedFormat(payload.format) !== null &&
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
        keys(payload, ["teamId", "players", "startingActive", "roles"]) &&
          isId(payload.teamId) &&
          ids(payload.players) &&
          ids(payload.startingActive) &&
          payload.startingActive.length > 0 &&
          payload.startingActive.every((id) => (payload.players as string[]).includes(id)) &&
          (payload.roles === undefined ||
            (isRecord(payload.roles) &&
              Object.entries(payload.roles).every(
                ([id, role]) => (payload.players as string[]).includes(id) && isId(role),
              ))),
      );
    case "period_started":
    case "period_ended":
      return checked(keys(payload, ["period"]) && integer(payload.period, 1, 4));
    case "clock":
      return checked(keys(payload, ["running"]) && typeof payload.running === "boolean");
    case "score":
      return checked(
        keys(payload, ["teamId", "points", "scorerId", "assistId", "ownGoal", "penalty"]) &&
          isId(payload.teamId) &&
          integer(payload.points, 1, 3) &&
          ["scorerId", "assistId"].every(
            (key) => payload[key] === undefined || isId(payload[key]),
          ) &&
          ["ownGoal", "penalty"].every(
            (key) => payload[key] === undefined || typeof payload[key] === "boolean",
          ),
      );
    case "card":
      return checked(
        keys(payload, ["playerId", "colour"]) &&
          isId(payload.playerId) &&
          oneOf(payload.colour, ["yellow", "red", "green"]),
      );
    case "sub":
      return checked(
        keys(payload, ["teamId", "inId", "outId"]) &&
          isId(payload.teamId) &&
          isId(payload.inId) &&
          isId(payload.outId) &&
          payload.inId !== payload.outId,
      );
    case "foul":
      return checked(
        keys(payload, ["playerId", "teamId"]) && isId(payload.playerId) && isId(payload.teamId),
      );
    case "shootout_attempt":
      return checked(
        keys(payload, ["teamId", "playerId", "scored"]) &&
          isId(payload.teamId) &&
          isId(payload.playerId) &&
          typeof payload.scored === "boolean",
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
