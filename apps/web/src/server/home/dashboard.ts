import {
  auctions,
  auditLog,
  bids,
  lots,
  payments,
  registrations,
  settlementCases,
  settlementObligations,
  teams,
} from "@desiauction/db";
import { and, desc, gte, inArray, sql } from "drizzle-orm";

import { competitionsView } from "../competition/actions";
import { systemDb } from "../db";

/**
 * The console dashboard's read model.
 *
 * READ ONLY, and scoped by construction: every aggregate below is filtered by
 * the competition/org id list that `competitionsView()` already proved this
 * person belongs to (it resolves membership under RLS). Nothing here widens
 * that set, so the system pool is used the same way `competitionsForPerson`
 * uses it — a cross-org union over ids the caller is already entitled to.
 *
 * No metric is invented. Where a platform has no data yet the number is a real
 * zero, not a placeholder.
 */

export interface HomeStats {
  competitions: number;
  registrations: number;
  activeAuctions: number;
  bids: number;
  /** Registrations already approved into the auction pool. */
  approvedRegistrations: number;
  /** Money collected, in paise. */
  collectedPaise: number;
}

export interface HomeAuctionRow {
  auctionId: string;
  competitionSlug: string;
  competitionName: string;
  status: string;
  lotsTotal: number;
  lotsSold: number;
  spendPaise: number;
}

export interface HomeTopCompetition {
  slug: string;
  name: string;
  status: string;
  teams: number;
  registrations: number;
  collectedPaise: number;
}

export interface HomeActivityRow {
  id: string;
  action: string;
  subject: string | null;
  at: string;
}

export interface HomeMoney {
  collectedPaise: number;
  outstandingPaise: number;
  waivedPaise: number;
  /** Collected per day, oldest first — this week and the week before. */
  thisWeek: number[];
  lastWeek: number[];
}

/**
 * Where each competition sits on the platform's one lifecycle. This is the
 * product in a single row: set it up, take registrations, run auction night,
 * settle the money.
 *
 * Every figure here is scoped to the competitions actually AT that stage, not
 * to the whole portfolio. A stage holding no competitions must not report
 * activity — "0 competitions" beside "15 registered" reads as a contradiction,
 * because the 15 belong to a competition that has already moved on.
 */
export interface HomeStages {
  setup: { competitions: number; teams: number };
  registration: { competitions: number; registered: number; approved: number };
  auction: { competitions: number; live: number; bids: number };
  settlement: { competitions: number; collectedPaise: number; outstandingPaise: number };
}

export interface HomeDashboardData {
  stats: HomeStats;
  stages: HomeStages;
  auctions: HomeAuctionRow[];
  top: HomeTopCompetition[];
  activity: HomeActivityRow[];
  money: HomeMoney;
}

const EMPTY: HomeDashboardData = {
  stats: {
    competitions: 0,
    registrations: 0,
    activeAuctions: 0,
    bids: 0,
    approvedRegistrations: 0,
    collectedPaise: 0,
  },
  stages: {
    setup: { competitions: 0, teams: 0 },
    registration: { competitions: 0, registered: 0, approved: 0 },
    auction: { competitions: 0, live: 0, bids: 0 },
    settlement: { competitions: 0, collectedPaise: 0, outstandingPaise: 0 },
  },
  auctions: [],
  top: [],
  activity: [],
  money: {
    collectedPaise: 0,
    outstandingPaise: 0,
    waivedPaise: 0,
    thisWeek: [0, 0, 0, 0, 0, 0, 0],
    lastWeek: [0, 0, 0, 0, 0, 0, 0],
  },
};

/** Auction states that are "in flight" for the operator. */
const ACTIVE_AUCTION_STATES = new Set(["live", "scheduled"]);

const DAY_MS = 86_400_000;

export async function homeDashboard(): Promise<HomeDashboardData> {
  const view = await competitionsView();
  const competitionIds = view.competitions.map((competition) => competition.id);
  if (competitionIds.length === 0) {
    return EMPTY;
  }
  const bySlug = new Map(view.competitions.map((competition) => [competition.id, competition]));

  // --- auctions for these competitions -------------------------------------
  const auctionRows = await systemDb
    .select({
      id: auctions.id,
      competitionId: auctions.competitionId,
      status: auctions.status,
    })
    .from(auctions)
    .where(inArray(auctions.competitionId, competitionIds));
  const auctionIds = auctionRows.map((row) => row.id);

  // --- settlement cases -> obligations + payments ---------------------------
  const caseRows = await systemDb
    .select({ id: settlementCases.id, competitionId: settlementCases.competitionId })
    .from(settlementCases)
    .where(inArray(settlementCases.competitionId, competitionIds));
  const caseIds = caseRows.map((row) => row.id);
  const caseCompetition = new Map(caseRows.map((row) => [row.id, row.competitionId]));

  const since = new Date(Date.now() - 14 * DAY_MS);
  const [
    registrationRows,
    teamRows,
    lotRows,
    bidCountRows,
    obligationRows,
    paymentRows,
    activityRows,
  ] = await Promise.all([
    systemDb
      .select({
        competitionId: registrations.competitionId,
        status: registrations.status,
        count: sql<number>`count(*)::int`,
      })
      .from(registrations)
      .where(inArray(registrations.competitionId, competitionIds))
      .groupBy(registrations.competitionId, registrations.status),
    systemDb
      .select({ competitionId: teams.competitionId, count: sql<number>`count(*)::int` })
      .from(teams)
      .where(inArray(teams.competitionId, competitionIds))
      .groupBy(teams.competitionId),
    auctionIds.length > 0
      ? systemDb
          .select({
            auctionId: lots.auctionId,
            total: sql<number>`count(*)::int`,
            sold: sql<number>`count(*) filter (where ${lots.status} = 'sold')::int`,
            spend: sql<number>`coalesce(sum(${lots.soldPrice}) filter (where ${lots.status} = 'sold'), 0)::double precision`,
          })
          .from(lots)
          .where(inArray(lots.auctionId, auctionIds))
          .groupBy(lots.auctionId)
      : Promise.resolve([]),
    // Grouped by auction, not totalled: the lifecycle strip reports bids for
    // the competitions at auction stage, so the grain has to reach them.
    auctionIds.length > 0
      ? systemDb
          .select({ auctionId: bids.auctionId, count: sql<number>`count(*)::int` })
          .from(bids)
          .where(inArray(bids.auctionId, auctionIds))
          .groupBy(bids.auctionId)
      : Promise.resolve([]),
    caseIds.length > 0
      ? systemDb
          .select({
            caseId: settlementObligations.caseId,
            amount: sql<number>`coalesce(sum(${settlementObligations.amount}), 0)::double precision`,
            discharged: sql<number>`coalesce(sum(${settlementObligations.discharged}), 0)::double precision`,
            waived: sql<number>`coalesce(sum(${settlementObligations.waived}), 0)::double precision`,
          })
          .from(settlementObligations)
          .where(inArray(settlementObligations.caseId, caseIds))
          .groupBy(settlementObligations.caseId)
      : Promise.resolve([]),
    caseIds.length > 0
      ? systemDb
          .select({ at: payments.createdAt, captured: payments.captured })
          .from(payments)
          .where(and(inArray(payments.caseId, caseIds), gte(payments.createdAt, since)))
      : Promise.resolve([]),
    systemDb
      .select({
        id: auditLog.id,
        action: auditLog.action,
        subject: auditLog.subject,
        at: auditLog.at,
      })
      .from(auditLog)
      .where(inArray(auditLog.scopeId, [...competitionIds, ...view.orgs.map((org) => org.id)]))
      .orderBy(desc(auditLog.at))
      .limit(6),
  ]);

  // One grouped read gives the per-competition total, the approved pool per
  // competition, and the portfolio-wide approved count.
  const registrationsBy = new Map<string, number>();
  const approvedBy = new Map<string, number>();
  let approvedRegistrations = 0;
  for (const row of registrationRows) {
    registrationsBy.set(
      row.competitionId,
      (registrationsBy.get(row.competitionId) ?? 0) + row.count,
    );
    if (row.status === "approved") {
      approvedBy.set(row.competitionId, (approvedBy.get(row.competitionId) ?? 0) + row.count);
      approvedRegistrations += row.count;
    }
  }
  const teamsBy = new Map(teamRows.map((row) => [row.competitionId, row.count]));
  const lotsBy = new Map(lotRows.map((row) => [row.auctionId, row]));

  // Bids reach the competition through their auction.
  const auctionCompetition = new Map(auctionRows.map((row) => [row.id, row.competitionId]));
  const bidsBy = new Map<string, number>();
  let bidTotal = 0;
  for (const row of bidCountRows) {
    bidTotal += row.count;
    const competitionId = auctionCompetition.get(row.auctionId);
    if (competitionId !== undefined) {
      bidsBy.set(competitionId, (bidsBy.get(competitionId) ?? 0) + row.count);
    }
  }
  const liveCompetitions = new Set(
    auctionRows.filter((row) => row.status === "live").map((row) => row.competitionId),
  );

  // Money, folded per competition then totalled.
  const collectedBy = new Map<string, number>();
  const outstandingBy = new Map<string, number>();
  let collectedPaise = 0;
  let outstandingPaise = 0;
  let waivedPaise = 0;
  for (const row of obligationRows) {
    const amount = row.amount;
    const discharged = row.discharged;
    const waived = row.waived;
    const open = Math.max(0, amount - discharged - waived);
    collectedPaise += discharged;
    waivedPaise += waived;
    outstandingPaise += open;
    const competitionId = caseCompetition.get(row.caseId);
    if (competitionId !== undefined) {
      collectedBy.set(competitionId, (collectedBy.get(competitionId) ?? 0) + discharged);
      outstandingBy.set(competitionId, (outstandingBy.get(competitionId) ?? 0) + open);
    }
  }

  // Daily collected series: 7 days for this week and the 7 before it.
  const thisWeek = new Array<number>(7).fill(0);
  const lastWeek = new Array<number>(7).fill(0);
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  for (const payment of paymentRows) {
    const at = payment.at instanceof Date ? payment.at : new Date(String(payment.at));
    const daysAgo = Math.floor((startOfToday.getTime() - at.getTime()) / DAY_MS);
    const captured = payment.captured;
    if (daysAgo >= -1 && daysAgo < 7) {
      const index = 6 - Math.max(0, daysAgo);
      thisWeek[index] = (thisWeek[index] ?? 0) + captured;
    } else if (daysAgo >= 7 && daysAgo < 14) {
      const index = 6 - (daysAgo - 7);
      lastWeek[index] = (lastWeek[index] ?? 0) + captured;
    }
  }

  const auctionList: HomeAuctionRow[] = auctionRows
    .filter((row) => ACTIVE_AUCTION_STATES.has(row.status))
    .map((row) => {
      const competition = bySlug.get(row.competitionId);
      const progress = lotsBy.get(row.id);
      return {
        auctionId: row.id,
        competitionSlug: competition?.slug ?? "",
        competitionName: competition?.name ?? "Competition",
        status: row.status,
        lotsTotal: progress?.total ?? 0,
        lotsSold: progress?.sold ?? 0,
        spendPaise: progress?.spend ?? 0,
      };
    })
    .sort((a, b) => (a.status === b.status ? 0 : a.status === "live" ? -1 : 1))
    .slice(0, 4);

  const top: HomeTopCompetition[] = view.competitions
    .map((competition) => ({
      slug: competition.slug,
      name: competition.name,
      status: competition.status,
      teams: teamsBy.get(competition.id) ?? 0,
      registrations: registrationsBy.get(competition.id) ?? 0,
      collectedPaise: collectedBy.get(competition.id) ?? 0,
    }))
    .sort((a, b) => b.registrations - a.registrations)
    .slice(0, 5);

  // Lifecycle placement: money in flight wins, then the competition's own status.
  const settling = new Set(caseRows.map((row) => row.competitionId));
  const stages: HomeStages = {
    setup: { competitions: 0, teams: 0 },
    registration: { competitions: 0, registered: 0, approved: 0 },
    auction: { competitions: 0, live: 0, bids: 0 },
    settlement: { competitions: 0, collectedPaise: 0, outstandingPaise: 0 },
  };
  for (const competition of view.competitions) {
    const id = competition.id;
    if (settling.has(id)) {
      stages.settlement.competitions += 1;
      stages.settlement.collectedPaise += collectedBy.get(id) ?? 0;
      stages.settlement.outstandingPaise += outstandingBy.get(id) ?? 0;
    } else if (competition.status === "registration_closed") {
      stages.auction.competitions += 1;
      stages.auction.bids += bidsBy.get(id) ?? 0;
      if (liveCompetitions.has(id)) {
        stages.auction.live += 1;
      }
    } else if (competition.status === "registration_open") {
      stages.registration.competitions += 1;
      stages.registration.registered += registrationsBy.get(id) ?? 0;
      stages.registration.approved += approvedBy.get(id) ?? 0;
    } else {
      stages.setup.competitions += 1;
      stages.setup.teams += teamsBy.get(id) ?? 0;
    }
  }

  return {
    stages,
    stats: {
      competitions: view.competitions.length,
      registrations: [...registrationsBy.values()].reduce((sum, n) => sum + n, 0),
      activeAuctions: auctionRows.filter((row) => ACTIVE_AUCTION_STATES.has(row.status)).length,
      bids: bidTotal,
      approvedRegistrations,
      collectedPaise,
    },
    auctions: auctionList,
    top,
    activity: activityRows.map((row) => ({
      id: row.id,
      action: row.action,
      subject: row.subject,
      at: (row.at instanceof Date ? row.at : new Date(String(row.at))).toISOString(),
    })),
    money: { collectedPaise, outstandingPaise, waivedPaise, thisWeek, lastWeek },
  };
}
