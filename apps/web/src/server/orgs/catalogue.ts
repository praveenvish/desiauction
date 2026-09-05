"use server";

import {
  competitions,
  fixtures,
  registrations,
  teams,
  tournaments,
  withTenantDb,
} from "@desiauction/db";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";

import { currentSession } from "../auth/actions";
import { dbHandle } from "../db";
import { resolveTenant, type OrgSummary } from "./orgs";

/**
 * The organizer's catalogue: an org, the tournaments it runs, and the editions
 * under each.
 *
 * The shape mirrors how organizers talk about their own calendar — "BPL" is the
 * tournament, "BPL 1", "BPL 2" are its editions, and an edition is the thing
 * that actually runs (it owns the status, the auction, the teams and the
 * money). Until this existed, the org page listed members and money and never
 * once mentioned a competition, so nothing connected an organization to the
 * tournaments it exists to run.
 *
 * READ ONLY, and inside the tenant boundary: every row is reached through
 * resolveTenant, which proves membership before the org id is ever set.
 */

export interface EditionRow {
  id: string;
  slug: string;
  name: string;
  status: string;
  /** The season's sport (SP-1 Phase 1) — the key its pack resolves from. */
  sport: string;
  visibility: "private" | "public";
  /** PI-1: the organizer-declared entry category. */
  entryCategory: "open" | "men" | "women" | "mixed";
  startsOn: string | null;
  endsOn: string | null;
  location: string | null;
  teams: number;
  players: number;
  /** Fixtures scheduled for this edition. */
  matches: number;
  /** Registrations still awaiting an organizer decision — the subset of
      `players` that is a to-do rather than a total. */
  pending: number;
}

export interface TournamentGroup {
  id: string;
  name: string;
  slug: string;
  editions: EditionRow[];
}

export interface OrgCatalogue {
  org: OrgSummary;
  tournaments: TournamentGroup[];
  /** Competitions run as one-offs, belonging to no recurring tournament. */
  standalone: EditionRow[];
}

/** Counts folded once for every competition in the org, then handed out. */
async function editionsFor(
  db: Parameters<Parameters<typeof withTenantDb>[2]>[0],
  orgId: string,
): Promise<Map<string, EditionRow[]>> {
  const rows = await db
    .select({
      id: competitions.id,
      slug: competitions.slug,
      name: competitions.name,
      sport: competitions.sport,
      status: competitions.status,
      visibility: competitions.visibility,
      entryCategory: competitions.entryCategory,
      startsOn: competitions.startsOn,
      endsOn: competitions.endsOn,
      location: competitions.location,
      tournamentId: competitions.tournamentId,
    })
    .from(competitions)
    .where(eq(competitions.orgId, orgId))
    .orderBy(desc(competitions.createdAt));

  const ids = rows.map((row) => row.id);
  const [teamRows, playerRows, matchRows, pendingRows] = await Promise.all([
    ids.length > 0
      ? db
          .select({ competitionId: teams.competitionId, count: sql<number>`count(*)::int` })
          .from(teams)
          .where(inArray(teams.competitionId, ids))
          .groupBy(teams.competitionId)
      : Promise.resolve([]),
    ids.length > 0
      ? db
          .select({ competitionId: registrations.competitionId, count: sql<number>`count(*)::int` })
          .from(registrations)
          .where(inArray(registrations.competitionId, ids))
          .groupBy(registrations.competitionId)
      : Promise.resolve([]),
    ids.length > 0
      ? db
          .select({ competitionId: fixtures.competitionId, count: sql<number>`count(*)::int` })
          .from(fixtures)
          .where(inArray(fixtures.competitionId, ids))
          .groupBy(fixtures.competitionId)
      : Promise.resolve([]),
    ids.length > 0
      ? db
          .select({ competitionId: registrations.competitionId, count: sql<number>`count(*)::int` })
          .from(registrations)
          .where(
            and(
              inArray(registrations.competitionId, ids),
              // "Submitted" is the only status waiting on a human.
              eq(registrations.status, "submitted"),
            ),
          )
          .groupBy(registrations.competitionId)
      : Promise.resolve([]),
  ]);
  const teamsBy = new Map(teamRows.map((row) => [row.competitionId, row.count]));
  const playersBy = new Map(playerRows.map((row) => [row.competitionId, row.count]));
  const matchesBy = new Map(matchRows.map((row) => [row.competitionId, row.count]));
  const pendingBy = new Map(pendingRows.map((row) => [row.competitionId, row.count]));

  // Keyed by tournament id; "" collects the one-offs.
  const grouped = new Map<string, EditionRow[]>();
  for (const row of rows) {
    const key = row.tournamentId ?? "";
    const list = grouped.get(key) ?? [];
    list.push({
      id: row.id,
      slug: row.slug,
      name: row.name,
      sport: row.sport,
      status: row.status,
      visibility: row.visibility,
      entryCategory: row.entryCategory,
      startsOn: row.startsOn,
      endsOn: row.endsOn,
      location: row.location,
      teams: teamsBy.get(row.id) ?? 0,
      players: playersBy.get(row.id) ?? 0,
      matches: matchesBy.get(row.id) ?? 0,
      pending: pendingBy.get(row.id) ?? 0,
    });
    grouped.set(key, list);
  }
  return grouped;
}

export async function orgCatalogue(slug: string): Promise<OrgCatalogue | null> {
  const session = await currentSession();
  if (session === null) {
    return null;
  }
  // Resolution runs under person context — membership is proved on the
  // org_members arm before the org id is ever set (PRP-1 §1).
  const org = await withTenantDb(dbHandle, { personId: session.personId }, (db) =>
    resolveTenant(db, session.personId, slug),
  );
  if (org === null) {
    return null;
  }
  return withTenantDb(dbHandle, { personId: session.personId, orgId: org.id }, async (db) => {
    const [tournamentRows, grouped] = await Promise.all([
      db
        .select({ id: tournaments.id, name: tournaments.name, slug: tournaments.slug })
        .from(tournaments)
        .where(eq(tournaments.orgId, org.id))
        .orderBy(asc(tournaments.name)),
      editionsFor(db, org.id),
    ]);
    return {
      org,
      tournaments: tournamentRows.map((row) => ({
        id: row.id,
        name: row.name,
        slug: row.slug,
        editions: grouped.get(row.id) ?? [],
      })),
      standalone: grouped.get("") ?? [],
    };
  });
}

export interface TournamentView {
  org: OrgSummary;
  tournament: { id: string; name: string; slug: string };
  editions: EditionRow[];
}

/** One tournament and every edition run under it, newest first. */
export async function tournamentView(
  orgSlug: string,
  tournamentSlug: string,
): Promise<TournamentView | null> {
  const catalogue = await orgCatalogue(orgSlug);
  if (catalogue === null) {
    return null;
  }
  const group = catalogue.tournaments.find((entry) => entry.slug === tournamentSlug);
  if (group === undefined) {
    return null;
  }
  return {
    org: catalogue.org,
    tournament: { id: group.id, name: group.name, slug: group.slug },
    editions: group.editions,
  };
}
