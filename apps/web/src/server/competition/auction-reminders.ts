import { isRealAuction } from "@desiauction/auction";
import { auctions, auditLog, teams, type Db } from "@desiauction/db";
import { messageLanguagesOf } from "@desiauction/messaging/language";
import { and, count, eq, like, max, ne, sql } from "drizzle-orm";

import { env } from "../../env";
import { logSecurityEvent } from "../auth/security-events";
import { db as appDb, systemDb } from "../db";
import { logger } from "../logger";
import { auctionReminderMail, type Readiness } from "../messaging/auction-reminder-mail";
import { enqueueMail, type QueuedMail } from "../messaging/outbox";
import { organizersOf } from "../orgs/organizer-notify";
import { auctionPeopleOf } from "./auction-schedule-notify";

/**
 * AUCTION NIGHT REMINDERS (email programme PR8), swept every two minutes by
 * the messages job, which then drains what this queued.
 *
 *   · THE DAY BEFORE, by email: owners (their team, their paddle), pool
 *     players (when, where to watch) and organizers (is the room ready?).
 *     From 24 hours before until 3 hours before — a job that was down catches
 *     up, but "your auction is tomorrow" is never sent the same evening.
 *     SKIPPED when the time was set or moved inside those 24 hours: those
 *     people were just told the time (auction-schedule-notify), and a second
 *     mail minutes later is noise.
 *   · HALF AN HOUR BEFORE, in the inbox — the same people. From 35 minutes
 *     before until the start. (WhatsApp and push join when they exist.)
 *
 * BUILT WHEN DUE, not queued when the time was set: a player approved on the
 * last day is reminded, and the organizer's readiness is that day's truth.
 * Once per auction TIME per person — the email by its outbox key, the inbox
 * row by looking for it first — so a moved auction is reminded afresh.
 *
 * Cross-club reads on the system pool (posture allowlist); mail queued on the
 * app pool; inbox rows through the person's own ledger.
 */

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
export const DAY_BEFORE_FROM = 24 * HOUR;
export const DAY_BEFORE_UNTIL = 3 * HOUR;
export const SOON_FROM = 35 * MINUTE;

const BASE = (): string => env.PUBLIC_BASE_URL.replace(/\/$/, "");

interface DueSeason extends Record<string, unknown> {
  id: string;
  org_id: string;
  org_name: string;
  name: string;
  slug: string;
  sport: string;
  visibility: string;
  at: Date | string;
}

async function seasonsStartingWithinADay(db: Db, now: Date): Promise<DueSeason[]> {
  return db.execute<DueSeason>(sql`
    select c.id, c.org_id, o.name as org_name, c.name, c.slug, c.sport, c.visibility,
      c.auction_starts_at as at
    from competitions c
    join organizations o on o.id = c.org_id
    where c.auction_starts_at > ${now.toISOString()}::timestamptz
      and c.auction_starts_at <= ${new Date(now.getTime() + DAY_BEFORE_FROM).toISOString()}::timestamptz
      and not exists (
        select 1 from auctions a
        where a.competition_id = c.id and a.kind = 'real'
          and a.status in ('live', 'paused', 'completed', 'reconciled')
      )
  `);
}

/** When the time was last set or moved — a notice then makes "tomorrow" redundant. */
async function lastTimeChange(db: Db, competitionId: string): Promise<Date | null> {
  const [row] = await db
    .select({ at: max(auditLog.at) })
    .from(auditLog)
    .where(
      and(eq(auditLog.subject, competitionId), like(auditLog.action, "competition.auction_time_%")),
    );
  return row?.at ?? null;
}

async function readinessOf(db: Db, competitionId: string): Promise<Readiness> {
  const [teamCount] = await db
    .select({ n: count() })
    .from(teams)
    .where(eq(teams.competitionId, competitionId));
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
  const people = await auctionPeopleOf(db, competitionId);
  const owners = people.filter((person) => person.teamName !== null);
  const owned = new Set(owners.map((owner) => owner.teamName)).size;
  const paddles = new Set(owners.filter((o) => o.hasPaddle).map((owner) => owner.teamName)).size;
  return {
    auctionCreated: auction !== undefined,
    teams: teamCount?.n ?? 0,
    owned,
    paddles,
    pool: people.length - owners.length,
  };
}

export interface ReminderResult {
  readonly dayBefore: number;
  readonly startingSoon: number;
}

export async function sweepAuctionReminders(
  options: {
    now?: Date;
    readDb?: Db;
    outboxDb?: Db;
    /** Only these seasons — a test's own, in a shared database. */
    competitionIds?: readonly string[];
  } = {},
): Promise<ReminderResult> {
  const now = options.now ?? new Date();
  const readDb = options.readDb ?? systemDb;
  const outboxDb = options.outboxDb ?? appDb;
  const seasons = (await seasonsStartingWithinADay(readDb, now)).filter(
    (season) =>
      options.competitionIds === undefined || options.competitionIds.includes(season.id.trim()),
  );
  let dayBefore = 0;
  let startingSoon = 0;
  for (const season of seasons) {
    try {
      const at = new Date(season.at);
      const until = at.getTime() - now.getTime();
      const facts = {
        season: season.name.trim(),
        orgName: season.org_name.trim(),
        seasonSlug: season.slug,
        sport: season.sport,
      };
      const competitionId = season.id.trim();
      if (until <= DAY_BEFORE_FROM && until > DAY_BEFORE_UNTIL) {
        const changed = await lastTimeChange(readDb, competitionId);
        const toldAlready = changed !== null && changed.getTime() > at.getTime() - DAY_BEFORE_FROM;
        if (!toldAlready) {
          dayBefore += await queueDayBefore(readDb, outboxDb, {
            competitionId,
            orgId: season.org_id.trim(),
            at,
            facts,
            isPublic: season.visibility === "public",
          });
        }
      }
      if (until <= SOON_FROM) {
        startingSoon += await writeStartingSoon(readDb, {
          competitionId,
          orgId: season.org_id.trim(),
          at,
        });
      }
    } catch (error) {
      logger().error({ err: error, competitionId: season.id }, "auction_reminders.season_failed");
    }
  }
  return { dayBefore, startingSoon };
}

async function queueDayBefore(
  readDb: Db,
  outboxDb: Db,
  input: {
    competitionId: string;
    orgId: string;
    at: Date;
    facts: { season: string; orgName: string; seasonSlug: string; sport: string };
    isPublic: boolean;
  },
): Promise<number> {
  const slug = encodeURIComponent(input.facts.seasonSlug);
  const [people, organizers, readiness] = await Promise.all([
    auctionPeopleOf(readDb, input.competitionId),
    organizersOf(readDb, input.orgId),
    readinessOf(readDb, input.competitionId),
  ]);
  const everyone = [...new Set([...organizers, ...people.map((person) => person.personId)])];
  const [languages, names] = await Promise.all([
    messageLanguagesOf(readDb, everyone),
    namesOf(readDb, everyone),
  ]);
  const key = (personId: string) =>
    `auction.reminder:${input.competitionId}:${input.at.toISOString()}:${personId}`;
  const base = { ...input.facts, at: input.at };
  const mails: QueuedMail[] = [];
  const seen = new Set<string>();
  // Organizers first: somebody who runs the season and owns a team is told
  // as the one who runs it.
  for (const personId of organizers) {
    seen.add(personId);
    mails.push({
      ...(await auctionReminderMail(
        {
          ...base,
          name: names.get(personId) ?? "there",
          url: `${BASE()}/seasons/${slug}/auction`,
          role: "organizer",
          readiness,
        },
        languages.get(personId) ?? "en",
      )),
      personId,
      orgId: input.orgId,
      kind: "auction.reminder",
      dedupeKey: key(personId),
    });
  }
  for (const person of people) {
    if (seen.has(person.personId)) continue;
    mails.push({
      ...(await auctionReminderMail(
        person.teamName === null
          ? {
              ...base,
              name: person.name,
              // A published season is watchable by anybody; otherwise the
              // player's own page (the room is for members).
              url: input.isPublic
                ? `${BASE()}/seasons/${slug}/auction/spectate`
                : `${BASE()}/seasons/${slug}/register`,
              role: "player",
            }
          : {
              ...base,
              name: person.name,
              url: `${BASE()}/seasons/${slug}/auction`,
              role: "owner",
              teamName: person.teamName,
              hasPaddle: person.hasPaddle,
            },
        languages.get(person.personId) ?? "en",
      )),
      personId: person.personId,
      orgId: input.orgId,
      kind: "auction.reminder",
      dedupeKey: key(person.personId),
    });
  }
  return (await enqueueMail(mails, outboxDb)).length;
}

async function writeStartingSoon(
  readDb: Db,
  input: { competitionId: string; orgId: string; at: Date },
): Promise<number> {
  const [people, organizers] = await Promise.all([
    auctionPeopleOf(readDb, input.competitionId),
    organizersOf(readDb, input.orgId),
  ]);
  const everyone = [...new Set([...organizers, ...people.map((person) => person.personId)])];
  const at = input.at.toISOString();
  let written = 0;
  for (const personId of everyone) {
    const [already] = await readDb
      .select({ id: auditLog.id })
      .from(auditLog)
      .where(
        and(
          eq(auditLog.scopeType, "person"),
          eq(auditLog.scopeId, personId),
          eq(auditLog.action, "auction.starting_soon"),
          sql`${auditLog.meta}->>'at' = ${at}`,
        ),
      )
      .limit(1);
    if (already !== undefined) continue;
    await logSecurityEvent(personId, "auction.starting_soon", {
      competitionId: input.competitionId,
      at,
    });
    written += 1;
  }
  return written;
}

async function namesOf(db: Db, personIds: readonly string[]): Promise<Map<string, string>> {
  if (personIds.length === 0) return new Map();
  const rows = await db.execute<{ id: string; name: string | null } & Record<string, unknown>>(sql`
    select id, name from people where id in (${sql.join(
      personIds.map((id) => sql`${id}`),
      sql`, `,
    )})
  `);
  return new Map(rows.map((row) => [row.id.trim(), row.name?.trim() || "there"]));
}
