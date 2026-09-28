import {
  auditLog,
  competitions,
  consentRecords,
  createDb,
  grants,
  messageOutbox,
  newId,
  organizations,
  orgMembers,
  people,
  registrations,
  type DbHandle,
} from "@desiauction/db";
import { and, eq, inArray, like } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { env } from "../../env";
import { createCompetition } from "../competition/competitions";
import { sweepRegistrationDigests } from "../competition/registration-digest";
import type { OutgoingMail, TransactionalMailer } from "../messaging/transactional-mail";
import { purgeOrg } from "../test-support/purge-org";
import { createOrg } from "./orgs";
import { notifyClubCreated, notifyFirstRegistration, notifySeasonHold } from "./organizer-notify";

/**
 * WHAT DESIAUCTION TELLS AN ORGANIZER (email programme PR5), against a real
 * database: the welcome, the first registration, a moderation hold and the
 * 9 am digest — each to the right people, once.
 */

const handle: DbHandle = createDb(env.DATABASE_URL);
const db = handle.db;
const RUN = String(Date.now()).slice(-7);

const organizer = newId();
const player = newId();
const secondPlayer = newId();
let org = { id: "", name: "", slug: "" };
let season = { id: "", slug: "" };

function recording(): { mailer: TransactionalMailer; sent: OutgoingMail[] } {
  const sent: OutgoingMail[] = [];
  return {
    sent,
    mailer: {
      send: () => Promise.resolve("sent"),
      deliver: (mail) => {
        sent.push(mail);
        return Promise.resolve({ outcome: "sent", providerMessageId: null });
      },
    },
  };
}

beforeAll(async () => {
  await db.insert(people).values([
    {
      id: organizer,
      phone: `+9186${RUN}1`,
      name: "Priya Organizer",
      email: `org-${RUN}@example.test`,
      emailVerifiedAt: new Date(),
    },
    { id: player, phone: `+9186${RUN}2`, name: "Rohit Nair" },
    { id: secondPlayer, phone: `+9186${RUN}3`, name: "Second Player" },
  ]);
  org = await createOrg(db, organizer, `Digest Club ${RUN}`);
  const created = await createCompetition(db, org.id, organizer, {
    sport: "cricket",
    name: `Digest League ${RUN}`,
    location: "Malad",
    startsOn: "2026-10-01",
    endsOn: "2026-10-30",
  });
  season = { id: created.id, slug: created.slug };
});

afterAll(async () => {
  await db.delete(messageOutbox).where(inArray(messageOutbox.personId, [organizer]));
  await db.delete(registrations).where(eq(registrations.orgId, org.id));
  await purgeOrg(db, org.id);
  await db.delete(competitions).where(eq(competitions.orgId, org.id));
  await db.delete(grants).where(eq(grants.scopeId, org.id));
  await db.delete(orgMembers).where(eq(orgMembers.orgId, org.id));
  await db.delete(auditLog).where(eq(auditLog.scopeId, org.id));
  await db.delete(organizations).where(eq(organizations.id, org.id));
  const ids = [organizer, player, secondPlayer];
  await db.delete(auditLog).where(inArray(auditLog.actor, ids));
  await db.delete(auditLog).where(inArray(auditLog.scopeId, ids));
  await db.delete(consentRecords).where(inArray(consentRecords.personId, ids));
  await db.delete(people).where(inArray(people.id, ids));
  await handle.sql.end();
});

describe("the club welcome", () => {
  it("goes to the creator, once", async () => {
    const { mailer, sent } = recording();
    const input = { orgId: org.id, orgName: org.name, orgSlug: org.slug, personId: organizer };
    await notifyClubCreated(db, input, { outboxDb: db, mailer });
    await notifyClubCreated(db, input, { outboxDb: db, mailer });
    expect(sent).toHaveLength(1);
    expect(sent[0]?.to).toBe(`org-${RUN}@example.test`);
    expect(sent[0]?.subject).toBe(`${org.name} is ready on DesiAuction`);
  });
});

describe("the first registration", () => {
  it("is said only when the season really has exactly one", async () => {
    const { mailer, sent } = recording();
    expect(
      await notifyFirstRegistration(
        db,
        { competitionId: season.id, playerPersonId: player },
        { outboxDb: db, mailer },
      ),
    ).toBe(false);
    await db.insert(registrations).values({
      id: newId(),
      orgId: org.id,
      competitionId: season.id,
      personId: player,
      role: "batter",
    });
    expect(
      await notifyFirstRegistration(
        db,
        { competitionId: season.id, playerPersonId: player },
        { outboxDb: db, mailer },
      ),
    ).toBe(true);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.subject).toBe(
      `First player in: Rohit Nair registered for Digest League ${RUN}`,
    );
    expect(sent[0]?.text).toContain(`/seasons/${season.slug}/registrations?status=submitted`);
    await db.insert(registrations).values({
      id: newId(),
      orgId: org.id,
      competitionId: season.id,
      personId: secondPlayer,
      role: "bowler",
    });
    expect(
      await notifyFirstRegistration(
        db,
        { competitionId: season.id, playerPersonId: secondPlayer },
        { outboxDb: db, mailer },
      ),
    ).toBe(false);
    expect(sent).toHaveLength(1);
  });
});

describe("the 9 am digest", () => {
  const at = (iso: string) => ({
    now: new Date(iso),
    readDb: db,
    outboxDb: db,
    personIds: [organizer],
  });

  it("waits for nine o'clock IST", async () => {
    const { mailer, sent } = recording();
    const result = await sweepRegistrationDigests({ ...at("2026-09-28T02:00:00Z"), mailer });
    expect(result.skipped).toBe("outside_window");
    expect(sent).toHaveLength(0);
  });

  it("sends one mail a day, counting every waiting registration", async () => {
    const { mailer, sent } = recording();
    // 10:00 am IST
    const first = await sweepRegistrationDigests({ ...at("2026-09-28T04:30:00Z"), mailer });
    expect(first.queued).toBe(1);
    expect(sent[0]?.subject).toBe("2 registrations waiting for your review");
    expect(sent[0]?.text).toContain(`Digest League ${RUN}: 2 waiting`);
    // 10:15 — the job's next run the same morning: nothing new.
    const again = await sweepRegistrationDigests({ ...at("2026-09-28T04:45:00Z"), mailer });
    expect(again.queued).toBe(0);
    expect(sent).toHaveLength(1);
    const rows = await db
      .select({ key: messageOutbox.dedupeKey })
      .from(messageOutbox)
      .where(like(messageOutbox.dedupeKey, `registration.digest:${organizer}:%`));
    expect(rows.map((row) => row.key)).toEqual([`registration.digest:${organizer}:2026-09-28`]);
  });
});

describe("a moderation hold", () => {
  it("tells every organizer by email and in their inbox", async () => {
    const { mailer, sent } = recording();
    await notifySeasonHold(
      db,
      { competitionId: season.id, held: true, reason: "the page used another club's logo" },
      { outboxDb: db, mailer },
    );
    expect(sent).toHaveLength(1);
    expect(sent[0]?.text).toContain("The reason: the page used another club's logo");
    // No switch stops it, so no unsubscribe is offered.
    expect(sent[0]?.headers).toBeUndefined();
    const inbox = await db
      .select({ action: auditLog.action })
      .from(auditLog)
      .where(and(eq(auditLog.scopeId, organizer), eq(auditLog.action, "season.held")));
    expect(inbox).toHaveLength(1);
  });
});
