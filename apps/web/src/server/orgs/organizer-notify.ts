import {
  competitions,
  newId,
  organizations,
  people,
  registrations,
  type Db,
} from "@desiauction/db";
import { messageLanguagesOf } from "@desiauction/messaging/language";
import { and, count, eq, inArray, ne } from "drizzle-orm";

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
