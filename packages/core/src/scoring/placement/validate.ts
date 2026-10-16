import {
  checked,
  integer,
  ids,
  isId,
  isRecord,
  keys,
  validConditions,
} from "../validate-primitives";
import type { MatchEvent, ValidationResult } from "../types";
import { placementFormat } from "./formats";
export function validatePlacementPayload(type: MatchEvent["type"], p: unknown): ValidationResult {
  if (!isRecord(p)) return checked(false);
  switch (type) {
    case "match_started":
      return checked(
        keys(p, ["format", "conditions", "teamIds", "competition"]) &&
          placementFormat(p.format) !== null &&
          validConditions(p.conditions) &&
          ids(p.teamIds) &&
          p.teamIds.length >= 2 &&
          p.teamIds.length <= 25 &&
          (p.competition === undefined ||
            (isRecord(p.competition) &&
              keys(p.competition, ["name", "season"]) &&
              isId(p.competition.name) &&
              isId(p.competition.season))),
      );
    case "lineup_confirmed":
      return checked(
        keys(p, ["teamId", "players"]) && isId(p.teamId) && ids(p.players) && p.players.length > 0,
      );
    case "lobby_round":
      return checked(
        keys(p, ["round", "rows"]) &&
          integer(p.round, 1, 100) &&
          Array.isArray(p.rows) &&
          p.rows.length >= 2 &&
          p.rows.length <= 25 &&
          p.rows.every(
            (row) =>
              isRecord(row) &&
              keys(row, ["teamId", "placement", "kills", "playerKills"]) &&
              isId(row.teamId) &&
              integer(row.placement, 1, 25) &&
              integer(row.kills, 0, 100) &&
              isRecord(row.playerKills) &&
              Object.entries(row.playerKills).every(
                ([id, kills]) => isId(id) && integer(kills, 0, 100),
              ),
          ),
      );
    case "conditions_changed":
      return checked(keys(p, ["conditions"]) && validConditions(p.conditions));
    case "interrupt":
      return checked(
        keys(p, ["reason", "note"]) &&
          ["rain", "bad_light", "other"].includes(String(p.reason)) &&
          (p.note === undefined || typeof p.note === "string"),
      );
    case "abandon":
      return checked(keys(p, ["reason", "kind"]) && isId(p.reason) && p.kind === "abandoned");
    case "restart":
    case "match_voided":
      return checked(keys(p, ["reason"]) && isId(p.reason));
    case "resume":
    case "finish":
    case "void":
      return checked(keys(p, []));
    case "amend":
      return checked(keys(p, ["payload"]) && isRecord(p.payload));
    default:
      return checked(false);
  }
}
