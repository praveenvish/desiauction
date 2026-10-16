import { isRealAuction } from "@desiauction/auction";
import {
  auctionOwnerInvites,
  auctions,
  newId,
  paddleGrants,
  teams,
  type Db,
} from "@desiauction/db";
import { and, eq, isNotNull, isNull, ne, sql } from "drizzle-orm";

/** Caller supplies the season's withTenantDb transaction; no owner pool or nested transaction. */
export async function syncAuctionOwnersToManagers(
  db: Db,
  competitionId: string,
  actorId: string,
): Promise<void> {
  const [invited, granted] = await Promise.all([
    db
      .select({ orgId: teams.orgId, teamId: teams.id, personId: auctionOwnerInvites.acceptedBy })
      .from(auctionOwnerInvites)
      .innerJoin(teams, eq(teams.id, auctionOwnerInvites.teamId))
      .innerJoin(auctions, eq(auctions.id, auctionOwnerInvites.auctionId))
      .where(
        and(
          eq(auctions.competitionId, competitionId),
          eq(teams.competitionId, competitionId),
          isNotNull(auctionOwnerInvites.acceptedBy),
          isNotNull(auctionOwnerInvites.acceptedAt),
          isNull(auctionOwnerInvites.revokedAt),
          ne(auctions.status, "abandoned"),
          isRealAuction(),
        ),
      ),
    db
      .select({ orgId: teams.orgId, teamId: teams.id, personId: paddleGrants.personId })
      .from(paddleGrants)
      .innerJoin(teams, eq(teams.id, paddleGrants.teamId))
      .innerJoin(auctions, eq(auctions.id, paddleGrants.auctionId))
      .where(
        and(
          eq(auctions.competitionId, competitionId),
          eq(teams.competitionId, competitionId),
          isNull(paddleGrants.revokedAt),
          ne(auctions.status, "abandoned"),
          isRealAuction(),
        ),
      ),
  ]);
  const candidates = new Map(
    [...invited, ...granted]
      .filter((row) => row.personId !== null)
      .map((row) => [`${row.teamId}:${String(row.personId)}`, row]),
  );
  // Stable lock order, shared by future explicit manager mutations. A separate
  // statement after the lock sees the latest committed history under READ COMMITTED.
  for (const [key, row] of [...candidates].sort(([a], [b]) => a.localeCompare(b))) {
    await db.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`ls1-manager:${row.orgId}:${competitionId}:${key}`}, 0))`,
    );
    await db.execute(sql`
      insert into team_managers (id, org_id, competition_id, team_id, person_id, role, source, created_by)
      select ${newId()}, ${row.orgId}, ${competitionId}, ${row.teamId}, ${row.personId}, 'manager', 'auction_owner', ${actorId}
      where not exists (
        select 1 from team_managers m where m.org_id = ${row.orgId} and m.competition_id = ${competitionId}
          and m.team_id = ${row.teamId} and m.person_id = ${row.personId}
      ) and exists (
        select 1 from auctions a join teams t on t.competition_id = a.competition_id
        where a.competition_id = ${competitionId} and a.org_id = ${row.orgId}
          and t.org_id = ${row.orgId} and t.id = ${row.teamId} and a.kind = 'real' and a.status <> 'abandoned'
          and (exists (select 1 from auction_owner_invites i where i.auction_id = a.id and i.team_id = t.id
            and i.accepted_by = ${row.personId} and i.accepted_at is not null and i.revoked_at is null)
          or exists (select 1 from paddle_grants p where p.auction_id = a.id and p.team_id = t.id
            and p.person_id = ${row.personId} and p.revoked_at is null))
      ) on conflict do nothing
    `);
  }
}
