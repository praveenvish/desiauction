import { inRealAuction } from "@desiauction/auction";
import {
  competitions,
  finopsDocuments,
  finopsSeries,
  organizations,
  paddles,
  teams,
} from "@desiauction/db";
import { formattedNumber } from "@desiauction/financial-operations";
import { and, desc, eq, inArray, sql } from "drizzle-orm";

import { systemDb } from "../db";
import { storage } from "../media";

/**
 * The documents issued to YOU — the receipts a person who paid can actually see.
 *
 * Before this, a paying team owner could see their receipt on exactly zero
 * surfaces. The `in-app` delivery adapter reports every dispatch as confirmed
 * with no side effect, reasoning that "delivery IS visibility — the dispatch
 * register is the tray a signed-in officer reads". But that register is
 * `finops.view`-gated and a team owner is a viewer-level member, so they get a
 * 404. `/money` rendered one unconditional EmptyState for every user, with no
 * branch and no query. `/inbox` has no finance writer. Money moved, a numbered
 * receipt was sealed, the operator's desk said "delivered", and the payer had
 * nowhere to look.
 *
 * The join needs no new column. A document records `party_type='team'` with the
 * team's id, and `paddles` records which person bid for which team — so the
 * person→team→document chain already exists in the schema.
 *
 * This is deliberately a `systemDb` read, like `/inbox`'s: the documents belong
 * to organizations this person is usually NOT a member of (a team owner is a
 * guest at the club's finance desk). It is the documented person-scoped
 * cross-org pool, and it is filtered by ids that are provably this person's —
 * their own paddles. It never widens beyond that.
 */
export interface MyDocument {
  readonly docId: string;
  readonly formatted: string;
  readonly kind: string;
  readonly amount: number;
  /** The team the document was issued to — /money groups by it. */
  readonly teamId: string;
  readonly teamName: string;
  /** The team's own mark, so a receipt reads as that franchise's. */
  readonly teamColor: string | null;
  readonly teamLogoUrl: string | null;
  readonly competitionName: string | null;
  readonly orgName: string | null;
  readonly issuedAt: string;
}

export async function myDocuments(personId: string): Promise<MyDocument[]> {
  /*
   * THEIR teams — and not the ones they were removed from (PRR 2026-09-29).
   *
   * A paddle row is for ever: it is auction history, and removing an owner
   * revokes their GRANT, not their paddle. So this read, keyed on paddles
   * alone, kept showing a removed owner every receipt issued to the team they
   * no longer own — on the pool that bypasses row security, so nothing behind
   * it would have stopped it either.
   *
   * A revoked grant with no active one beside it is what "removed" looks like.
   * A paddle that was merely RELEASED (handed to a co-owner for the night) is
   * still that person's team, and a paddle issued with no grant at all (the
   * organizer bidding for an absent owner, DA-02) is unaffected.
   */
  const myTeams = await systemDb
    .selectDistinct({ teamId: paddles.teamId })
    .from(paddles)
    .where(
      and(
        eq(paddles.personId, personId),
        inRealAuction(paddles.auctionId),
        sql`not (
          exists (
            select 1 from paddle_grants g
             where g.person_id = ${personId}
               and g.team_id = ${paddles.teamId}
               and g.auction_id in (select id from auctions where kind = 'real')
               and g.revoked_at is not null
          )
          and not exists (
            select 1 from paddle_grants g
             where g.person_id = ${personId}
               and g.team_id = ${paddles.teamId}
               and g.auction_id in (select id from auctions where kind = 'real')
               and g.revoked_at is null
          )
        )`,
      ),
    );
  const teamIds = myTeams.map((row) => row.teamId);
  if (teamIds.length === 0) {
    return [];
  }

  const rows = await systemDb
    .select({
      docId: finopsDocuments.id,
      number: finopsDocuments.number,
      kind: finopsDocuments.kind,
      amount: finopsDocuments.amount,
      partyId: finopsDocuments.partyId,
      partyLabel: finopsDocuments.partyLabel,
      teamColor: teams.primaryColor,
      teamLogoKey: teams.logoUrl,
      orgName: organizations.name,
      createdAt: finopsDocuments.createdAt,
      prefix: finopsSeries.prefix,
      fy: finopsSeries.fy,
      competitionName: competitions.name,
    })
    .from(finopsDocuments)
    .innerJoin(finopsSeries, eq(finopsSeries.id, finopsDocuments.seriesId))
    .leftJoin(teams, eq(teams.id, finopsDocuments.partyId))
    .leftJoin(competitions, eq(competitions.id, teams.competitionId))
    .leftJoin(organizations, eq(organizations.id, competitions.orgId))
    .where(inArray(finopsDocuments.partyId, teamIds))
    .orderBy(desc(finopsDocuments.createdAt));

  return rows.map((row) => ({
    docId: row.docId,
    // The platform's own formatter, so this reads identically to the operator's
    // register and to the sealed document itself.
    formatted: formattedNumber(row.prefix, row.fy, row.number),
    kind: row.kind,
    amount: row.amount,
    teamId: row.partyId,
    teamName: row.partyLabel,
    teamColor: row.teamColor,
    // Published branding (it renders on /c/<slug>), signed at the view boundary.
    teamLogoUrl: row.teamLogoKey === null ? null : storage.readUrl(row.teamLogoKey),
    competitionName: row.competitionName,
    orgName: row.orgName,
    issuedAt: row.createdAt.toISOString(),
  }));
}
