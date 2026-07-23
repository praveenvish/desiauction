import { auctions, lots, people, registrations, teams } from "@desiauction/db";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";

import { competitionsView } from "../competition/actions";
import { systemDb } from "../db";

/**
 * Cross-competition workspace indexes — the global Auctions / Teams / Players /
 * Registrations lists behind the sidebar's Workspace group.
 *
 * READ ONLY and scoped exactly like `homeDashboard`: every query is filtered by
 * the competition ids `competitionsView()` already proved membership for. These
 * are views over the person's own competitions, never the platform.
 */

export interface WorkspaceCompetition {
  id: string;
  slug: string;
  name: string;
  status: string;
}

async function scope(): Promise<WorkspaceCompetition[]> {
  const view = await competitionsView();
  return view.competitions.map((competition) => ({
    id: competition.id,
    slug: competition.slug,
    name: competition.name,
    status: competition.status,
  }));
}

export interface AuctionListRow {
  id: string;
  competitionSlug: string;
  competitionName: string;
  name: string;
  status: string;
  lotsTotal: number;
  lotsSold: number;
  spendPaise: number;
}

export async function auctionIndex(): Promise<AuctionListRow[]> {
  const competitions = await scope();
  if (competitions.length === 0) return [];
  const byId = new Map(competitions.map((competition) => [competition.id, competition]));
  const rows = await systemDb
    .select({
      id: auctions.id,
      competitionId: auctions.competitionId,
      name: auctions.name,
      status: auctions.status,
      createdAt: auctions.createdAt,
    })
    .from(auctions)
    .where(
      inArray(
        auctions.competitionId,
        competitions.map((competition) => competition.id),
      ),
    )
    .orderBy(desc(auctions.createdAt));
  if (rows.length === 0) return [];
  const progress = await systemDb
    .select({
      auctionId: lots.auctionId,
      total: sql<number>`count(*)::int`,
      sold: sql<number>`count(*) filter (where ${lots.status} = 'sold')::int`,
      spend: sql<number>`coalesce(sum(${lots.soldPrice}) filter (where ${lots.status} = 'sold'), 0)::double precision`,
    })
    .from(lots)
    .where(
      inArray(
        lots.auctionId,
        rows.map((row) => row.id),
      ),
    )
    .groupBy(lots.auctionId);
  const progressBy = new Map(progress.map((row) => [row.auctionId, row]));
  return rows.map((row) => {
    const competition = byId.get(row.competitionId);
    const p = progressBy.get(row.id);
    return {
      id: row.id,
      competitionSlug: competition?.slug ?? "",
      competitionName: competition?.name ?? "Competition",
      name: row.name,
      status: row.status,
      lotsTotal: p?.total ?? 0,
      lotsSold: p?.sold ?? 0,
      spendPaise: p?.spend ?? 0,
    };
  });
}

export interface TeamListRow {
  id: string;
  name: string;
  shortName: string | null;
  coachName: string | null;
  competitionSlug: string;
  competitionName: string;
  players: number;
}

export async function teamIndex(): Promise<TeamListRow[]> {
  const competitions = await scope();
  if (competitions.length === 0) return [];
  const byId = new Map(competitions.map((competition) => [competition.id, competition]));
  const ids = competitions.map((competition) => competition.id);
  const [rows, squads] = await Promise.all([
    systemDb
      .select({
        id: teams.id,
        name: teams.name,
        shortName: teams.shortName,
        coachName: teams.coachName,
        competitionId: teams.competitionId,
      })
      .from(teams)
      .where(inArray(teams.competitionId, ids))
      .orderBy(asc(teams.name)),
    systemDb
      .select({ teamId: registrations.teamId, count: sql<number>`count(*)::int` })
      .from(registrations)
      .where(inArray(registrations.competitionId, ids))
      .groupBy(registrations.teamId),
  ]);
  const squadBy = new Map(squads.map((row) => [row.teamId, row.count]));
  return rows.map((row) => {
    const competition = byId.get(row.competitionId);
    return {
      id: row.id,
      name: row.name,
      shortName: row.shortName,
      coachName: row.coachName,
      competitionSlug: competition?.slug ?? "",
      competitionName: competition?.name ?? "Competition",
      players: squadBy.get(row.id) ?? 0,
    };
  });
}

export interface PlayerListRow {
  id: string;
  name: string;
  role: string;
  status: string;
  number: string | null;
  isIcon: boolean;
  isCaptain: boolean;
  competitionSlug: string;
  competitionName: string;
}

/** `onlyPending` powers the Registrations queue; otherwise it is the player pool. */
export async function playerIndex(onlyPending = false): Promise<PlayerListRow[]> {
  const competitions = await scope();
  if (competitions.length === 0) return [];
  const byId = new Map(competitions.map((competition) => [competition.id, competition]));
  const ids = competitions.map((competition) => competition.id);
  const rows = await systemDb
    .select({
      id: registrations.id,
      name: people.name,
      role: registrations.role,
      status: registrations.status,
      number: registrations.registrationNumber,
      isIcon: registrations.isIcon,
      isCaptain: registrations.isCaptain,
      competitionId: registrations.competitionId,
      createdAt: registrations.createdAt,
    })
    .from(registrations)
    .innerJoin(people, eq(people.id, registrations.personId))
    .where(
      onlyPending
        ? and(inArray(registrations.competitionId, ids), eq(registrations.status, "submitted"))
        : and(inArray(registrations.competitionId, ids), eq(registrations.status, "approved")),
    )
    .orderBy(desc(registrations.createdAt))
    .limit(200);
  return rows.map((row) => {
    const competition = byId.get(row.competitionId);
    return {
      id: row.id,
      name: row.name ?? "Unnamed player",
      role: row.role,
      status: row.status,
      number: row.number,
      isIcon: row.isIcon,
      isCaptain: row.isCaptain,
      competitionSlug: competition?.slug ?? "",
      competitionName: competition?.name ?? "Competition",
    };
  });
}
