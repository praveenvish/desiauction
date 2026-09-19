import { roleOptions } from "@desiauction/core";
import { auctions, people, registrations, type Db } from "@desiauction/db";
import { and, eq, inArray, ne, sql } from "drizzle-orm";

import { roleLabeller } from "../../lib/role-label";
import { resolvedLots, rulesOf } from "../auction/live-summary";
import type { CompetitionSummary } from "../competition/competitions";
import { registrationStats } from "../competition/registrations";
import { seasonOverview } from "../competition/season-overview";
import { consentedPhotoUrl, shownPhotoConsentAt, shownPhotoKey } from "../competition/shown-name";

/**
 * /reports — ONE SEASON, SUMMED UP, for the people who run it.
 *
 * Nothing here is a new source of truth: registrations come from the desk's own
 * `registrationStats`, teams and spend from `seasonOverview` (the Overview tab's
 * read), lots from `resolvedLots` (the auction's). This module only arranges
 * them into the report shapes and decides — BEFORE the read, per DA-13 — which
 * money keys exist at all. Without money sight the object carries no rupee:
 * not a zero, not a null, no key.
 */

export interface ReportTeam {
  teamId: string;
  name: string;
  color: string | null;
  squad: number;
  squadMax?: number | null;
  /** Paise. Money-gated. */
  spend?: number;
  /** Paise — the auction's purse per team. Money-gated. */
  purse?: number;
}

export interface ReportBuy {
  registrationId: string;
  playerName: string | null;
  photoUrl: string | null;
  role: string | null;
  teamName: string | null;
  /** Paise. */
  price: number;
}

export interface SeasonReport {
  registrations: {
    total: number;
    submitted: number;
    approved: number;
    waitlisted: number;
    rejected: number;
    withdrawn: number;
    auctionPool: number;
    preSigned: number;
  };
  fees: {
    /** Head counts — the desk shows these to every reviewer. */
    paid: number;
    pending: number;
    waived: number;
    refunded: number;
    /** Paise recorded as paid. Money-gated. */
    collectedPaise?: number;
    /** Paise recorded against people who have not paid. Money-gated. */
    duePaise?: number;
  };
  auction: {
    status: string | null;
    sold: number;
    unsold: number;
    /** Still to go under the hammer (queued, prepared or on the block). */
    remaining: number;
    /** Paise. Money-gated. */
    moneyMoved?: number;
    /** 0–100 or null. Money-gated. */
    pursePct?: number | null;
  };
  teams: ReportTeam[];
  /** The five dearest buys. Money-gated: absent without sight. */
  topBuys?: ReportBuy[];
}

export async function seasonReportIn(
  db: Db,
  competition: CompetitionSummary,
  options: { money: boolean; readUrl: (key: string) => string },
): Promise<SeasonReport> {
  const [stats, overview, auctionRows, dueRows] = await Promise.all([
    registrationStats(db, competition.id),
    seasonOverview(db, competition, { money: options.money }),
    db
      .select({ id: auctions.id, status: auctions.status, config: auctions.config })
      .from(auctions)
      .where(and(eq(auctions.competitionId, competition.id), ne(auctions.status, "abandoned")))
      .limit(1),
    options.money
      ? db
          .select({
            due: sql<number>`coalesce(sum(${registrations.feeAmountPaise}), 0)::double precision`,
          })
          .from(registrations)
          .where(
            and(
              eq(registrations.competitionId, competition.id),
              eq(registrations.feeStatus, "pending"),
              ne(registrations.status, "withdrawn"),
              ne(registrations.status, "draft"),
            ),
          )
      : Promise.resolve([]),
  ]);
  const auction = auctionRows[0];
  const [resolved, poolRows] =
    auction === undefined
      ? [[], []]
      : await Promise.all([
          resolvedLots(db, auction.id),
          db
            .select({ count: sql<number>`count(*)::int` })
            .from(registrations)
            .where(
              and(
                eq(registrations.competitionId, competition.id),
                // Pending lots: every lot the night has not resolved.
                sql`exists (select 1 from lots pending_lot where pending_lot.registration_id = "registrations"."id" and pending_lot.auction_id = ${auction.id} and pending_lot.status in ('prepared', 'queued', 'on_block', 'closing_soon', 'frozen'))`,
              ),
            ),
        ]);
  const sold = resolved.filter((lot) => lot.status === "sold");
  const purse = auction === undefined ? null : rulesOf(auction.config).pursePerTeam;

  let topBuys: ReportBuy[] | undefined;
  if (options.money) {
    const dearest = [...sold]
      .sort((a, b) => (b.soldPrice ?? 0) - (a.soldPrice ?? 0))
      .slice(0, 5)
      .filter((lot) => lot.registrationId !== null);
    const ids = dearest.map((lot) => lot.registrationId as string);
    const photos =
      ids.length === 0
        ? []
        : await db
            .select({
              id: registrations.id,
              photoKey: shownPhotoKey,
              photoConsentAt: shownPhotoConsentAt,
            })
            .from(registrations)
            .innerJoin(people, eq(people.id, registrations.personId))
            .where(inArray(registrations.id, ids));
    const photoBy = new Map(
      photos.map((row) => [row.id, consentedPhotoUrl(row, options.readUrl)] as const),
    );
    const roleLabel = roleLabeller(roleOptions(competition.sport));
    topBuys = dearest.map((lot) => ({
      registrationId: lot.registrationId as string,
      playerName: lot.playerName,
      photoUrl: photoBy.get(lot.registrationId as string) ?? null,
      role: lot.role === null ? null : roleLabel(lot.role),
      teamName: lot.teamName,
      price: lot.soldPrice ?? 0,
    }));
  }

  return {
    registrations: {
      total: stats.total,
      submitted: stats.submitted,
      approved: stats.approved,
      waitlisted: stats.waitlisted,
      rejected: stats.rejected,
      withdrawn: stats.withdrawn,
      auctionPool: stats.auctionPool,
      preSigned: stats.icons + stats.captains + stats.retained,
    },
    fees: {
      paid: stats.fees.paid,
      pending: stats.fees.pending,
      waived: stats.fees.waived,
      refunded: stats.fees.refunded,
      ...(options.money
        ? { collectedPaise: stats.feeCollectedPaise, duePaise: dueRows[0]?.due ?? 0 }
        : {}),
    },
    auction: {
      status: auction?.status ?? null,
      sold: sold.length,
      unsold: resolved.filter((lot) => lot.status === "unsold").length,
      remaining: poolRows[0]?.count ?? 0,
      ...(options.money
        ? {
            moneyMoved: sold.reduce((sum, lot) => sum + (lot.soldPrice ?? 0), 0),
            pursePct: overview.pursePct ?? null,
          }
        : {}),
    },
    teams: overview.topTeams.map((team) => ({
      teamId: team.teamId,
      name: team.name,
      color: team.color,
      squad: team.squad,
      ...(options.money
        ? {
            squadMax: team.squadMax ?? null,
            spend: team.spend ?? 0,
            ...(purse !== null ? { purse } : {}),
          }
        : {}),
    })),
    ...(topBuys !== undefined ? { topBuys } : {}),
  };
}

/** CSV-ready tables, derived from one report — the download is the page, as rows. */
export type ReportTable = "registrations" | "teams" | "buys";

export function reportRows(
  report: SeasonReport,
  table: ReportTable,
): { header: string[]; rows: string[][] } | null {
  const text = (cells: readonly (string | number)[]): string[] => cells.map((cell) => String(cell));
  if (table === "registrations") {
    const r = report.registrations;
    return {
      header: ["status", "players"],
      rows: (
        [
          ["Submitted", r.submitted],
          ["Approved", r.approved],
          ["Waitlisted", r.waitlisted],
          ["Declined", r.rejected],
          ["Withdrawn", r.withdrawn],
          ["Total", r.total],
        ] as const
      ).map(text),
    };
  }
  if (table === "teams") {
    // The spend table IS money: without sight there is nothing to export.
    if (report.teams.some((team) => team.spend === undefined)) return null;
    return {
      header: ["team", "squad", "squad_max", "spend_rupees", "purse_rupees"],
      rows: report.teams.map((team) =>
        text([
          team.name,
          team.squad,
          team.squadMax ?? "",
          (team.spend ?? 0) / 100,
          team.purse === undefined ? "" : team.purse / 100,
        ]),
      ),
    };
  }
  if (report.topBuys === undefined) return null;
  return {
    header: ["player", "role", "team", "price_rupees"],
    rows: report.topBuys.map((buy) =>
      text([buy.playerName ?? "", buy.role ?? "", buy.teamName ?? "", buy.price / 100]),
    ),
  };
}
