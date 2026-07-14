import { competitionCode, fixtureNumber, type CsvFixtureRow } from "@desiauction/core";
import { auditLog, fixtures, grounds, newId, teams, type Db } from "@desiauction/db";
import { and, eq, sql } from "drizzle-orm";

import type { CompetitionSummary } from "./competitions";

// Fixture CSV import commit (M-IP3-3). Shape validation happened in core
// (parseFixtureCsv) BEFORE this runs; here team and ground names resolve against
// the database, and ANY unresolved name refuses the WHOLE file — the same
// no-partial-corruption contract as the registration import. The commit is one
// transaction: a mid-file failure rolls everything back. Imported fixtures land
// as DRAFTS with stable numbers; scheduling remains an explicit, audited step.

export type ImportFixturesResult =
  { ok: true; imported: number } | { ok: false; errors: { line: number; message: string }[] };

export async function commitFixtureImport(
  db: Db,
  competition: CompetitionSummary,
  actorId: string,
  rows: readonly CsvFixtureRow[],
): Promise<ImportFixturesResult> {
  if (rows.length === 0) {
    return { ok: true, imported: 0 };
  }
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

  const errors: { line: number; message: string }[] = [];
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
  if (errors.length > 0) {
    return { ok: false, errors };
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

/** Existence probe used by the import preview (no writes). */
export async function unknownImportNames(
  db: Db,
  competition: CompetitionSummary,
  rows: readonly CsvFixtureRow[],
): Promise<{ line: number; message: string }[]> {
  const [teamRows, groundRows] = await Promise.all([
    db
      .select({ name: teams.name })
      .from(teams)
      .where(and(eq(teams.competitionId, competition.id))),
    db.select({ name: grounds.name }).from(grounds).where(eq(grounds.orgId, competition.orgId)),
  ]);
  const teamNames = new Set(teamRows.map((t) => t.name.toLowerCase()));
  const groundNames = new Set(groundRows.map((g) => g.name.toLowerCase()));
  const errors: { line: number; message: string }[] = [];
  for (const row of rows) {
    if (!teamNames.has(row.homeTeam.toLowerCase())) {
      errors.push({ line: row.line, message: `unknown team "${row.homeTeam}"` });
    }
    if (!teamNames.has(row.awayTeam.toLowerCase())) {
      errors.push({ line: row.line, message: `unknown team "${row.awayTeam}"` });
    }
    if (row.ground !== null && !groundNames.has(row.ground.toLowerCase())) {
      errors.push({ line: row.line, message: `unknown ground "${row.ground}"` });
    }
  }
  return errors;
}
