import {
  auctionOwnerInvites,
  auctions,
  competitions,
  newId,
  paddleGrants,
  teams,
  organizations,
  people,
  registrations,
  type Db,
} from "@desiauction/db";
import type { Tier } from "@desiauction/core";
import { messageLanguagesOf } from "@desiauction/messaging/language";
import { and, count, eq, inArray, isNotNull, isNull, ne } from "drizzle-orm";

import { env } from "../../env";

import { logSecurityEvent } from "../auth/security-events";
import { logger } from "../logger";
import type { NotificationMail } from "../messaging/notification-email";
import {
  clubWelcomeMail,
  firstRegistrationMail,
  seasonHeldMail,
  seasonReleasedMail,
} from "../messaging/organizer-mail";
import { drainOutbox, enqueueMail, type QueuedMail } from "../messaging/outbox";
import { ownersReadyMail } from "../messaging/owner-mail";
import { memberJoinedMail } from "../messaging/club-mail";
import { passAnsweredMail, passRequestedMail, staffPassRequestMail } from "../messaging/plan-mail";
import { sendNotificationMail } from "../messaging/notify";
import { SUPPORT_EMAIL } from "../messaging/email-layout";
import type { NotificationKind } from "../messaging/catalogue";
import type { TransactionalMailer } from "../messaging/transactional-mail";
import { holdersOf } from "./orgs";

/**
 * TELLING THE PEOPLE WHO RUN A CLUB (email programme PR5) — the welcome, the
 * first registration and a moderation hold. The 9 am digest has its own sweep
 * (competition/registration-digest.ts).
 *
 * WHO. A club's owners and staff: the two capability sets that review
 * registrations, and a grant only counts with a live membership (`holdersOf`).
 * A viewer — a team owner — is not told how the club is run.
 *
 * HOW. Through the personal-message queue, like every player moment: the drain
 * resolves each person's verified address when it sends, asks the same gate,
 * and the dedupe key makes a retry harmless. Delivered at once for just these
 * rows, and always best effort — the thing that happened has committed, and a
 * provider outage costs a mail, never the action.
 */

export interface OrganizerNoticeChannels {
  readonly mailer?: TransactionalMailer;
  /** The pool the queue is written and drained on; the app pool when omitted. */
  readonly outboxDb?: Db;
}

/** A club's owners and staff, each once. */
export async function organizersOf(db: Db, orgId: string): Promise<string[]> {
  const [owners, staff] = await Promise.all([
    holdersOf(db, orgId, "org:owner"),
    holdersOf(db, orgId, "org:staff"),
  ]);
  return [...new Set([...owners, ...staff])];
}

async function namesOf(db: Db, personIds: readonly string[]): Promise<Map<string, string>> {
  if (personIds.length === 0) return new Map();
  const rows = await db
    .select({ id: people.id, name: people.name })
    .from(people)
    .where(inArray(people.id, personIds as string[]));
  return new Map(rows.map((row) => [row.id, row.name?.trim() || "there"]));
}

/** Queue these and deliver just them, now. Returns the keys that were new. */
async function deliver(
  mails: readonly QueuedMail[],
  channels: OrganizerNoticeChannels,
): Promise<string[]> {
  const fresh = await enqueueMail(mails, channels.outboxDb);
  if (fresh.length > 0) {
    await drainOutbox({
      ...(channels.outboxDb === undefined ? {} : { db: channels.outboxDb }),
      dedupeKeys: fresh,
      limit: fresh.length,
      ...(channels.mailer === undefined ? {} : { mailer: channels.mailer }),
    });
  }
  return fresh;
}

/** One queued mail per person, each in their own language. */
async function forEachOrganizer(
  db: Db,
  personIds: readonly string[],
  input: { orgId: string; kind: NotificationKind; key: (personId: string) => string },
  render: (name: string, language: "en" | "hi") => Promise<NotificationMail>,
): Promise<QueuedMail[]> {
  const [names, languages] = await Promise.all([
    namesOf(db, personIds),
    messageLanguagesOf(db, personIds),
  ]);
  return Promise.all(
    personIds.map(async (personId) => ({
      ...(await render(names.get(personId) ?? "there", languages.get(personId) ?? "en")),
      personId,
      orgId: input.orgId,
      kind: input.kind,
      dedupeKey: input.key(personId),
    })),
  );
}

/** The season, its club and sport — what every organizer mail names. */
async function seasonOf(
  db: Db,
  competitionId: string,
): Promise<{
  orgId: string;
  orgName: string;
  season: string;
  seasonSlug: string;
  sport: string;
} | null> {
  const [row] = await db
    .select({
      orgId: competitions.orgId,
      orgName: organizations.name,
      season: competitions.name,
      seasonSlug: competitions.slug,
      sport: competitions.sport,
    })
    .from(competitions)
    .innerJoin(organizations, eq(organizations.id, competitions.orgId))
    .where(eq(competitions.id, competitionId))
    .limit(1);
  return row === undefined
    ? null
    : { ...row, orgName: row.orgName.trim(), season: row.season.trim() };
}

/** "Your club is ready" — to the person who created it, once. */
export async function notifyClubCreated(
  db: Db,
  input: { orgId: string; orgName: string; orgSlug: string; personId: string },
  channels: OrganizerNoticeChannels = {},
): Promise<void> {
  const mails = await forEachOrganizer(
    db,
    [input.personId],
    { orgId: input.orgId, kind: "club.welcome", key: () => `club.welcome:${input.orgId}` },
    (name, language) =>
      clubWelcomeMail({ name, orgName: input.orgName, orgSlug: input.orgSlug }, language),
  );
  await deliver(mails, channels);
}

/**
 * "Your first registration is in" — when a season's FIRST registration has
 * just arrived. Counted, not assumed: a season already holding players (an
 * import, organizer adds) is not told a first it did not have. The key is per
 * season and person, so it can never be said twice.
 */
export async function notifyFirstRegistration(
  db: Db,
  input: { competitionId: string; playerPersonId: string },
  channels: OrganizerNoticeChannels = {},
): Promise<boolean> {
  const [row] = await db
    .select({ n: count() })
    .from(registrations)
    .where(
      and(eq(registrations.competitionId, input.competitionId), ne(registrations.status, "draft")),
    );
  if ((row?.n ?? 0) !== 1) {
    return false;
  }
  const season = await seasonOf(db, input.competitionId);
  if (season === null) {
    return false;
  }
  const playerName =
    (await namesOf(db, [input.playerPersonId])).get(input.playerPersonId) ?? "A player";
  const organizers = await organizersOf(db, season.orgId);
  const mails = await forEachOrganizer(
    db,
    organizers,
    {
      orgId: season.orgId,
      kind: "registration.first",
      key: (personId) => `registration.first:${input.competitionId}:${personId}`,
    },
    (name, language) => firstRegistrationMail({ ...season, name, playerName }, language),
  );
  await deliver(mails, channels);
  return true;
}

/**
 * DesiAuction held (or released) a season's public page. Every organizer is
 * told — by email and in their inbox — because the alternative is finding out
 * from a page that has gone blank. Nobody's switch stops it (catalogue).
 */
export async function notifySeasonHold(
  db: Db,
  input: { competitionId: string } & ({ held: true; reason: string } | { held: false }),
  channels: OrganizerNoticeChannels = {},
): Promise<void> {
  const season = await seasonOf(db, input.competitionId);
  if (season === null) {
    return;
  }
  const organizers = await organizersOf(db, season.orgId);
  const kind = input.held ? "season.held" : "season.released";
  // A season can be held, released and held again: each is its own moment.
  const moment = newId();
  const mails = await forEachOrganizer(
    db,
    organizers,
    {
      orgId: season.orgId,
      kind,
      key: (personId) => `${kind}:${input.competitionId}:${moment}:${personId}`,
    },
    (name, language) =>
      input.held
        ? seasonHeldMail({ ...season, name, reason: input.reason }, language)
        : seasonReleasedMail({ ...season, name }, language),
  );
  await deliver(mails, channels);
  for (const personId of organizers) {
    try {
      await logSecurityEvent(personId, kind, { competitionId: input.competitionId });
    } catch (error) {
      logger().warn({ err: error, kind }, "organizer_inbox.write_failed");
    }
  }
}

/**
 * A TEAM'S OWNER ACCEPTED (email programme PR7). Each organizer gets an inbox
 * row naming the team; and the acceptance that completes the set — every team
 * in the season now has an owner — also sends "every team has its owner",
 * once per auction, with who bids for whom.
 *
 * "Has an owner" is an accepted, unrevoked invitation or an active paddle
 * grant on this auction: the two ways the product makes somebody a team's
 * bidder. A season with fewer than two teams is never "ready".
 */
export async function notifyOwnerJoined(
  db: Db,
  input: { auctionId: string; teamName: string },
  channels: OrganizerNoticeChannels = {},
): Promise<{ ready: boolean }> {
  const [auction] = await db
    .select({ competitionId: auctions.competitionId, orgId: auctions.orgId })
    .from(auctions)
    .where(eq(auctions.id, input.auctionId))
    .limit(1);
  if (auction === undefined) {
    return { ready: false };
  }
  const organizers = await organizersOf(db, auction.orgId);
  for (const personId of organizers) {
    try {
      await logSecurityEvent(personId, "auction.owner_joined", {
        competitionId: auction.competitionId,
        team: input.teamName,
      });
    } catch (error) {
      logger().warn({ err: error }, "organizer_inbox.write_failed");
    }
  }
  const seasonTeams = await db
    .select({ id: teams.id, name: teams.name })
    .from(teams)
    .where(eq(teams.competitionId, auction.competitionId));
  const owned = [
    ...(await db
      .select({ teamId: auctionOwnerInvites.teamId, owner: people.name })
      .from(auctionOwnerInvites)
      .innerJoin(people, eq(people.id, auctionOwnerInvites.acceptedBy))
      .where(
        and(
          eq(auctionOwnerInvites.auctionId, input.auctionId),
          isNotNull(auctionOwnerInvites.acceptedBy),
          isNull(auctionOwnerInvites.revokedAt),
        ),
      )),
    ...(await db
      .select({ teamId: paddleGrants.teamId, owner: people.name })
      .from(paddleGrants)
      .innerJoin(people, eq(people.id, paddleGrants.personId))
      .where(and(eq(paddleGrants.auctionId, input.auctionId), isNull(paddleGrants.revokedAt)))),
  ];
  const ownerOf = new Map(owned.map((row) => [row.teamId, row.owner?.trim() || "—"]));
  const ready = seasonTeams.length >= 2 && seasonTeams.every((team) => ownerOf.has(team.id));
  if (!ready) {
    return { ready: false };
  }
  const season = await seasonOf(db, auction.competitionId);
  if (season === null) {
    return { ready: false };
  }
  const [timing] = await db
    .select({ at: competitions.auctionStartsAt })
    .from(competitions)
    .where(eq(competitions.id, auction.competitionId))
    .limit(1);
  const rows = seasonTeams
    .map((team) => [team.name, ownerOf.get(team.id) ?? "—"] as const)
    .sort((a, b) => a[0].localeCompare(b[0]));
  const roomUrl = `${env.PUBLIC_BASE_URL.replace(/\/$/, "")}/seasons/${encodeURIComponent(season.seasonSlug)}/auction`;
  const mails = await forEachOrganizer(
    db,
    organizers,
    {
      orgId: auction.orgId,
      kind: "auction.owners_ready",
      // Once per auction per organizer: an owner leaving and rejoining does
      // not make the club "ready" twice.
      key: (personId) => `auction.owners_ready:${input.auctionId}:${personId}`,
    },
    (name, language) =>
      ownersReadyMail(
        { ...season, name, owners: rows, roomUrl, auctionAt: timing?.at ?? null },
        language,
      ),
  );
  const fresh = await deliver(mails, channels);
  if (fresh.length > 0) {
    for (const personId of organizers) {
      try {
        await logSecurityEvent(personId, "auction.owners_ready", {
          competitionId: auction.competitionId,
        });
      } catch (error) {
        logger().warn({ err: error }, "organizer_inbox.write_failed");
      }
    }
  }
  return { ready: true };
}

/**
 * SOMEBODY USED A CLUB INVITE LINK (email programme PR13). Whoever minted the
 * link, and the club's owners, hear who now has access and what kind — by
 * email and in the inbox — because a link that reached the wrong person is
 * only ever noticed this way. Once per invitation (keyed by the invite).
 */
export async function notifyMemberJoined(
  db: Db,
  input: {
    inviteId: string;
    orgId: string;
    orgName: string;
    orgSlug: string;
    memberId: string;
    invitedBy: string;
    capabilitySet: string;
  },
  channels: OrganizerNoticeChannels = {},
): Promise<number> {
  const owners = await holdersOf(db, input.orgId, "org:owner");
  // Never the new member themselves — an owner invite makes them an owner.
  const told = [...new Set([input.invitedBy, ...owners])].filter((id) => id !== input.memberId);
  if (told.length === 0) {
    return 0;
  }
  const memberName = (await namesOf(db, [input.memberId])).get(input.memberId) ?? "Someone";
  const mails = await forEachOrganizer(
    db,
    told,
    {
      orgId: input.orgId,
      kind: "club.member_joined",
      key: (personId) => `club.member_joined:${input.inviteId}:${personId}`,
    },
    (name, language) =>
      memberJoinedMail(
        {
          name,
          orgName: input.orgName,
          orgSlug: input.orgSlug,
          memberName,
          capabilitySet: input.capabilitySet,
        },
        language,
      ),
  );
  const fresh = await deliver(mails, channels);
  if (fresh.length > 0) {
    for (const personId of told) {
      try {
        await logSecurityEvent(personId, "club.member_joined", { member: memberName });
      } catch (error) {
        logger().warn({ err: error }, "organizer_inbox.write_failed");
      }
    }
  }
  return fresh.length;
}

/**
 * A SEASON ASKED FOR A BIGGER PASS (email programme PR15). The organizer who
 * asked hears we have it — nothing changes and nothing is charged until a
 * person answers — and the support mailbox hears there is one to answer,
 * because until now a request sat on /admin/passes until somebody looked.
 */
export async function notifyPassRequested(
  db: Db,
  input: {
    competitionId: string;
    requestId: string;
    requestedBy: string;
    fromTier: Tier;
    requestedTier: Tier;
    note: string | null;
  },
  channels: OrganizerNoticeChannels = {},
): Promise<void> {
  const season = await seasonOf(db, input.competitionId);
  if (season === null) {
    return;
  }
  const mails = await forEachOrganizer(
    db,
    [input.requestedBy],
    {
      orgId: season.orgId,
      kind: "plan.requested",
      key: (personId) => `plan.requested:${input.requestId}:${personId}`,
    },
    (name, language) =>
      passRequestedMail(
        { ...season, name, fromTier: input.fromTier, requestedTier: input.requestedTier },
        language,
      ),
  );
  await deliver(mails, channels);
  const [requester] = await db
    .select({ name: people.name, email: people.email })
    .from(people)
    .where(eq(people.id, input.requestedBy))
    .limit(1);
  try {
    await sendNotificationMail(
      db,
      { kind: "staff.pass_request", to: SUPPORT_EMAIL },
      await staffPassRequestMail({
        season: season.season,
        orgName: season.orgName,
        fromTier: input.fromTier,
        requestedTier: input.requestedTier,
        requesterName: requester?.name?.trim() || "An organizer",
        requesterEmail: requester?.email ?? null,
        note: input.note,
      }),
      channels.mailer,
    );
  } catch (error) {
    logger().warn({ err: error }, "staff.pass_request_failed");
  }
}

/**
 * A PASS REQUEST WAS ANSWERED. Whoever asked, and the club's owners, hear it —
 * granted with what the season can hold now, or declined with the note — by
 * email and in the inbox. Once per request.
 */
export async function notifyPassAnswered(
  db: Db,
  input: {
    competitionId: string;
    requestId: string;
    requestedBy: string;
    outcome: "granted" | "declined";
    fromTier: Tier;
    passTier: Tier;
    note: string | null;
  },
  channels: OrganizerNoticeChannels = {},
): Promise<number> {
  const season = await seasonOf(db, input.competitionId);
  if (season === null) {
    return 0;
  }
  const owners = await holdersOf(db, season.orgId, "org:owner");
  const told = [...new Set([input.requestedBy, ...owners])];
  const mails = await forEachOrganizer(
    db,
    told,
    {
      orgId: season.orgId,
      kind: "plan.answered",
      key: (personId) => `plan.answered:${input.requestId}:${personId}`,
    },
    (name, language) =>
      passAnsweredMail(
        {
          ...season,
          name,
          outcome: input.outcome,
          fromTier: input.fromTier,
          passTier: input.passTier,
          note: input.note,
        },
        language,
      ),
  );
  const fresh = await deliver(mails, channels);
  if (fresh.length > 0) {
    for (const personId of told) {
      try {
        await logSecurityEvent(personId, "plan.answered", {
          competitionId: input.competitionId,
          outcome: input.outcome,
        });
      } catch (error) {
        logger().warn({ err: error }, "organizer_inbox.write_failed");
      }
    }
  }
  return fresh.length;
}
