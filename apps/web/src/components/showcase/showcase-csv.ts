import { toCsv } from "@desiauction/core";

// Pure showcase → CSV (Reporting platform). Decoupled row shape so it stays
// component-side and unit-testable; never includes a phone (public export, C-23).

export interface ShowcaseCsvRow {
  number: string;
  name: string;
  role: string;
  age: number | null;
  battingStyle: string | null;
  bowlingStyle: string | null;
  status: string;
  teamName: string | null;
}

export function showcaseToCsv(players: readonly ShowcaseCsvRow[]): string {
  return toCsv(
    ["number", "name", "role", "age", "batting", "bowling", "status", "team"],
    players.map((p) => [
      p.number,
      p.name,
      p.role,
      p.age === null ? "" : String(p.age),
      p.battingStyle ?? "",
      p.bowlingStyle ?? "",
      p.status,
      p.teamName ?? "",
    ]),
  );
}
