import { auctions, lots, people, registrations, type Db } from "@desiauction/db";
import { and, eq, ne, sql } from "drizzle-orm";

import { captainChangeRefusal, type CaptainFacts, type CaptainRefusal } from "./roster-lock";
import { shownName } from "./shown-name";

/**
 * `captainChangeRefusal`, read from the database: the player, and — when they
 * are being named captain of a team that has one — the incumbent the armband
 * would be taken from. Only for an auction that has left `scheduled`; before
 * that the pool has not settled and every captain change is free.
 *
 * Both reads are bound to the AUCTION'S season (audit P3): the registration id
 * comes from the browser, and a lookup by id alone would answer for a player
 * in any season of the org — refusing, or clearing, on facts that are not this
 * auction's. A player outside the season is `null` here and `not_found` at the
 * write, which binds by season too.
 */
export async function captainLockRefusal(
  db: Db | Parameters<Parameters<Db["transaction"]>[0]>[0],
  auctionId: string,
  registrationId: string,
  isCaptain: boolean,
): Promise<CaptainRefusal | null> {
  const facts = {
    id: registrations.id,
    name: shownName,
    isIcon: registrations.isIcon,
    isRetained: registrations.isRetained,
    isCaptain: registrations.isCaptain,
    teamId: registrations.teamId,
    bought: sql<boolean>`exists (select 1 from ${lots} where ${lots.registrationId} = ${registrations.id} and ${lots.auctionId} = ${auctionId} and ${lots.status} = 'sold')`,
  };
  const inAuctionSeason = sql`${registrations.competitionId} = (select ${auctions.competitionId} from ${auctions} where ${auctions.id} = ${auctionId})`;
  const [player] = await db
    .select(facts)
    .from(registrations)
    .innerJoin(people, eq(people.id, registrations.personId))
    .where(and(eq(registrations.id, registrationId), inAuctionSeason))
    .limit(1);
  if (player === undefined) {
    return null;
  }
  let incumbent: typeof player | undefined;
  if (isCaptain && player.teamId !== null) {
    [incumbent] = await db
      .select(facts)
      .from(registrations)
      .innerJoin(people, eq(people.id, registrations.personId))
      .where(
        and(
          inAuctionSeason,
          eq(registrations.teamId, player.teamId),
          eq(registrations.isCaptain, true),
          ne(registrations.id, registrationId),
        ),
      )
      .limit(1);
  }
  return captainChangeRefusal(asFacts(player), isCaptain, incumbent ? asFacts(incumbent) : null);
}

function asFacts(row: Omit<CaptainFacts, "name"> & { name: string | null }): CaptainFacts {
  return {
    name: row.name ?? "This player",
    isIcon: row.isIcon,
    isRetained: row.isRetained,
    isCaptain: row.isCaptain,
    bought: row.bought,
  };
}
