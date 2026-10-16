import type { Conditions } from "../conditions";
import type { MatchEvent, Phase } from "../types";
import type { PlacementFormat } from "./format-types";
import type { LobbyRound } from "./payloads";
export interface PlacementState {
  family: "placement";
  attempt: number;
  lastSeq: number;
  lastEventAt: string | null;
  eventHistory: readonly MatchEvent[];
  format: PlacementFormat | null;
  conditions: Conditions;
  competition: { name: string; season: string } | null;
  teamIds: string[];
  squads: Record<string, string[]>;
  rounds: (LobbyRound & { eventId: string; clientRecordedAt: string })[];
  interrupted: boolean;
  finished: boolean;
  phase: Phase;
  terminal: "abandoned" | "void" | null;
}
export function initialPlacementState(attempt = 1): PlacementState {
  return {
    family: "placement",
    attempt,
    lastSeq: 0,
    lastEventAt: null,
    eventHistory: [],
    format: null,
    conditions: {},
    competition: null,
    teamIds: [],
    squads: {},
    rounds: [],
    interrupted: false,
    finished: false,
    phase: "not_started",
    terminal: null,
  };
}
export interface LobbyAggregate {
  teamId: string;
  placement: number;
  points: number;
  kills: number;
}
export function placementTable(state: PlacementState): LobbyAggregate[] {
  const rows = state.teamIds.map((teamId) => ({ teamId, placement: 0, points: 0, kills: 0 }));
  for (const round of state.rounds)
    for (const entry of round.rows) {
      const row = rows.find((x) => x.teamId === entry.teamId);
      if (!row || !state.format) continue;
      row.kills += entry.kills;
      row.points +=
        (state.format.points.placement[entry.placement - 1] ?? 0) +
        entry.kills * (state.format.points.perScore?.["kills"] ?? 0);
    }
  rows.sort((a, b) => b.points - a.points || b.kills - a.kills || a.teamId.localeCompare(b.teamId));
  for (const [i, row] of rows.entries()) {
    const previous = rows[i - 1];
    row.placement =
      previous && previous.points === row.points && previous.kills === row.kills
        ? previous.placement
        : i + 1;
  }
  return rows;
}
export function placementPlayers(state: PlacementState) {
  const players = new Map<string, { teamId: string; kills: number }>();
  for (const round of state.rounds)
    for (const row of round.rows)
      for (const [id, kills] of Object.entries(row.playerKills)) {
        const prior = players.get(id);
        players.set(id, { teamId: row.teamId, kills: (prior?.kills ?? 0) + kills });
      }
  return players;
}
export function topFragger(state: PlacementState): string | null {
  if (state.terminal || !state.finished) return null;
  const table = placementTable(state);
  return (
    [...placementPlayers(state)]
      .filter(([, x]) => x.kills > 0)
      .sort(
        (a, b) =>
          b[1].kills - a[1].kills ||
          (table.find((x) => x.teamId === a[1].teamId)?.placement ?? Infinity) -
            (table.find((x) => x.teamId === b[1].teamId)?.placement ?? Infinity) ||
          a[0].localeCompare(b[0]),
      )[0]?.[0] ?? null
  );
}
