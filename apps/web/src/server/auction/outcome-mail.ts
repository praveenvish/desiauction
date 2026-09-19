import { formatPaiseINR, isMinor, paise } from "@desiauction/core";
import {
  auctionOwnerInvites,
  auctions,
  bids,
  competitions,
  lots,
  organizations,
  paddles,
  people,
  registrations,
  teams,
  type Db,
} from "@desiauction/db";
import { and, asc, eq, inArray, isNotNull, isNull, ne } from "drizzle-orm";

import { env } from "../../env";
import { shownName } from "../competition/shown-name";
import type { QueuedMail, QueuedSms } from "../messaging/outbox";
import { smsFit, smsPrice, smsSeasonName } from "../messaging/templates";
import { ownerSummaryMail, soldMail, unsoldMail, type SquadLine } from "../messaging/player-mail";

/**
 * THE FACTS BEHIND A FINISHED AUCTION'S EMAILS.
 *
 * Gathered once, inside the season's tenant boundary, when the auction
 * completes: every sale with the teams that bid for it, every squad, every
 * owner. `player-mail.ts` turns them into words; the outbox delivers them.
 *
 * What a player is told about other people is what the room already showed:
 * which teams bid and the hammer price are called out loud on the night and
 * published on /spectate. A purse — what a team has LEFT — is told to that
 * team's owner and nobody else.
 */

interface SaleRow {
  lotId: string;
  registrationId: string;
  registrationNumber: string;
  personId: string;
  personName: string | null;
  dateOfBirth: string | null;
  status: string;
  basePrice: number;
  soldPrice: number | null;
  teamId: string | null;
  teamName: string | null;
}

export interface OutcomeMessages {
  readonly mails: QueuedMail[];
  /** One line of SMS per SALE. Never for "not picked", never for owners. */
  readonly texts: QueuedSms[];
}

export async function auctionOutcomeMessages(
  db: Db,
  input: { auctionId: string; competitionId: string },
  now: Date = new Date(),
): Promise<OutcomeMessages> {
  const [context] = await db
    .select({
      season: competitions.name,
      slug: competitions.slug,
      visibility: competitions.visibility,
      orgId: competitions.orgId,
      orgName: organizations.name,
      config: auctions.config,
    })
    .from(auctions)
    .innerJoin(competitions, eq(competitions.id, auctions.competitionId))
    .innerJoin(organizations, eq(organizations.id, competitions.orgId))
    .where(eq(auctions.id, input.auctionId))
    .limit(1);
  if (context === undefined) {
    return { mails: [], texts: [] };
  }
  const config = context.config as { pursePerTeam?: number; squadMin?: number; squadMax?: number };

  const sales: SaleRow[] = await db
    .select({
      lotId: lots.id,
      registrationId: registrations.id,
      registrationNumber: registrations.registrationNumber,
      personId: registrations.personId,
      personName: people.name,
      dateOfBirth: registrations.dateOfBirth,
      status: lots.status,
      basePrice: lots.basePrice,
      soldPrice: lots.soldPrice,
      teamId: paddles.teamId,
      teamName: teams.name,
    })
    .from(lots)
    .innerJoin(registrations, eq(registrations.id, lots.registrationId))
    .innerJoin(people, eq(people.id, registrations.personId))
    .leftJoin(paddles, eq(paddles.id, lots.soldToPaddleId))
    .leftJoin(teams, eq(teams.id, paddles.teamId))
    .where(and(eq(lots.auctionId, input.auctionId), inArray(lots.status, ["sold", "unsold"])));

  // Every bid that stood (not invalidated), with the team that made it.
  const bidRows = await db
    .select({ lotId: bids.lotId, teamName: teams.name, amount: bids.amount })
    .from(bids)
    .innerJoin(paddles, eq(paddles.id, bids.paddleId))
    .innerJoin(teams, eq(teams.id, paddles.teamId))
    .where(and(eq(bids.auctionId, input.auctionId), ne(bids.status, "invalidated")))
    .orderBy(asc(bids.amount));
  const bidsByLot = new Map<string, { bidders: string[]; count: number }>();
  for (const row of bidRows) {
    const entry = bidsByLot.get(row.lotId) ?? { bidders: [], count: 0 };
    entry.count += 1;
    if (!entry.bidders.includes(row.teamName)) {
      entry.bidders.push(row.teamName);
    }
    bidsByLot.set(row.lotId, entry);
  }

  // The squads, as the club knows them (typed names), with each player's note.
  const squadRows = await db
    .select({
      registrationId: registrations.id,
      teamId: registrations.teamId,
      name: shownName,
      isCaptain: registrations.isCaptain,
      isViceCaptain: registrations.isViceCaptain,
      isIcon: registrations.isIcon,
      isRetained: registrations.isRetained,
    })
    .from(registrations)
    .innerJoin(people, eq(people.id, registrations.personId))
    .where(
      and(
        eq(registrations.competitionId, input.competitionId),
        eq(registrations.status, "approved"),
        isNotNull(registrations.teamId),
      ),
    )
    .orderBy(asc(shownName));
  const priceOf = new Map(
    sales
      .filter((sale) => sale.status === "sold" && sale.soldPrice !== null)
      .map((sale) => [sale.registrationId, sale.soldPrice ?? 0]),
  );
  const squadOf = (teamId: string): SquadLine[] =>
    squadRows
      .filter((row) => row.teamId === teamId)
      .map((row) => {
        const price = priceOf.get(row.registrationId);
        const tags = [
          row.isCaptain ? "Captain" : null,
          row.isViceCaptain ? "Vice-captain" : null,
          row.isIcon ? "Icon" : null,
          row.isRetained ? "Retained" : null,
          price === undefined ? null : formatPaiseINR(paise(price)),
        ].filter((tag): tag is string => tag !== null);
        return { name: row.name ?? "Player", note: tags.join(" · ") || "Signed" };
      });

  const soldPrices = sales
    .filter((sale) => sale.status === "sold" && sale.soldPrice !== null)
    .map((sale) => sale.soldPrice ?? 0);
  const topPrice = soldPrices.length > 1 ? Math.max(...soldPrices) : null;
  const topCount = soldPrices.filter((price) => price === topPrice).length;

  const mails: QueuedMail[] = [];
  const texts: QueuedSms[] = [];
  for (const sale of sales) {
    const name = sale.personName?.trim() || "there";
    if (sale.status === "sold" && sale.teamId !== null && sale.teamName !== null) {
      const soldPrice = sale.soldPrice ?? 0;
      const story = bidsByLot.get(sale.lotId) ?? { bidders: [sale.teamName], count: 1 };
      const publicCard =
        context.visibility === "public" && !isMinor(sale.dateOfBirth, now)
          ? `${env.PUBLIC_BASE_URL}/c/${context.slug}/p/${sale.registrationNumber}`
          : null;
      mails.push({
        personId: sale.personId,
        orgId: context.orgId,
        kind: "auction.sold",
        dedupeKey: `auction.sold:${input.auctionId}:${sale.registrationId}`,
        ...soldMail({
          name,
          season: context.season,
          orgName: context.orgName,
          teamName: sale.teamName,
          price: formatPaiseINR(paise(soldPrice)),
          basePrice: formatPaiseINR(paise(sale.basePrice)),
          multiple: sale.basePrice > 0 ? soldPrice / sale.basePrice : null,
          bidders: story.bidders.includes(sale.teamName)
            ? story.bidders
            : [...story.bidders, sale.teamName],
          bidCount: Math.max(story.count, 1),
          highlight:
            topPrice !== null && soldPrice === topPrice && topCount === 1
              ? "You were the most expensive buy of the night"
              : null,
          squad: squadOf(sale.teamId),
          cardUrl: publicCard,
        }),
      });
      texts.push({
        personId: sale.personId,
        orgId: context.orgId,
        kind: "auction.sold",
        dedupeKey: `sms:auction.sold:${input.auctionId}:${sale.registrationId}`,
        templateKey: "auction.sold",
        slots: {
          team: smsFit(sale.teamName),
          price: smsPrice(formatPaiseINR(paise(soldPrice))),
          competition: smsSeasonName(context.season),
        },
      });
    } else if (sale.status === "unsold") {
      mails.push({
        personId: sale.personId,
        orgId: context.orgId,
        kind: "auction.unsold",
        dedupeKey: `auction.unsold:${input.auctionId}:${sale.registrationId}`,
        ...unsoldMail({ name, season: context.season, orgName: context.orgName }),
      });
    }
  }

  // Each owner gets their own team's night: squad, spend, and what is left.
  const owners = await db
    .select({
      personId: auctionOwnerInvites.acceptedBy,
      ownerName: people.name,
      teamId: auctionOwnerInvites.teamId,
      teamName: teams.name,
    })
    .from(auctionOwnerInvites)
    .innerJoin(people, eq(people.id, auctionOwnerInvites.acceptedBy))
    .innerJoin(teams, eq(teams.id, auctionOwnerInvites.teamId))
    .where(
      and(
        eq(auctionOwnerInvites.auctionId, input.auctionId),
        isNotNull(auctionOwnerInvites.acceptedBy),
        isNull(auctionOwnerInvites.revokedAt),
      ),
    );
  for (const owner of owners) {
    if (owner.personId === null) continue;
    const spent = sales
      .filter((sale) => sale.status === "sold" && sale.teamId === owner.teamId)
      .reduce((sum, sale) => sum + (sale.soldPrice ?? 0), 0);
    const squad = squadOf(owner.teamId);
    const purse = config.pursePerTeam ?? 0;
    mails.push({
      personId: owner.personId,
      orgId: context.orgId,
      kind: "auction.owner_summary",
      dedupeKey: `auction.owner_summary:${input.auctionId}:${owner.teamId}:${owner.personId}`,
      ...ownerSummaryMail({
        name: owner.ownerName?.trim() || "there",
        season: context.season,
        teamName: owner.teamName,
        squad,
        spent: formatPaiseINR(paise(spent)),
        purseLeft: formatPaiseINR(paise(Math.max(purse - spent, 0))),
        squadSize: squad.length,
        squadMin: config.squadMin ?? 0,
        squadMax: config.squadMax ?? 0,
        teamUrl: `${env.PUBLIC_BASE_URL}/seasons/${context.slug}/teams`,
      }),
    });
  }
  return { mails, texts };
}
