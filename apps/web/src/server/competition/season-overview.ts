import {
  auctions,
  competitions,
  fixtures,
  organizations,
  registrations,
  settlementCases,
  settlementObligations,
  type Db,
} from "@desiauction/db";
import { and, eq, ne, sql } from "drizzle-orm";

import { preSignedPlayers, resolvedLots, rulesOf } from "../auction/live-summary";
import { storage } from "../media";
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
  /**
   * Paise committed to signed players. ABSENT — not null, not hidden in CSS —
   * for a viewer without money sight (DA-13); the key never reaches the wire.
   */
  spend?: number;
  /** Squad filled. */
  squad: number;
  /** Squad max; money-adjacent auction configuration, gated with the spend. */
  squadMax?: number | null;
}

export interface SeasonRoleCount {
  role: string | null;
  count: number;
}

/**
 * The season's settlement, reduced to the two facts the lifecycle needs — and,
 * for a viewer allowed to see money, the two figures that actually matter once
 * a season is over. Folded from the obligation projection rows (the same rows
 * the money desk folds), never from a stored balance.
 */
export interface SeasonSettlement {
  /** The case's own status: opened | verified | discrepant | settling | settled | closed. */
  status: string;
  /** Every rupee owed has been collected, waived or reduced away. */
  discharged: boolean;
  /** Money — absent without money sight. */
  totalDues?: number;
  collected?: number;
  outstanding?: number;
}

export interface SeasonOverview {
  competition: CompetitionSummary;
  orgName: string;
  orgSlug: string;
  /**
   * The season's own crest, resolved from its storage key to a readable URL —
   * null when the organizer has never set one. It lives here rather than on
   * `CompetitionSummary` because that type is assembled by a dozen callers and
   * none of the others render a logo; the overview is the one surface that
   * both shows the mark and offers to change it.
   */
  logoUrl: string | null;
  approvedPlayers: number;
  /**
   * Applications waiting on a human. The overview used to report only the
   * approved count while offering to CLOSE registration, so a season could be
   * shut with its inbox full and nothing on the page said so. `registrationStats`
   * already returned this — the overview simply threw it away.
   */
  pendingPlayers: number;
  teamCount: number;
  /** Fixtures scheduled for this season — the fifth lifecycle rung, derived. */
  fixtureCount: number;
  /** Paise committed across every team; 0 before the auction runs. Money-gated. */
  purseCommitted?: number;
  /** 0–100, or null when no auction (and so no purse) is configured. Money-gated. */
  pursePct?: number | null;
  lotsSold: number;
  lotsTotal: number;
  auctionLive: boolean;
  /** The auction's own lifecycle — the season's CTA depends on it (DA-10). */
  auctionStatus: string | null;
  /** The settlement case, or null before one is opened — the sixth rung. */
  settlement: SeasonSettlement | null;
  topTeams: SeasonTeamSpend[];
  poolByRole: SeasonRoleCount[];
}

export interface SeasonOverviewOptions {
  /**
   * Whether this viewer may see money at all. DA-13: the Money TAB was gated
   * and `/money` 404s correctly, but the overview's read model computed the
   * viewer's capabilities and then gated nothing — purse, per-team spend and
   * squad caps were served to a member with zero grants and merely not
   * rendered. Gating happens HERE, so the figures never leave the database.
   */
  money: boolean;
}

export async function seasonOverview(
  db: Db,
  competition: CompetitionSummary,
  options: SeasonOverviewOptions,
): Promise<SeasonOverview> {
  const [head, teams, stats, roleRows, auctionRows, fixtureRows, settlement] = await Promise.all([
    // The season's row joined to its org, so the crest costs no extra round
    // trip: the organization name and slug were already being fetched here,
    // and the logo key rides along on the join rather than in a query of its
    // own. Same key→URL resolution the public page uses (public.ts).
    db
      .select({
        orgName: organizations.name,
        orgSlug: organizations.slug,
        logoKey: competitions.logoUrl,
      })
      .from(competitions)
      .innerJoin(organizations, eq(organizations.id, competitions.orgId))
      .where(eq(competitions.id, competition.id))
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
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(fixtures)
      .where(eq(fixtures.competitionId, competition.id)),
    seasonSettlement(db, competition.id, options.money),
  ]);

  const logoKey = head[0]?.logoKey ?? null;
  const base = {
    competition,
    orgName: head[0]?.orgName ?? "",
    orgSlug: head[0]?.orgSlug ?? "",
    logoUrl: logoKey === null ? null : storage.readUrl(logoKey),
    approvedPlayers: stats.approved,
    pendingPlayers: stats.submitted,
    teamCount: teams.length,
    fixtureCount: fixtureRows[0]?.count ?? 0,
    settlement,
    poolByRole: roleRows
      .map((row) => ({ role: row.role, count: row.count }))
      .sort((a, b) => b.count - a.count),
  };

  const auction = auctionRows[0];
  if (auction === undefined) {
    // No auction yet — the tiles that describe one stay honestly empty.
    return {
      ...base,
      ...(options.money ? { purseCommitted: 0, pursePct: null } : {}),
      lotsSold: 0,
      lotsTotal: 0,
      auctionLive: false,
      auctionStatus: null,
      topTeams: teams.map((team) => ({
        teamId: team.id,
        name: team.name,
        color: team.primaryColor,
        squad: 0,
        ...(options.money ? { spend: 0, squadMax: null } : {}),
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
    ...(options.money
      ? {
          purseCommitted,
          pursePct: purseTotal > 0 ? Math.round((purseCommitted / purseTotal) * 100) : null,
        }
      : {}),
    lotsSold: lots.filter((lot) => lot.status === "sold").length,
    lotsTotal: lots.length,
    auctionLive: auction.status === "live",
    auctionStatus: auction.status,
    topTeams: teams
      .map((team) => {
        const entry = spendByTeam.get(team.id);
        return {
          teamId: team.id,
          name: team.name,
          color: team.primaryColor,
          squad: entry?.squad ?? 0,
          ...(options.money ? { spend: entry?.spend ?? 0, squadMax: rules.squadMax } : {}),
        };
      })
      // Without money sight there is no spend to rank by, so the list is
      // alphabetical — and the card is titled for what it actually shows.
      .sort((a, b) =>
        options.money ? (b.spend ?? 0) - (a.spend ?? 0) : a.name.localeCompare(b.name),
      ),
  };
}

/**
 * The season's settlement case, folded from the obligation projection.
 *
 * Rung 6 of the lifecycle used to test `auctionStatus === "reconciled"` — a
 * value no auction in the product can ever hold, because the aggregate's
 * command type structurally excludes the `reconcile` transition. Settlement's
 * completion has always lived in the settlement case, so that is where the rung
 * now reads it: discharged means nothing is outstanding on a case that had
 * something to collect, or the case has been settled/closed outright.
 */
async function seasonSettlement(
  db: Db,
  competitionId: string,
  money: boolean,
): Promise<SeasonSettlement | null> {
  const [row] = await db
    .select({ id: settlementCases.id, status: settlementCases.status })
    .from(settlementCases)
    .where(
      and(
        eq(settlementCases.competitionId, competitionId),
        // A voided case is not this season's settlement; it never happened.
        ne(settlementCases.status, "voided"),
      ),
    )
    .limit(1);
  if (row === undefined) {
    return null;
  }
  const obligations = await db
    .select({
      amount: settlementObligations.amount,
      increased: settlementObligations.increased,
      reinstated: settlementObligations.reinstated,
      reduced: settlementObligations.reduced,
      discharged: settlementObligations.discharged,
      waived: settlementObligations.waived,
    })
    .from(settlementObligations)
    .where(eq(settlementObligations.caseId, row.id));

  let totalDues = 0;
  let collected = 0;
  let outstanding = 0;
  for (const obligation of obligations) {
    const owed = obligation.amount + obligation.increased + obligation.reinstated;
    const settled = obligation.reduced + obligation.discharged + obligation.waived;
    totalDues += owed;
    collected += obligation.discharged;
    outstanding += Math.max(owed - settled, 0);
  }
  const discharged =
    row.status === "settled" ||
    row.status === "closed" ||
    (obligations.length > 0 && outstanding === 0);
  return {
    status: row.status,
    discharged,
    ...(money ? { totalDues, collected, outstanding } : {}),
  };
}
