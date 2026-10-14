import type { LobbyPoints } from "../../standings";
import { integer, isRecord, keys, isId } from "../validate-primitives";
import type { PlacementFormat } from "./format-types";
export type { PlacementFormat } from "./format-types";
export function placementFormat(value: unknown): PlacementFormat | null {
  if (
    !isRecord(value) ||
    !keys(value, ["key", "label", "rounds", "points"]) ||
    !isId(value.key) ||
    !isId(value.label) ||
    !integer(value.rounds, 1, 100) ||
    !isRecord(value.points) ||
    !keys(value.points, ["placement", "perScore"]) ||
    !Array.isArray(value.points.placement) ||
    !value.points.placement.length ||
    !value.points.placement.every((x) => integer(x)) ||
    !isRecord(value.points.perScore) ||
    !keys(value.points.perScore, ["kills"]) ||
    !integer(value.points.perScore.kills)
  )
    return null;
  return {
    key: value.key,
    label: value.label,
    rounds: value.rounds,
    points: {
      placement: [...value.points.placement] as number[],
      perScore: { kills: value.points.perScore.kills },
    },
  };
}
export function lobbyFormat(rounds: number, points: LobbyPoints): PlacementFormat {
  const format = placementFormat({
    key: `lobby_${String(rounds)}`,
    label: `${String(rounds)} ${rounds === 1 ? "round" : "rounds"}`,
    rounds,
    points,
  });
  if (!format) throw new Error("Invalid lobby format");
  return format;
}
