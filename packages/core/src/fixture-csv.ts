/**
 * Deterministic fixture CSV parsing + validation (M-IP3-3). Pure — no storage,
 * no IO. Same contract as the registration CSV: the WHOLE file validates before
 * any write and a caller commits only when `errors` is empty (no partial
 * corruption). Team and ground names are resolved against the database at the
 * commit layer; core validates shape and in-file consistency only.
 */

import { isValidKickoff } from "./fixture";
import { tokenizeCsv } from "./registration-csv";

export interface CsvFixtureRow {
  line: number; // 1-based source line (header = line 1)
  homeTeam: string;
  awayTeam: string;
  kickoffAt: string | null; // YYYY-MM-DDTHH:MM (normalized from "date time" too)
  ground: string | null;
  durationMinutes: number;
}

export interface CsvFixtureError {
  line: number;
  message: string;
}

export interface FixtureCsvResult {
  rows: CsvFixtureRow[];
  errors: CsvFixtureError[];
}

const REQUIRED_HEADER = ["home_team", "away_team"] as const;
export const FIXTURE_CSV_HEADER = "home_team,away_team,kickoff,ground,duration_minutes";
export const DEFAULT_FIXTURE_DURATION_MINUTES = 180;

/** Accept "YYYY-MM-DDTHH:MM" or "YYYY-MM-DD HH:MM"; normalize to the T form. */
function normalizeKickoff(raw: string): string | null {
  const candidate = raw.includes("T") ? raw : raw.replace(" ", "T");
  return isValidKickoff(candidate) ? candidate : null;
}

export function parseFixtureCsv(text: string): FixtureCsvResult {
  const records = tokenizeCsv(text).filter(
    (fields) => !(fields.length === 1 && fields[0]?.trim() === ""),
  );
  if (records.length === 0) {
    return { rows: [], errors: [{ line: 1, message: "The file is empty." }] };
  }

  const header = (records[0] ?? []).map((h) => h.trim().toLowerCase());
  const index: Record<string, number> = {};
  header.forEach((h, i) => {
    index[h] = i;
  });
  const missing = REQUIRED_HEADER.filter((h) => index[h] === undefined);
  if (missing.length > 0) {
    return {
      rows: [],
      errors: [{ line: 1, message: `Missing required column(s): ${missing.join(", ")}.` }],
    };
  }

  const cell = (fields: string[], name: string): string => (fields[index[name] ?? -1] ?? "").trim();

  const rows: CsvFixtureRow[] = [];
  const errors: CsvFixtureError[] = [];

  for (let r = 1; r < records.length; r++) {
    const line = r + 1;
    const fields = records[r] ?? [];
    const homeTeam = cell(fields, "home_team");
    const awayTeam = cell(fields, "away_team");
    const rawKickoff = cell(fields, "kickoff");
    const ground = cell(fields, "ground");
    const rawDuration = cell(fields, "duration_minutes");

    const rowErrors: string[] = [];
    if (homeTeam === "") {
      rowErrors.push("home_team is required");
    }
    if (awayTeam === "") {
      rowErrors.push("away_team is required");
    }
    if (homeTeam !== "" && homeTeam.toLowerCase() === awayTeam.toLowerCase()) {
      rowErrors.push("a team cannot play itself");
    }
    let kickoffAt: string | null = null;
    if (rawKickoff !== "") {
      kickoffAt = normalizeKickoff(rawKickoff);
      if (kickoffAt === null) {
        rowErrors.push(`invalid kickoff "${rawKickoff}" (use YYYY-MM-DD HH:MM)`);
      }
    }
    let durationMinutes = DEFAULT_FIXTURE_DURATION_MINUTES;
    if (rawDuration !== "") {
      const parsed = Number(rawDuration);
      if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 1440) {
        rowErrors.push(`invalid duration_minutes "${rawDuration}" (1–1440)`);
      } else {
        durationMinutes = parsed;
      }
    }

    if (rowErrors.length > 0) {
      errors.push({ line, message: rowErrors.join("; ") });
      continue;
    }
    rows.push({
      line,
      homeTeam,
      awayTeam,
      kickoffAt,
      ground: ground === "" ? null : ground,
      durationMinutes,
    });
  }

  return { rows, errors };
}
