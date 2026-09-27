import { auctions, withTenantDb } from "@desiauction/db";
import { desc, eq } from "drizzle-orm";

import { dbHandle } from "../db";
import { canSettlement } from "./authz";
import { settlementDeps } from "./deps";
import { dashboardView } from "./views";

/**
 * WHERE EACH SEASON'S MONEY STANDS, for /money's club books (2026-09-27).
 *
 * /money listed a club's seasons as bare links — "Fees and settlement for this
 * season" beside every one, whether its case was sealed, collecting or never
 * opened. This reads the answer from the same place the org settlement desk
 * does: `dashboardView`, whose money is each case fold's own projection, so the
 * hub and the desk can never disagree. A season with no case says what it is
 * waiting on, from its auction's status.
 *
 * Gated here, not by the caller: nothing is read for an org where the person
 * does not hold `settlement.view`.
 */
export interface SeasonStanding {
  /** The latest case's status (a voided case only when no other exists), or null. */
  readonly caseStatus: string | null;
  readonly totalObligations: number;
  readonly discharged: number;
  readonly waived: number;
  readonly outstanding: number;
  /** The season's latest auction status, or null when it has none. */
  readonly auctionStatus: string | null;
}

export async function seasonStandings(
  personId: string,
  orgId: string,
): Promise<ReadonlyMap<string, SeasonStanding>> {
  return withTenantDb(dbHandle, { personId, orgId }, async (db) => {
    const standings = new Map<string, SeasonStanding>();
    if (!(await canSettlement(db, personId, orgId, "settlement.view"))) {
      return standings;
    }
    const [view, auctionRows] = await Promise.all([
      dashboardView(settlementDeps(db), db, orgId),
      db
        .select({ competitionId: auctions.competitionId, status: auctions.status })
        .from(auctions)
        .where(eq(auctions.orgId, orgId))
        .orderBy(desc(auctions.createdAt)),
    ]);
    const auctionOf = new Map<string, string>();
    for (const row of auctionRows) {
      if (!auctionOf.has(row.competitionId)) {
        auctionOf.set(row.competitionId, row.status);
      }
    }
    // Cases arrive newest first; a live case outranks a voided one.
    const caseOf = new Map<string, (typeof view.cases)[number]>();
    for (const row of view.cases) {
      const held = caseOf.get(row.competitionId);
      if (held === undefined || (held.status === "voided" && row.status !== "voided")) {
        caseOf.set(row.competitionId, row);
      }
    }
    const ids = new Set([...auctionOf.keys(), ...caseOf.keys()]);
    for (const id of ids) {
      const row = caseOf.get(id);
      standings.set(id, {
        caseStatus: row?.status ?? null,
        totalObligations: row?.totalObligations ?? 0,
        discharged: row?.discharged ?? 0,
        waived: row?.waived ?? 0,
        outstanding: row?.outstanding ?? 0,
        auctionStatus: auctionOf.get(id) ?? null,
      });
    }
    return standings;
  });
}
