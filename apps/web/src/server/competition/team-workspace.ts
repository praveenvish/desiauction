import { auctionOwnerInvites, auctions, people, registrations, type Db } from "@desiauction/db";
import { and, eq, isNotNull } from "drizzle-orm";

import { resolvedLots, rulesOf } from "../auction/live-summary";
import { registrationStats } from "./registrations";
import { teamsOf, type CompetitionSummary } from "./competitions";

/**
 * The Team Workspace (PX "Season Workspace" → Teams): the rich grid of franchise
 * cards and, for one team, the roster detail — squad, purse burndown and every
 * buy price. Derived entirely from read models that already exist: the team
 * list, the resolved auction lots (the source of truth for a buy price), the
 * approved-registration roster, and the accepted owner invites.
 *
 * A season with no auction yet is normal: buy prices come back null, purse spent
 * is zero, and the cards read as "nothing bought yet" rather than erroring.
 */

export interface TeamRosterRow {
  registrationId: string;
  name: string | null;
  phone: string;
  role: string;
  /** Paise paid at auction; null for a pre-signed/icon slot with no hammer price. */
  buyPrice: number | null;
  isIcon: boolean;
  isCaptain: boolean;
}

export interface TeamCard {
  id: string;
  name: string;
  shortName: string | null;
  color: string | null;
  logoUrl: string | null;
  ownerName: string | null;
  squadFilled: number;
  squadMax: number | null;
  /** Paise spent across the roster. */
  spent: number;
  /** Paise the team started with (purse per team). */
  purseTotal: number;
  /** 0–100, or null when no purse is configured. */
  usedPct: number | null;
  topBuyName: string | null;
  /** Sorted by buy price, dearest first; pre-signed (null price) last. */
  roster: TeamRosterRow[];
}

export interface TeamsWorkspace {
  competitionName: string;
  teams: TeamCard[];
  /** Purse per team (paise); 0 when no auction is configured. */
  purseTotal: number;
  squadMax: number | null;
  approvedPlayers: number;
}

export async function teamsWorkspace(
  db: Db,
  competition: CompetitionSummary,
): Promise<TeamsWorkspace> {
  const [teams, stats, auctionRows, rosterRows] = await Promise.all([
    teamsOf(db, competition.id),
    registrationStats(db, competition.id),
    db
      .select({ id: auctions.id, config: auctions.config })
      .from(auctions)
      .where(eq(auctions.competitionId, competition.id))
      .limit(1),
    // Everyone approved and placed on a squad, with the human name and phone the
    // organizer's roster needs (this is the manage view, not the spectator one).
    db
      .select({
        registrationId: registrations.id,
        teamId: registrations.teamId,
        role: registrations.role,
        isIcon: registrations.isIcon,
        isCaptain: registrations.isCaptain,
        name: people.name,
        phone: people.phone,
      })
      .from(registrations)
      .innerJoin(people, eq(people.id, registrations.personId))
      .where(
        and(
          eq(registrations.competitionId, competition.id),
          eq(registrations.status, "approved"),
          isNotNull(registrations.teamId),
        ),
      ),
  ]);

  const auction = auctionRows[0];
  const rules = auction !== undefined ? rulesOf(auction.config) : null;
  const purseTotal = rules?.pursePerTeam ?? 0;
  const squadMax = rules?.squadMax ?? null;

  // registrationId → buy price, from the resolved lots (the only place a hammer
  // price lives). Pre-signed players never appear here and stay priceless.
  const priceByReg = new Map<string, number>();
  const ownerByTeam = new Map<string, string>();
  if (auction !== undefined) {
    const [lots, owners] = await Promise.all([
      resolvedLots(db, auction.id),
      db
        .select({ teamId: auctionOwnerInvites.teamId, name: people.name })
        .from(auctionOwnerInvites)
        .innerJoin(people, eq(people.id, auctionOwnerInvites.acceptedBy))
        .where(
          and(
            eq(auctionOwnerInvites.auctionId, auction.id),
            isNotNull(auctionOwnerInvites.acceptedBy),
          ),
        ),
    ]);
    for (const lot of lots) {
      if (lot.status === "sold" && lot.registrationId !== null && lot.soldPrice !== null) {
        priceByReg.set(lot.registrationId, lot.soldPrice);
      }
    }
    for (const owner of owners) {
      if (owner.name !== null) {
        ownerByTeam.set(owner.teamId, owner.name);
      }
    }
  }

  const rosterByTeam = new Map<string, TeamRosterRow[]>();
  for (const row of rosterRows) {
    if (row.teamId === null) {
      continue;
    }
    const list = rosterByTeam.get(row.teamId) ?? [];
    list.push({
      registrationId: row.registrationId,
      name: row.name,
      phone: row.phone,
      role: row.role,
      buyPrice: priceByReg.get(row.registrationId) ?? null,
      isIcon: row.isIcon,
      isCaptain: row.isCaptain,
    });
    rosterByTeam.set(row.teamId, list);
  }

  const cards: TeamCard[] = teams.map((team) => {
    const roster = (rosterByTeam.get(team.id) ?? []).sort(
      (a, b) => (b.buyPrice ?? -1) - (a.buyPrice ?? -1),
    );
    const spent = roster.reduce((sum, row) => sum + (row.buyPrice ?? 0), 0);
    const topBuy = roster.find((row) => row.buyPrice !== null) ?? null;
    return {
      id: team.id,
      name: team.name,
      shortName: team.shortName,
      color: team.primaryColor,
      logoUrl: team.logoUrl,
      ownerName: ownerByTeam.get(team.id) ?? null,
      squadFilled: roster.length,
      squadMax,
      spent,
      purseTotal,
      usedPct: purseTotal > 0 ? Math.round((spent / purseTotal) * 100) : null,
      topBuyName: topBuy?.name ?? null,
      roster,
    };
  });

  // Dearest squads first — the same "purse used" order the design sorts by.
  cards.sort((a, b) => b.spent - a.spent);

  return {
    competitionName: competition.name,
    teams: cards,
    purseTotal,
    squadMax,
    approvedPlayers: stats.approved,
  };
}
