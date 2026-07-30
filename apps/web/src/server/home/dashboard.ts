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
  tournaments,
} from "@desiauction/db";
import { and, desc, gte, inArray, sql } from "drizzle-orm";

import { competitionsView } from "../competition/actions";
import { systemDb } from "../db";
import { settlementOrgIds } from "../settlement/actions";

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
  /**
   * How many raw events this row stands for. 1 for a real event; greater for
   * the single folded finance row (see `foldActivity`).
   */
  count: number;
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

/** Per-competition counts the console already paid for, keyed by competition id. */
export interface HomeCompetitionCounts {
  teams: number;
  registrations: number;
}

export interface HomeDashboardData {
  stats: HomeStats;
  stages: HomeStages;
  auctions: HomeAuctionRow[];
  top: HomeTopCompetition[];
  activity: HomeActivityRow[];
  money: HomeMoney;
  /**
   * Recurring tournaments this person's orgs own. The setup ladder needs to
   * tell "no tournament yet" apart from "a tournament with no season yet", and
   * the season list alone cannot: a tournament carries no season until one is
   * created.
   */
  tournaments: number;
  /** Teams/registrations per competition — no extra query, already grouped. */
  counts: Record<string, HomeCompetitionCounts>;
  /**
   * Where the money figures on this page actually lead.
   *
   * `/money` is a beta placeholder and was pulled from the rail for it, so the
   * console must not send anyone there. The season's own Money tab IS built, so
   * it is the destination — but only when ONE settling season owns the totals
   * (otherwise the link would silently pick a season) and only when this person
   * holds `settlement.view` on its org (otherwise the tab answers 404). When
   * neither holds, this is null and the caller renders no link at all.
   */
  moneyHref: string | null;
}

/** Auction states that are "in flight" for the operator. */
const ACTIVE_AUCTION_STATES = new Set(["live", "scheduled"]);

const DAY_MS = 86_400_000;

/** How many raw audit rows to consider before ranking. */
const ACTIVITY_POOL = 60;
/** How many rows the feed shows. */
const ACTIVITY_ROWS = 6;

/**
 * Machine chatter: true events, but written for the engine's benefit rather
 * than the organizer's. A lot being prepared, queued or marked closing-soon is
 * a step the platform took on its own; six of them crowd out the twelve
 * registrations and the auction that the organizer actually did.
 */
const ACTIVITY_MACHINE = new Set([
  "auction.LotPrepared",
  "auction.LotQueued",
  "auction.LotClosingSoon",
  "auction.TimerExtended",
  "auction.PaddleIssued",
  "auction.PaddleGranted",
  "auction.OwnerInvited",
  "auction.OwnerAccepted",
  "settlement.ObligationsComputed",
  "settlement.ObligationDischarged",
  "settlement.PaymentInitiated",
  "settlement.JournalPosted",
  "settlement.JournalRecovered",
  "settlement.CaseRecovered",
]);

/** Domains whose events are about this person's account, not their tournament. */
const ACTIVITY_PERSONAL = new Set(["auth", "profile"]);

/**
 * Rank the feed for the person reading it.
 *
 * The raw table is dominated by finance: the finops follower emits far more
 * events than an organizer ever does, so an unranked `limit(6)` returned six
 * finance rows and buried twelve registrations, two seasons, an auction and a
 * settlement. Organizer-facing events take the rows; everything finance folds
 * into ONE summarised row so the work is still visible without owning the
 * panel.
 */
function foldActivity(
  rows: { id: string; action: string; subject: string | null; at: Date | string }[],
): HomeActivityRow[] {
  const iso = (at: Date | string) => (at instanceof Date ? at : new Date(at)).toISOString();
  const finance: typeof rows = [];
  const organizer: typeof rows = [];
  for (const row of rows) {
    const domain = row.action.split(".")[0] ?? "";
    if (ACTIVITY_MACHINE.has(row.action) || ACTIVITY_PERSONAL.has(domain)) {
      continue;
    }
    (domain === "finops" ? finance : organizer).push(row);
  }
  const kept: HomeActivityRow[] = organizer
    .slice(0, finance.length > 0 ? ACTIVITY_ROWS - 1 : ACTIVITY_ROWS)
    .map((row) => ({
      id: row.id,
      action: row.action,
      subject: row.subject,
      at: iso(row.at),
      count: 1,
    }));
  const newest = finance[0];
  if (newest !== undefined) {
    kept.push({
      id: `finance-${newest.id}`,
      action: "finops.summary",
      subject: null,
      at: iso(newest.at),
      count: finance.length,
    });
  }
  return kept.sort((a, b) => b.at.localeCompare(a.at));
}

export async function homeDashboard(): Promise<HomeDashboardData> {
  const view = await competitionsView();
  const competitionIds = view.competitions.map((competition) => competition.id);
  const orgIds = view.orgs.map((org) => org.id);
  const bySlug = new Map(view.competitions.map((competition) => [competition.id, competition]));

  // The feed and the tournament count are scoped by ORG, not by competition, so
  // they answer for an organizer who has a club and nothing else yet. Returning
  // early on "no competitions" threw both away and told a person who had just
  // created their organization that nothing had ever happened — seconds after
  // the event that says otherwise was written.
  const scopeIds = [...competitionIds, ...orgIds];
  const [activityRaw, tournamentRows] = await Promise.all([
    scopeIds.length > 0
      ? systemDb
          .select({
            id: auditLog.id,
            action: auditLog.action,
            subject: auditLog.subject,
            at: auditLog.at,
          })
          .from(auditLog)
          .where(inArray(auditLog.scopeId, scopeIds))
          .orderBy(desc(auditLog.at))
          .limit(ACTIVITY_POOL)
      : Promise.resolve([]),
    orgIds.length > 0
      ? systemDb
          .select({ count: sql<number>`count(*)::int` })
          .from(tournaments)
          .where(inArray(tournaments.orgId, orgIds))
      : Promise.resolve([]),
  ]);
  const activity = foldActivity(activityRaw);
  const tournamentCount = tournamentRows[0]?.count ?? 0;

  if (competitionIds.length === 0) {
    return {
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
      activity,
      money: {
        collectedPaise: 0,
        outstandingPaise: 0,
        waivedPaise: 0,
        thisWeek: [0, 0, 0, 0, 0, 0, 0],
        lastWeek: [0, 0, 0, 0, 0, 0, 0],
      },
      tournaments: tournamentCount,
      counts: {},
      moneyHref: null,
    };
  }

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
    settleableOrgIds,
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
          // caseId travels so the weekly series can be filtered by whose books
          // the viewer may open (DA-30) — the totals above already are.
          .select({
            caseId: payments.caseId,
            at: payments.createdAt,
            captured: payments.captured,
          })
          .from(payments)
          .where(and(inArray(payments.caseId, caseIds), gte(payments.createdAt, since)))
      : Promise.resolve([]),
    // One grants read, expanded by settlement's own capability engine — the
    // same answer the shell's Money tab is gated on, so the console can never
    // offer a link the destination will 404.
    settlementOrgIds(),
  ]);
  const settleable = new Set(settleableOrgIds);

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

  // Money, folded per competition then totalled — but ONLY from the orgs whose
  // books this person may open.
  //
  // DA-30: `settleableOrgIds` was resolved and then used for exactly one thing —
  // deciding whether the money tile was a LINK. The figures themselves (total
  // collected, outstanding, waived, and the two weekly series) were folded from
  // every settlement case in every org the person merely belongs to, and shipped
  // to them. A team owner, whom `acceptOwnerJoin` enrols as a viewer-level
  // member, was handed the club's collections on their own home page.
  const settleableCase = (caseId: string): boolean => {
    const competitionId = caseCompetition.get(caseId);
    const competition = competitionId === undefined ? undefined : bySlug.get(competitionId);
    return competition !== undefined && settleable.has(competition.orgId);
  };
  const collectedBy = new Map<string, number>();
  const outstandingBy = new Map<string, number>();
  let collectedPaise = 0;
  let outstandingPaise = 0;
  let waivedPaise = 0;
  for (const row of obligationRows) {
    if (!settleableCase(row.caseId)) {
      continue;
    }
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
    if (!settleableCase(payment.caseId)) {
      continue;
    }
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

  // The money figures belong to the settlement cases; a link is only honest
  // when exactly ONE season owns them and this person may open its books.
  const settlingIds = [...settling];
  const onlySettling = settlingIds.length === 1 ? bySlug.get(settlingIds[0] ?? "") : undefined;
  const moneyHref =
    onlySettling !== undefined && settleable.has(onlySettling.orgId)
      ? `/seasons/${onlySettling.slug}/money`
      : null;

  const counts: Record<string, HomeCompetitionCounts> = {};
  for (const competition of view.competitions) {
    counts[competition.id] = {
      teams: teamsBy.get(competition.id) ?? 0,
      registrations: registrationsBy.get(competition.id) ?? 0,
    };
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
    activity,
    money: { collectedPaise, outstandingPaise, waivedPaise, thisWeek, lastWeek },
    tournaments: tournamentCount,
    counts,
    moneyHref,
  };
}
