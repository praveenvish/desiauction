import { auctions, organizations, registrations, type Db } from "@desiauction/db";
import { and, eq, sql } from "drizzle-orm";

import { preSignedPlayers, resolvedLots, rulesOf } from "../auction/live-summary";
import { teamsOf, type CompetitionSummary } from "./competitions";
import { registrationStats } from "./registrations";

/**
 * The Season Workspace overview (PX design "Season Workspace"): one read that
 * answers the four tiles and the two summary cards.
 *
 * Everything here is DERIVED from read models that already exist — the
 * registration stats, the team list, and the resolved auction lots — so the
 * overview adds no new source of truth and cannot drift from the desks that own
 * these numbers. A season with no auction yet is the normal case, not an error:
 * the auction-derived figures come back zeroed and the cards render empty.
 *
 * Counting note: `registrationsOf` is capped at one page (100 rows), so the pool
 * figures are counted in SQL instead — a 142-player season must not report 100.
 */

export interface SeasonTeamSpend {
  teamId: string;
  name: string;
  /** The team's own colour, for the dot and the spend bar. */
  color: string | null;
  /** Paise committed to signed players. */
  spend: number;
  /** Squad filled / squad max, e.g. 12 of 15. */
  squad: number;
  squadMax: number | null;
}

export interface SeasonRoleCount {
  role: string;
  count: number;
}

export interface SeasonOverview {
  competition: CompetitionSummary;
  orgName: string;
  orgSlug: string;
  approvedPlayers: number;
  teamCount: number;
  /** Paise committed across every team; 0 before the auction runs. */
  purseCommitted: number;
  /** 0–100, or null when no auction (and so no purse) is configured. */
  pursePct: number | null;
  lotsSold: number;
  lotsTotal: number;
  auctionLive: boolean;
  topTeams: SeasonTeamSpend[];
  poolByRole: SeasonRoleCount[];
}

export async function seasonOverview(
  db: Db,
  competition: CompetitionSummary,
): Promise<SeasonOverview> {
  const [org, teams, stats, roleRows, auctionRows] = await Promise.all([
    db
      .select({ name: organizations.name, slug: organizations.slug })
      .from(organizations)
      .where(eq(organizations.id, competition.orgId))
      .limit(1),
    teamsOf(db, competition.id),
    registrationStats(db, competition.id),
    db
      .select({ role: registrations.role, count: sql<number>`count(*)::int` })
      .from(registrations)
      .where(
        and(eq(registrations.competitionId, competition.id), eq(registrations.status, "approved")),
      )
      .groupBy(registrations.role),
    db
      .select({ id: auctions.id, status: auctions.status, config: auctions.config })
      .from(auctions)
      .where(eq(auctions.competitionId, competition.id))
      .limit(1),
  ]);

  const base = {
    competition,
    orgName: org[0]?.name ?? "",
    orgSlug: org[0]?.slug ?? "",
    approvedPlayers: stats.approved,
    teamCount: teams.length,
    poolByRole: roleRows
      .map((row) => ({ role: row.role, count: row.count }))
      .sort((a, b) => b.count - a.count),
  };

  const auction = auctionRows[0];
  if (auction === undefined) {
    // No auction yet — the tiles that describe one stay honestly empty.
    return {
      ...base,
      purseCommitted: 0,
      pursePct: null,
      lotsSold: 0,
      lotsTotal: 0,
      auctionLive: false,
      topTeams: teams.map((team) => ({
        teamId: team.id,
        name: team.name,
        color: team.primaryColor,
        spend: 0,
        squad: 0,
        squadMax: null,
      })),
    };
  }

  const rules = rulesOf(auction.config);
  const [lots, preSigned] = await Promise.all([
    resolvedLots(db, auction.id),
    preSignedPlayers(db, competition.id),
  ]);

  // Fold the sold lots into per-team spend and squad counts. Icons and retained
  // players never went to the block but DO occupy a squad slot, so they are
  // counted here too — otherwise a full squad reads as short.
  const spendByTeam = new Map<string, { spend: number; squad: number }>();
  for (const team of teams) {
    spendByTeam.set(team.id, { spend: 0, squad: 0 });
  }
  for (const lot of lots) {
    if (lot.status !== "sold" || lot.teamId === null) {
      continue;
    }
    const entry = spendByTeam.get(lot.teamId);
    if (entry !== undefined) {
      entry.spend += lot.soldPrice ?? 0;
      entry.squad += 1;
    }
  }
  for (const player of preSigned) {
    const entry = spendByTeam.get(player.teamId);
    if (entry !== undefined) {
      entry.squad += 1;
    }
  }

  const purseCommitted = [...spendByTeam.values()].reduce((sum, entry) => sum + entry.spend, 0);
  const purseTotal = rules.pursePerTeam * teams.length;

  return {
    ...base,
    purseCommitted,
    pursePct: purseTotal > 0 ? Math.round((purseCommitted / purseTotal) * 100) : null,
    lotsSold: lots.filter((lot) => lot.status === "sold").length,
    lotsTotal: lots.length,
    auctionLive: auction.status === "live",
    topTeams: teams
      .map((team) => {
        const entry = spendByTeam.get(team.id);
        return {
          teamId: team.id,
          name: team.name,
          color: team.primaryColor,
          spend: entry?.spend ?? 0,
          squad: entry?.squad ?? 0,
          squadMax: rules.squadMax,
        };
      })
      .sort((a, b) => b.spend - a.spend),
  };
}
