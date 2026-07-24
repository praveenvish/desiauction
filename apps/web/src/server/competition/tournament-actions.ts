"use server";

import { fixtures, registrations, teams, tournaments, withTenantDb } from "@desiauction/db";
import { and, eq, inArray, sql } from "drizzle-orm";
import { redirect } from "next/navigation";

import { currentSession } from "../auth/actions";
import { dbHandle, systemDb } from "../db";
import { ForbiddenError } from "../orgs/authz";
import { orgsFor } from "../orgs/orgs";
import { requireCompetitionCapability } from "./authz";
import { competitionsForPerson, createTournament, type CompetitionSummary } from "./competitions";

/**
 * The tournament surface.
 *
 * `createTournament` has existed in the persistence layer since IP-3 — audit
 * logged, regression tested — with NO caller anywhere in the app. The
 * `competitions.tournament_id` column, its index, the org catalogue's grouping
 * and the `/org/{slug}/t/{tournament}` route were all built against a hierarchy
 * the product gave no way to populate: every season created through the UI was
 * a one-off. This module is the missing surface.
 *
 * A tournament is deliberately allowed to hold NO seasons. It is the recurring
 * competition ("BPL"); its seasons are the editions that actually run ("BPL 1",
 * "BPL 2"), and a brand exists before its first edition does.
 */

async function requireSession() {
  const session = await currentSession();
  if (session === null) {
    redirect("/login?next=/tournaments");
  }
  return session;
}

/** FormData values are string | File; the same narrowing actions.ts uses. */
function formString(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

/**
 * The three figures an organizer scans a season by: how big is it, how much of
 * it is scheduled, and how much of it is waiting on me.
 */
export interface SeasonCounts {
  teams: number;
  matches: number;
  /** Registrations awaiting an organizer decision — the only actionable one. */
  pending: number;
}

const NO_COUNTS: SeasonCounts = { teams: 0, matches: 0, pending: 0 };

export type SeasonRow = CompetitionSummary & { orgName: string; counts: SeasonCounts };

export interface TournamentRow {
  id: string;
  name: string;
  slug: string;
  orgId: string;
  orgName: string;
  /** Epoch ms, not a Date: the browser sorts by it, and a number cannot drift
      across the server boundary or between render passes. */
  createdAt: number;
  seasons: SeasonRow[];
}

export interface TournamentsView {
  orgs: { id: string; name: string }[];
  tournaments: TournamentRow[];
  /** Seasons belonging to no tournament — first-class, never orphaned. */
  standalone: SeasonRow[];
  /** Roll-up across everything above, for the summary band. */
  totals: { tournaments: number; seasons: number; teams: number; pending: number };
}

/**
 * Teams, fixtures and pending registrations per competition, in three grouped
 * counts rather than a per-season query each (the catalogue's pattern).
 *
 * The empty-id guard is not defensive noise: `inArray` with no values compiles
 * to `in ()`, which Postgres rejects outright.
 */
async function countsFor(competitionIds: string[]): Promise<Map<string, SeasonCounts>> {
  const counts = new Map<string, SeasonCounts>();
  if (competitionIds.length === 0) {
    return counts;
  }
  const tally = sql<number>`count(*)::int`;
  const [teamRows, fixtureRows, pendingRows] = await Promise.all([
    systemDb
      .select({ competitionId: teams.competitionId, count: tally })
      .from(teams)
      .where(inArray(teams.competitionId, competitionIds))
      .groupBy(teams.competitionId),
    systemDb
      .select({ competitionId: fixtures.competitionId, count: tally })
      .from(fixtures)
      .where(inArray(fixtures.competitionId, competitionIds))
      .groupBy(fixtures.competitionId),
    systemDb
      .select({ competitionId: registrations.competitionId, count: tally })
      .from(registrations)
      .where(
        and(
          inArray(registrations.competitionId, competitionIds),
          // "Submitted" is the only status that is waiting on a human.
          eq(registrations.status, "submitted"),
        ),
      )
      .groupBy(registrations.competitionId),
  ]);
  const read = (id: string): SeasonCounts => {
    const existing = counts.get(id);
    if (existing !== undefined) {
      return existing;
    }
    const fresh = { ...NO_COUNTS };
    counts.set(id, fresh);
    return fresh;
  };
  for (const row of teamRows) {
    read(row.competitionId).teams = row.count;
  }
  for (const row of fixtureRows) {
    read(row.competitionId).matches = row.count;
  }
  for (const row of pendingRows) {
    read(row.competitionId).pending = row.count;
  }
  return counts;
}

/**
 * Every tournament across the orgs this person belongs to, each with its
 * seasons folded in, plus the one-off seasons that belong to none.
 */
export async function tournamentsView(): Promise<TournamentsView> {
  const session = await requireSession();
  const [orgs, seasons] = await Promise.all([
    withTenantDb(dbHandle, { personId: session.personId }, (db) => orgsFor(db, session.personId)),
    // Cross-org union scoped by the membership join — the same system-pool
    // pattern competitionsView uses.
    competitionsForPerson(systemDb, session.personId),
  ]);
  const orgIds = orgs.map((org) => org.id);
  const orgNames = new Map(orgs.map((org) => [org.id, org.name]));
  const rows =
    orgIds.length === 0
      ? []
      : await systemDb
          .select({
            id: tournaments.id,
            name: tournaments.name,
            slug: tournaments.slug,
            orgId: tournaments.orgId,
            createdAt: tournaments.createdAt,
          })
          .from(tournaments)
          .where(inArray(tournaments.orgId, orgIds))
          .orderBy(tournaments.name);
  const counts = await countsFor(seasons.map((season) => season.id));
  const enriched: SeasonRow[] = seasons.map((season) => ({
    ...season,
    counts: counts.get(season.id) ?? NO_COUNTS,
  }));
  const standalone = enriched.filter((season) => season.tournamentId === null);
  return {
    orgs: orgs.map((org) => ({ id: org.id, name: org.name })),
    tournaments: rows.map((row) => ({
      ...row,
      createdAt: row.createdAt.getTime(),
      orgName: orgNames.get(row.orgId) ?? "",
      seasons: enriched.filter((season) => season.tournamentId === row.id),
    })),
    standalone,
    totals: {
      tournaments: rows.length,
      seasons: enriched.length,
      // Summed over every season the person can see, one-offs included — the
      // band describes the page, and the page shows both groups.
      teams: enriched.reduce((sum, season) => sum + season.counts.teams, 0),
      pending: enriched.reduce((sum, season) => sum + season.counts.pending, 0),
    },
  };
}

export interface TournamentDetail {
  tournament: { id: string; name: string; slug: string; orgId: string; orgName: string };
  seasons: (CompetitionSummary & { orgName: string })[];
  viewer: { canCreateSeason: boolean };
}

/** Membership-gated: a non-member gets null, which the page turns into a 404. */
export async function tournamentDetail(slug: string): Promise<TournamentDetail | null> {
  const session = await requireSession();
  const [orgs, seasons] = await Promise.all([
    withTenantDb(dbHandle, { personId: session.personId }, (db) => orgsFor(db, session.personId)),
    competitionsForPerson(systemDb, session.personId),
  ]);
  const [row] = await systemDb
    .select({
      id: tournaments.id,
      name: tournaments.name,
      slug: tournaments.slug,
      orgId: tournaments.orgId,
    })
    .from(tournaments)
    .where(eq(tournaments.slug, slug))
    .limit(1);
  const org = orgs.find((candidate) => candidate.id === row?.orgId);
  if (row === undefined || org === undefined) {
    return null;
  }
  return {
    tournament: { ...row, orgName: org.name },
    seasons: seasons.filter((season) => season.tournamentId === row.id),
    viewer: { canCreateSeason: true },
  };
}

export async function createTournamentAction(
  _previous: { error?: string },
  formData: FormData,
): Promise<{ error?: string }> {
  const session = await requireSession();
  const orgId = formString(formData, "orgId");
  const name = formString(formData, "name");
  // Membership + capability: only an owner/staff of THIS org may create in it.
  const memberships = await withTenantDb(dbHandle, { personId: session.personId }, (db) =>
    orgsFor(db, session.personId),
  );
  if (!memberships.some((org) => org.id === orgId)) {
    return { error: "Choose one of your organizations." };
  }
  let slug: string;
  try {
    const tournament = await withTenantDb(
      dbHandle,
      { personId: session.personId, orgId },
      async (db) => {
        // A tournament is a competition container: it rides the same capability
        // as creating the seasons inside it rather than inventing a new one.
        await requireCompetitionCapability(db, session.personId, { orgId }, "competition.create");
        return createTournament(db, orgId, session.personId, name);
      },
    );
    slug = tournament.slug;
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return { error: "You can't create tournaments in this organization." };
    }
    return { error: "Give the tournament a name of at least 3 characters." };
  }
  redirect(`/tournaments/${slug}`);
}
