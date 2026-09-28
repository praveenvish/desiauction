import {
  auctions,
  auditLog,
  competitions,
  consentRecords,
  createDb,
  grants,
  messageOutbox,
  newId,
  organizations,
  orgMembers,
  paddleGrants,
  people,
  registrations,
  teams,
  type DbHandle,
} from "@desiauction/db";
import { and, eq, inArray, like } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { env } from "../../env";
import { createOrg } from "../orgs/orgs";
import { purgeOrg } from "../test-support/purge-org";
import { sweepAuctionReminders } from "./auction-reminders";
import { createCompetition } from "./competitions";

/**
 * AUCTION NIGHT REMINDERS (email programme PR8), against a real database: the
 * day before by email, half an hour before in the inbox — each once, and not
 * the day before when the time was only just announced.
 */

const handle: DbHandle = createDb(env.DATABASE_URL);
const db = handle.db;
const RUN = String(Date.now()).slice(-7);

const organizer = newId();
const owner = newId();
const player = newId();
const auctionId = newId();
const teamId = newId();
let org = { id: "", name: "", slug: "" };
let seasonId = "";

const AT = new Date("2031-10-04T14:30:00Z");
const HOUR = 60 * 60 * 1000;
const sweep = (now: Date) =>
  sweepAuctionReminders({ now, readDb: db, outboxDb: db, competitionIds: [seasonId] });

async function timeChangedAt(at: Date): Promise<void> {
  await db.insert(auditLog).values({
    id: newId(),
    actor: organizer,
    action: "competition.auction_time_set",
    scopeType: "org",
    scopeId: org.id,
    subject: seasonId,
    at,
    meta: {},
  });
}

beforeAll(async () => {
  await db.insert(people).values([
    {
      id: organizer,
      phone: `+9183${RUN}1`,
      name: "Priya Organizer",
      email: `remind-${RUN}@example.test`,
      emailVerifiedAt: new Date(),
    },
    { id: owner, phone: `+9183${RUN}2`, name: "Rahul Owner" },
    { id: player, phone: `+9183${RUN}3`, name: "Arjun Player" },
  ]);
  org = await createOrg(db, organizer, `Reminder Club ${RUN}`);
  const season = await createCompetition(db, org.id, organizer, {
    sport: "cricket",
    name: `Reminder League ${RUN}`,
    location: "Malad",
    startsOn: "2031-10-01",
    endsOn: "2031-10-30",
  });
  seasonId = season.id;
  await db.update(competitions).set({ auctionStartsAt: AT }).where(eq(competitions.id, seasonId));
  await db.insert(teams).values([
    { id: teamId, orgId: org.id, competitionId: seasonId, name: "Cup Kings", createdBy: organizer },
    { id: newId(), orgId: org.id, competitionId: seasonId, name: "Tigers", createdBy: organizer },
  ]);
  await db.insert(auctions).values({
    id: auctionId,
    orgId: org.id,
    competitionId: seasonId,
    name: "Reminder Auction",
    config: {},
    createdBy: organizer,
  });
  await db.insert(paddleGrants).values({
    id: newId(),
    orgId: org.id,
    auctionId,
    teamId,
    personId: owner,
    grantedBy: organizer,
  });
  await db.insert(registrations).values({
    id: newId(),
    orgId: org.id,
    competitionId: seasonId,
    personId: player,
    role: "batter",
    status: "approved",
  });
  // Announced well before the day: the day-before reminder is due.
  await timeChangedAt(new Date(AT.getTime() - 72 * HOUR));
});

afterAll(async () => {
  const ids = [organizer, owner, player];
  await db.delete(messageOutbox).where(inArray(messageOutbox.personId, ids));
  await db.delete(paddleGrants).where(eq(paddleGrants.orgId, org.id));
  await db.delete(auctions).where(eq(auctions.orgId, org.id));
  await db.delete(registrations).where(eq(registrations.orgId, org.id));
  await db.delete(teams).where(eq(teams.orgId, org.id));
  await purgeOrg(db, org.id);
  await db.delete(competitions).where(eq(competitions.orgId, org.id));
  await db.delete(grants).where(eq(grants.scopeId, org.id));
  await db.delete(orgMembers).where(eq(orgMembers.orgId, org.id));
  await db.delete(auditLog).where(eq(auditLog.scopeId, org.id));
  await db.delete(organizations).where(eq(organizations.id, org.id));
  await db.delete(auditLog).where(inArray(auditLog.scopeId, ids));
  await db.delete(auditLog).where(inArray(auditLog.actor, ids));
  await db.delete(consentRecords).where(inArray(consentRecords.personId, ids));
  await db.delete(people).where(inArray(people.id, ids));
  await handle.sql.end();
});

describe("the day before", () => {
  it("waits until 24 hours before", async () => {
    expect(await sweep(new Date(AT.getTime() - 30 * HOUR))).toEqual({
      dayBefore: 0,
      startingSoon: 0,
    });
  });

  it("queues one for the organizer, the owner and the player — once", async () => {
    expect((await sweep(new Date(AT.getTime() - 20 * HOUR))).dayBefore).toBe(3);
    expect((await sweep(new Date(AT.getTime() - 19 * HOUR))).dayBefore).toBe(0);
    const rows = await db
      .select({ person: messageOutbox.personId, subject: messageOutbox.subject })
      .from(messageOutbox)
      .where(like(messageOutbox.dedupeKey, `auction.reminder:${seasonId}:%`));
    const subjectOf = (id: string) => rows.find((row) => row.person === id)?.subject;
    expect(subjectOf(organizer)).toBe(`Tomorrow: is the Reminder League ${RUN} auction ready?`);
    expect(subjectOf(owner)).toContain("Tomorrow: the Reminder League");
    expect(subjectOf(player)).toContain("Tomorrow: the Reminder League");
  });

  it("is not sent when the time was only just announced", async () => {
    await db
      .delete(messageOutbox)
      .where(like(messageOutbox.dedupeKey, `auction.reminder:${seasonId}:%`));
    await timeChangedAt(new Date(AT.getTime() - 10 * HOUR));
    expect((await sweep(new Date(AT.getTime() - 8 * HOUR))).dayBefore).toBe(0);
  });
});

describe("half an hour before", () => {
  it("puts one row in everybody's inbox — once", async () => {
    expect((await sweep(new Date(AT.getTime() - 20 * 60 * 1000))).startingSoon).toBe(3);
    expect((await sweep(new Date(AT.getTime() - 15 * 60 * 1000))).startingSoon).toBe(0);
    const rows = await db
      .select({ scope: auditLog.scopeId })
      .from(auditLog)
      .where(
        and(
          eq(auditLog.action, "auction.starting_soon"),
          inArray(auditLog.scopeId, [organizer, owner, player]),
        ),
      );
    expect(rows).toHaveLength(3);
  });
});
