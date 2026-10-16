import { isRealAuction } from "@desiauction/auction";
import {
  auctionOwnerInvites,
  auctions,
  competitions,
  organizations,
  paddleGrants,
  people,
  registrations,
  teams,
  newId,
  type Db,
} from "@desiauction/db";
import { messageLanguagesOf } from "@desiauction/messaging/language";
import { and, eq, isNotNull, isNull, ne, sql } from "drizzle-orm";

import { env } from "../../env";
import { auctionScheduleMail, type ScheduleChange } from "../messaging/auction-schedule-mail";
import { enqueueMail, supersedePending, type QueuedMail } from "../messaging/outbox";

/**
 * TELLING THE AUCTION'S PEOPLE WHEN IT IS (email programme PR6) — its owners
 * and its pool players, when the organizer sets, moves or clears the time.
 *
 * HELD, THEN SENT. Each notice waits `SETTLE_MS` in the queue before the
 * scheduled drain (every two minutes) may send it, and a newer change first
 * withdraws every notice for this season still waiting. An organizer who types
 * 8 pm, then 8:30, then 8 pm again inside ten minutes sends ONE mail — the
 * last — and nobody is told the auction moved to a time it never kept.
 *
 * WHO. Owners: an accepted, unrevoked owner invite or an active paddle grant
 * on the season's current auction. Players: approved registrations still in
 * the pool — not an icon, captain or retained player, who does not go under
 * the hammer. Somebody who is both is written to as the owner.
 */

export const SETTLE_MS = 10 * 60 * 1000;

const BASE = (): string => env.PUBLIC_BASE_URL.replace(/\/$/, "");

export interface AuctionPerson {
  readonly personId: string;
  readonly name: string;
  /** The team an owner bids for; null for a player. */
  readonly teamName: string | null;
  /** An owner holding an active paddle grant — ready for the night. */
  readonly hasPaddle: boolean;
}

/** The auction's owners and pool players, each once (an owner who is also a player is the owner). */
export async function auctionPeopleOf(db: Db, competitionId: string): Promise<AuctionPerson[]> {
  const [auction] = await db
    .select({ id: auctions.id })
    .from(auctions)
    .where(
      and(
        eq(auctions.competitionId, competitionId),
        isRealAuction(),
        ne(auctions.status, "abandoned"),
      ),
    )
    .limit(1);
  const invited =
    auction === undefined
      ? []
      : await db
          .select({ personId: auctionOwnerInvites.acceptedBy, name: people.name, team: teams.name })
          .from(auctionOwnerInvites)
          .innerJoin(people, eq(people.id, auctionOwnerInvites.acceptedBy))
          .innerJoin(teams, eq(teams.id, auctionOwnerInvites.teamId))
          .where(
            and(
              eq(auctionOwnerInvites.auctionId, auction.id),
              isNotNull(auctionOwnerInvites.acceptedBy),
              isNull(auctionOwnerInvites.revokedAt),
            ),
          );
  const granted =
    auction === undefined
      ? []
      : await db
          .select({ personId: paddleGrants.personId, name: people.name, team: teams.name })
          .from(paddleGrants)
          .innerJoin(people, eq(people.id, paddleGrants.personId))
          .innerJoin(teams, eq(teams.id, paddleGrants.teamId))
          .where(and(eq(paddleGrants.auctionId, auction.id), isNull(paddleGrants.revokedAt)));
  const players = await db
    .select({ personId: registrations.personId, name: people.name })
    .from(registrations)
    .innerJoin(people, eq(people.id, registrations.personId))
    .where(
      and(
        eq(registrations.competitionId, competitionId),
        eq(registrations.status, "approved"),
        sql`not (${registrations.isIcon} or ${registrations.isCaptain} or ${registrations.isRetained})`,
      ),
    );
  const byPerson = new Map<string, AuctionPerson>();
  const owners = [
    ...invited.map((row) => ({ ...row, paddle: false })),
    ...granted.map((row) => ({ ...row, paddle: true })),
  ];
  for (const owner of owners) {
    if (owner.personId === null) continue;
    const personId = owner.personId.trim();
    byPerson.set(personId, {
      personId,
      name: owner.name?.trim() || "there",
      teamName: owner.team,
      hasPaddle: owner.paddle || (byPerson.get(personId)?.hasPaddle ?? false),
    });
  }
  for (const player of players) {
    const personId = player.personId.trim();
    if (!byPerson.has(personId)) {
      byPerson.set(personId, {
        personId,
        name: player.name?.trim() || "there",
        teamName: null,
        hasPaddle: false,
      });
    }
  }
  return [...byPerson.values()];
}

export async function notifyAuctionSchedule(
  db: Db,
  input: {
    competitionId: string;
    change: ScheduleChange;
    at: Date | null;
    previous: Date | null;
  },
  options: { now?: Date; outboxDb?: Db } = {},
): Promise<{ queued: number; superseded: number }> {
  const [season] = await db
    .select({
      orgId: competitions.orgId,
      orgName: organizations.name,
      season: competitions.name,
      seasonSlug: competitions.slug,
      sport: competitions.sport,
    })
    .from(competitions)
    .innerJoin(organizations, eq(organizations.id, competitions.orgId))
    .where(eq(competitions.id, input.competitionId))
    .limit(1);
  if (season === undefined) {
    return { queued: 0, superseded: 0 };
  }
  const prefix = `auction.schedule:${input.competitionId}:`;
  const superseded = await supersedePending(prefix, options.outboxDb);
  const recipients = await auctionPeopleOf(db, input.competitionId);
  if (recipients.length === 0) {
    return { queued: 0, superseded };
  }
  const languages = await messageLanguagesOf(
    db,
    recipients.map((person) => person.personId),
  );
  const notBefore = new Date((options.now ?? new Date()).getTime() + SETTLE_MS);
  const change = newId();
  const slug = encodeURIComponent(season.seasonSlug);
  const mails: QueuedMail[] = await Promise.all(
    recipients.map(async (person) => ({
      ...(await auctionScheduleMail(
        {
          name: person.name,
          season: season.season.trim(),
          orgName: season.orgName.trim(),
          seasonSlug: season.seasonSlug,
          sport: season.sport,
          change: input.change,
          at: input.at,
          previous: input.previous,
          teamName: person.teamName,
          url:
            person.teamName === null
              ? `${BASE()}/seasons/${slug}/register`
              : `${BASE()}/seasons/${slug}/auction`,
        },
        languages.get(person.personId) ?? "en",
      )),
      personId: person.personId,
      orgId: season.orgId,
      kind: "auction.schedule",
      dedupeKey: `${prefix}${change}:${person.personId}`,
      notBefore,
    })),
  );
  const queued = await enqueueMail(mails, options.outboxDb);
  return { queued: queued.length, superseded };
}

/** For a test: the people this season's notices go to. */
export async function scheduleRecipientIds(db: Db, competitionId: string): Promise<string[]> {
  return (await auctionPeopleOf(db, competitionId)).map((person) => person.personId);
}
