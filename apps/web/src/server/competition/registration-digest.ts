import type { Db } from "@desiauction/db";
import { messageLanguagesOf } from "@desiauction/messaging/language";
import { sql } from "drizzle-orm";

import { db as appDb, systemDb } from "../db";
import { logger } from "../logger";
import { registrationDigestMail, type DigestSeason } from "../messaging/organizer-mail";
import { drainOutbox, enqueueMail, type QueuedMail } from "../messaging/outbox";
import type { TransactionalMailer } from "../messaging/transactional-mail";

/**
 * THE 9 AM DIGEST (email programme PR5) — "12 registrations waiting for your
 * review", once a morning, only on mornings something is waiting.
 *
 * ONE MAIL PER ORGANIZER, NOT PER REGISTRATION. A popular season fills a
 * hundred rows in a day; a mail each would be a hundred mails, and the first
 * registration already has its own moment (organizer-notify.ts). One mail per
 * person also covers every season they review, across clubs.
 *
 * WHEN. The feedback job runs every fifteen minutes (ops scheduler). The sweep
 * sends only between 9:00 and noon IST — a job that was down at nine catches
 * up at 9:15, never at midnight — and the outbox key carries the IST date, so a
 * person is written to at most once a day however often the job runs.
 *
 * WHO. Owners and staff with a live grant AND membership, for every season
 * with registrations in `submitted`. Read across clubs on the system pool
 * (posture allowlist), queued and drained on the app pool like every mail.
 */

const IST_OFFSET_MS = 330 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
export const DIGEST_FROM_HOUR_IST = 9;
export const DIGEST_UNTIL_HOUR_IST = 12;

/** "2026-09-28" and the hour, in IST. */
export function istClock(now: Date): { date: string; hour: number } {
  const shifted = new Date(now.getTime() + IST_OFFSET_MS);
  return { date: shifted.toISOString().slice(0, 10), hour: shifted.getUTCHours() };
}

interface PendingRow extends Record<string, unknown> {
  person_id: string;
  org_id: string;
  org_name: string;
  season: string;
  slug: string;
  waiting: number | string;
  oldest: Date | string;
}

/** Every organizer's seasons with registrations waiting, one row per (person, season). */
async function pendingByOrganizer(db: Db): Promise<PendingRow[]> {
  return db.execute<PendingRow>(sql`
    with pending as (
      select r.competition_id, count(*) as waiting, min(r.created_at) as oldest
      from registrations r
      where r.status = 'submitted'
      group by r.competition_id
    )
    select distinct g.person_id, c.org_id, o.name as org_name, c.name as season, c.slug,
      p.waiting, p.oldest
    from pending p
    join competitions c on c.id = p.competition_id
    join organizations o on o.id = c.org_id
    join grants g on g.scope_type = 'org' and g.scope_id = c.org_id
      and g.capability_set in ('org:owner', 'org:staff') and g.revoked_at is null
    join org_members m on m.org_id = c.org_id and m.person_id = g.person_id
    order by g.person_id, c.name
  `);
}

export interface DigestResult {
  readonly skipped?: "outside_window";
  readonly organizers: number;
  readonly queued: number;
}

export async function sweepRegistrationDigests(
  options: {
    now?: Date;
    /** Cross-club reads; the system pool in production. */
    readDb?: Db;
    /** The queue's pool; the app pool when omitted. */
    outboxDb?: Db;
    mailer?: TransactionalMailer;
    /** Only these people — a test's own, in a shared database. */
    personIds?: readonly string[];
  } = {},
): Promise<DigestResult> {
  const now = options.now ?? new Date();
  const { date, hour } = istClock(now);
  if (hour < DIGEST_FROM_HOUR_IST || hour >= DIGEST_UNTIL_HOUR_IST) {
    return { skipped: "outside_window", organizers: 0, queued: 0 };
  }
  const rows = (await pendingByOrganizer(options.readDb ?? systemDb)).filter(
    (row) => options.personIds === undefined || options.personIds.includes(row.person_id.trim()),
  );
  const byPerson = new Map<string, { orgId: string; seasons: DigestSeason[] }>();
  for (const row of rows) {
    const personId = row.person_id.trim();
    const entry = byPerson.get(personId) ?? { orgId: row.org_id.trim(), seasons: [] };
    entry.seasons.push({
      season: row.season.trim(),
      orgName: row.org_name.trim(),
      seasonSlug: row.slug,
      waiting: Number(row.waiting),
      oldestDays: Math.max(
        0,
        Math.floor((now.getTime() - new Date(row.oldest).getTime()) / DAY_MS),
      ),
    });
    byPerson.set(personId, entry);
  }
  if (byPerson.size === 0) {
    return { organizers: 0, queued: 0 };
  }
  const outboxDb = options.outboxDb ?? appDb;
  const personIds = [...byPerson.keys()];
  const [languages, names] = await Promise.all([
    messageLanguagesOf(outboxDb, personIds),
    namesOf(outboxDb, personIds),
  ]);
  const mails: QueuedMail[] = [];
  for (const [personId, entry] of byPerson) {
    try {
      mails.push({
        ...(await registrationDigestMail(
          { name: names.get(personId) ?? "there", seasons: entry.seasons },
          languages.get(personId) ?? "en",
        )),
        personId,
        // A person can review for several clubs; the row names the first. The
        // club's own switch does not apply to this kind (catalogue).
        orgId: entry.orgId,
        kind: "registration.digest",
        dedupeKey: `registration.digest:${personId}:${date}`,
      });
    } catch (error) {
      logger().error({ err: error }, "registration_digest.render_failed");
    }
  }
  // Only keys new today are delivered: a second run this morning finds none.
  const fresh = await enqueueMail(mails, outboxDb);
  if (fresh.length > 0) {
    await drainOutbox({
      db: outboxDb,
      dedupeKeys: fresh,
      limit: fresh.length,
      ...(options.mailer === undefined ? {} : { mailer: options.mailer }),
    });
  }
  return { organizers: byPerson.size, queued: fresh.length };
}

async function namesOf(db: Db, personIds: readonly string[]): Promise<Map<string, string>> {
  const rows = await db.execute<{ id: string; name: string | null } & Record<string, unknown>>(sql`
    select id, name from people where id in (${sql.join(
      personIds.map((id) => sql`${id}`),
      sql`, `,
    )})
  `);
  return new Map(rows.map((row) => [row.id.trim(), row.name?.trim() || "there"]));
}
