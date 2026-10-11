import { randomInt } from "node:crypto";

export const TEAM_ENTRY_CODE = /^[A-HJ-NP-Z2-9]{6}$/;
const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function newTeamEntryCode(): string {
  return Array.from({ length: 6 }, () => alphabet[randomInt(alphabet.length)]).join("");
}

export type TeamFormation = "auction" | "organizer" | "team_entry";
export function isTeamFormation(value: string): value is TeamFormation {
  return value === "auction" || value === "organizer" || value === "team_entry";
}
