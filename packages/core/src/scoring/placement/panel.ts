import { integer, isRecord, isId } from "../validate-primitives";
import type { PlacementPanel } from "./panel-types";
export function projectPlacementPanel(raw: unknown): PlacementPanel | null {
  if (
    !isRecord(raw) ||
    raw.v !== 1 ||
    !integer(raw.round, 0, 100) ||
    !integer(raw.rounds, 0, 100) ||
    raw.round > raw.rounds ||
    !Array.isArray(raw.rows) ||
    raw.rows.length > 25
  )
    return null;
  const rows: PlacementPanel["rows"] = [];
  for (const row of raw.rows) {
    if (
      !isRecord(row) ||
      !isId(row.teamId) ||
      !integer(row.placement, 1, 25) ||
      !integer(row.points) ||
      !integer(row.kills, 0, 10000)
    )
      return null;
    rows.push({
      teamId: row.teamId,
      placement: row.placement,
      points: row.points,
      kills: row.kills,
    });
  }
  if (new Set(rows.map((row) => row.teamId)).size !== rows.length) return null;
  return { v: 1, round: raw.round, rounds: raw.rounds, rows };
}
