import type { BattingHand, EventPayloads } from "@desiauction/core/scoring";
export interface SetupPlayer {
  id: string;
  name: string;
  photoUrl: string | null;
  isCaptain: boolean;
  keeper: boolean;
  style: string;
  battingHand?: BattingHand | null;
  bowlingStyle?: string | null;
}
export interface SetupTeam {
  id: string;
  name: string;
  color?: string | null;
  players: SetupPlayer[];
  selectedIds: string[];
}
export function prefillLineup(
  team: SetupTeam,
  playersPerSide: number,
): EventPayloads["lineup_confirmed"] {
  const approved = new Set(team.players.map((p) => p.id));
  const picked = [...new Set(team.selectedIds.filter((id) => approved.has(id)))];
  const battingOrder = (picked.length ? picked : team.players.map((p) => p.id)).slice(
    0,
    playersPerSide,
  );
  const first = battingOrder[0] ?? "";
  return {
    teamId: team.id,
    battingOrder,
    captainId: team.players.find((p) => p.isCaptain && battingOrder.includes(p.id))?.id ?? first,
    keeperId: team.players.find((p) => p.keeper && battingOrder.includes(p.id))?.id ?? first,
    substitutes: [],
  };
}
export function movePlayer(order: string[], id: string, offset: number): string[] {
  const from = order.indexOf(id);
  const to = from + offset;
  if (from < 0 || to < 0 || to >= order.length) return order;
  const next = [...order];
  next.splice(from, 1);
  next.splice(to, 0, id);
  return next;
}
export function validLineup(lineup: EventPayloads["lineup_confirmed"], maximum: number): boolean {
  const ids = new Set(lineup.battingOrder);
  return (
    ids.size === lineup.battingOrder.length &&
    ids.size >= 2 &&
    ids.size <= maximum &&
    ids.has(lineup.captainId) &&
    ids.has(lineup.keeperId) &&
    new Set(lineup.substitutes).size === lineup.substitutes.length &&
    lineup.substitutes.every((id) => !ids.has(id))
  );
}
export function battingFirst(
  homeId: string,
  awayId: string,
  winner: string,
  decision: "bat" | "bowl",
) {
  if (winner !== homeId && winner !== awayId) return null;
  return decision === "bat" ? winner : winner === homeId ? awayId : homeId;
}
/** Browser-generated ULID envelope; no database/runtime dependency in the setup bundle. */
export function scoringEventId(now = Date.now()): string {
  const alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
  let time = "";
  let value = now;
  for (let i = 0; i < 10; i++) {
    time = alphabet.charAt(value % 32) + time;
    value = Math.floor(value / 32);
  }
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return time + Array.from(bytes, (b) => alphabet.charAt(b & 31)).join("");
}
export function setupDeviceId(): string {
  const key = "ls1:device";
  const existing = localStorage.getItem(key);
  if (existing) return existing;
  const id = crypto.randomUUID();
  localStorage.setItem(key, id);
  return id;
}
