import {
  competitionCode,
  fixtureNumber,
  type CsvFixtureRow,
  type FixtureForConflicts,
} from "@desiauction/core";
import { auditLog, fixtures, grounds, newId, teams, type Db } from "@desiauction/db";
import { eq, sql } from "drizzle-orm";

import type { CompetitionSummary } from "./competitions";
import { blockingFor, type ConflictFixture } from "./fixture-aggregate";

// Fixture CSV import commit (M-IP3-3). Shape validation happened in core
// (parseFixtureCsv) BEFORE this runs; here team and ground names resolve against
// the database, and ANY unresolved name refuses the WHOLE file — the same
// no-partial-corruption contract as the registration import. The commit is one
// transaction: a mid-file failure rolls everything back. Imported fixtures land
// as DRAFTS with stable numbers; scheduling remains an explicit, audited step.
//
// IMPORT IS NOT A SIDE DOOR. Generate, create, edit and reschedule all gate on
// `blockingFor`; import did not, so a team double-booking the Move path refused
// walked straight in through a pasted CSV — and the preview called it "1 valid
// row(s) · 0 error(s)". The aggregate's contract ("the invariants are
// machine-enforced, not UI-suggested") has to hold at EVERY entry point, so the
// same engine now runs here, per line, before anything is written.

export type ImportFixturesResult =
  { ok: true; imported: number } | { ok: false; errors: { line: number; message: string }[] };

export interface ImportError {
  line: number;
  message: string;
}

interface ResolvedRow {
  row: CsvFixtureRow;
  homeTeamId: string | undefined;
  awayTeamId: string | undefined;
  groundId: string | null;
}

/** Name resolution against this competition's teams and this org's grounds. */
async function resolveRows(
  db: Db,
  competition: CompetitionSummary,
  rows: readonly CsvFixtureRow[],
): Promise<{ resolved: ResolvedRow[]; errors: ImportError[] }> {
  const [teamRows, groundRows] = await Promise.all([
    db
      .select({ id: teams.id, name: teams.name })
      .from(teams)
      .where(eq(teams.competitionId, competition.id)),
    db
      .select({ id: grounds.id, name: grounds.name })
      .from(grounds)
      .where(eq(grounds.orgId, competition.orgId)),
  ]);
  const teamByName = new Map(teamRows.map((t) => [t.name.toLowerCase(), t.id]));
  const groundByName = new Map(groundRows.map((g) => [g.name.toLowerCase(), g.id]));
  const errors: ImportError[] = [];
  const resolved = rows.map((row) => {
    const homeTeamId = teamByName.get(row.homeTeam.toLowerCase());
    const awayTeamId = teamByName.get(row.awayTeam.toLowerCase());
    const groundId = row.ground === null ? null : groundByName.get(row.ground.toLowerCase());
    if (homeTeamId === undefined) {
      errors.push({ line: row.line, message: `unknown team "${row.homeTeam}"` });
    }
    if (awayTeamId === undefined) {
      errors.push({ line: row.line, message: `unknown team "${row.awayTeam}"` });
    }
    if (row.ground !== null && groundId === undefined) {
      errors.push({ line: row.line, message: `unknown ground "${row.ground}"` });
    }
    return { row, homeTeamId, awayTeamId, groundId: groundId ?? null };
  });
  return { resolved, errors };
}

const candidateId = (line: number): string => `import-line-${String(line)}`;

/**
 * Run the whole file through the conflict engine — against every fixture the org
 * already holds AND against the other rows of the same file — and report each
 * blocking clash on the line that caused it, in the parser's own voice.
 */
async function importConflictErrors(
  db: Db,
  competition: CompetitionSummary,
  resolved: readonly ResolvedRow[],
): Promise<ImportError[]> {
  const candidates: FixtureForConflicts[] = resolved.map((entry) => ({
    id: candidateId(entry.row.line),
    homeTeamId: entry.homeTeamId as string,
    awayTeamId: entry.awayTeamId as string,
    groundId: entry.groundId,
    kickoffAt: entry.row.kickoffAt,
    durationMinutes: entry.row.durationMinutes,
    status: "draft",
  }));
  const pending = new Map<string, ConflictFixture>(
    resolved.map((entry) => [
      candidateId(entry.row.line),
      {
        id: candidateId(entry.row.line),
        number: `line ${String(entry.row.line)}`,
        teams: `${entry.row.homeTeam} vs ${entry.row.awayTeam}`,
        kickoffAt: entry.row.kickoffAt,
      },
    ]),
  );
  const blockers = await blockingFor(db, competition, candidates, [], pending);
  const errors: ImportError[] = [];
  const seen = new Set<string>();
  for (const blocker of blockers) {
    for (const entry of blocker.fixtures) {
      const line = [...pending.entries()].find(([id]) => id === entry.id);
      if (line === undefined) {
        continue; // an existing fixture, named in the message below
      }
      const others = blocker.fixtures.filter((f) => f.id !== entry.id);
      const message =
        others.length === 0
          ? blocker.detail
          : `${blocker.detail} — clashes with ${others
              .map((f) => `${f.number} (${f.teams})`)
              .join(" and ")}`;
      const lineNumber = Number(entry.number.replace("line ", ""));
      const key = `${String(lineNumber)}:${message}`;
      if (!seen.has(key)) {
        seen.add(key);
        errors.push({ line: lineNumber, message });
      }
    }
  }
  return errors.sort((a, b) => a.line - b.line);
}

export async function commitFixtureImport(
  db: Db,
  competition: CompetitionSummary,
  actorId: string,
  rows: readonly CsvFixtureRow[],
): Promise<ImportFixturesResult> {
  if (rows.length === 0) {
    return { ok: true, imported: 0 };
  }
  const { resolved, errors } = await resolveRows(db, competition, rows);
  if (errors.length > 0) {
    return { ok: false, errors };
  }
  // The same gate every other write path passes. Re-run at commit, not just at
  // preview: the schedule can move between the two.
  const clashes = await importConflictErrors(db, competition, resolved);
  if (clashes.length > 0) {
    return { ok: false, errors: clashes };
  }

  const code = competitionCode(competition.name, competition.startsOn);
  return db.transaction(async (tx) => {
    const [seqRow] = await tx
      .select({ max: sql<number>`coalesce(max(${fixtures.seq}), 0)::int` })
      .from(fixtures)
      .where(eq(fixtures.competitionId, competition.id));
    let seq = (seqRow?.max ?? 0) + 1;
    for (const entry of resolved) {
      await tx.insert(fixtures).values({
        id: newId(),
        orgId: competition.orgId,
        competitionId: competition.id,
        fixtureNumber: fixtureNumber(code, seq),
        seq,
        homeTeamId: entry.homeTeamId as string,
        awayTeamId: entry.awayTeamId as string,
        groundId: entry.groundId,
        kickoffAt: entry.row.kickoffAt,
        durationMinutes: entry.row.durationMinutes,
        status: "draft",
        createdBy: actorId,
      });
      seq++;
    }
    await tx.insert(auditLog).values({
      id: newId(),
      actor: actorId,
      action: "fixture.imported",
      scopeType: "org",
      scopeId: competition.orgId,
      subject: competition.id,
      meta: { imported: String(resolved.length) },
    });
    return { ok: true, imported: resolved.length };
  });
}

/**
 * The import preview's dry run (no writes): unknown names first, then — once
 * every name resolves — the same conflict gate the commit will apply. The
 * preview and the commit must agree, or "1 valid row(s) · 0 error(s)" is a lie
 * the organizer only discovers by pressing Import.
 */
export async function importDryRun(
  db: Db,
  competition: CompetitionSummary,
  rows: readonly CsvFixtureRow[],
): Promise<ImportError[]> {
  if (rows.length === 0) {
    return [];
  }
  const { resolved, errors } = await resolveRows(db, competition, rows);
  if (errors.length > 0) {
    return errors;
  }
  return importConflictErrors(db, competition, resolved);
}
