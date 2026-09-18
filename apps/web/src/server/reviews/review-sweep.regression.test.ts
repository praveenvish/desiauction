import {
  auctionEvents,
  auctions,
  competitions,
  createDb,
  fixtures,
  grants,
  newId,
  notificationPreferences,
  organizations,
  paddles,
  people,
  playerProfiles,
  reviewRequests,
  teams,
  type DbHandle,
} from "@desiauction/db";
import { eq, inArray, like } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { env } from "../../env";
import { setTransactionalMailerForTest, type OutgoingMail } from "../messaging/transactional-mail";
import { sweepReviewAsks } from "./review-sweep";

/**
 * FR-1 Phase 3 — who the automatic sweep asks, and when — against Postgres.
 *
 * ISOLATED BY TIME, NOT BY A TEST HOOK. The sweep reads every tenant, and the
 * local database is full of real auctions. So every fixture here happened in
 * January 2020 and the sweep runs with a January 2020 clock: its fourteen-day
 * window cannot reach anything real, and nothing real can leak into these
 * assertions. (Local runs connect as a superuser, which is why plain inserts
 * into RLS-forced tenant tables work here.)
 */

const handle: DbHandle = createDb(env.DATABASE_URL);
const db = handle.db;

const MARK = "FR1P3-REGRESSION";
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const CLOSED_AT = new Date("2020-01-10T10:00:00.000Z");
const SWEEP_AT = new Date(CLOSED_AT.getTime() + 3 * HOUR);

const sent: OutgoingMail[] = [];
const orgIds: string[] = [];
const personIds: string[] = [];

async function person(opts: { email?: boolean; dateOfBirth?: string } = {}): Promise<string> {
  const id = newId();
  await db.insert(people).values({
    id,
    name: `${MARK} ${id.slice(-4)}`,
    email: opts.email === false ? null : `fr1p3-${id.toLowerCase()}@example.test`,
    phone: opts.email === false ? `+9198${id.slice(-8).replace(/\D/g, "7").padEnd(8, "7")}` : null,
  });
  if (opts.dateOfBirth !== undefined) {
    await db
      .insert(playerProfiles)
      .values({ id: newId(), personId: id, dateOfBirth: opts.dateOfBirth });
  }
  personIds.push(id);
  return id;
}

async function org(creator: string): Promise<{ orgId: string; competitionId: string }> {
  const orgId = newId();
  const competitionId = newId();
  await db.insert(organizations).values({
    id: orgId,
    name: `${MARK} Club`,
    slug: `fr1p3-${orgId.toLowerCase()}`,
    createdBy: creator,
  });
  await db.insert(competitions).values({
    id: competitionId,
    orgId,
    sport: "cricket",
    name: `${MARK} Season`,
    slug: `fr1p3-s-${competitionId.toLowerCase()}`,
    createdBy: creator,
  });
  orgIds.push(orgId);
  return { orgId, competitionId };
}

async function grant(orgId: string, personId: string, set: string, revoked = false): Promise<void> {
  await db.insert(grants).values({
    id: newId(),
    personId,
    scopeType: "org",
    scopeId: orgId,
    capabilitySet: set,
    grantedBy: personId,
    ...(revoked ? { revokedAt: CLOSED_AT } : {}),
  });
}

async function auction(
  where: { orgId: string; competitionId: string },
  creator: string,
  opts: { closedAt?: Date | null; status?: "completed" | "live" } = {},
): Promise<string> {
  const auctionId = newId();
  await db.insert(auctions).values({
    id: auctionId,
    orgId: where.orgId,
    competitionId: where.competitionId,
    name: `${MARK} Auction`,
    status: opts.status ?? "completed",
    config: {},
    createdBy: creator,
  });
  const closedAt = opts.closedAt === undefined ? CLOSED_AT : opts.closedAt;
  if (closedAt !== null) {
    await db.insert(auctionEvents).values({
      id: newId(),
      orgId: where.orgId,
      auctionId,
      seq: 1,
      type: "AuctionClosed",
      atMs: closedAt.getTime(),
      actor: creator,
      correlationId: newId(),
      payload: {},
      createdAt: closedAt,
    });
  }
  return auctionId;
}

async function paddle(orgId: string, auctionId: string, personId: string): Promise<void> {
  const [row] = await db
    .select({ competitionId: auctions.competitionId })
    .from(auctions)
    .where(eq(auctions.id, auctionId));
  const teamId = newId();
  await db.insert(teams).values({
    id: teamId,
    orgId,
    competitionId: row?.competitionId ?? "",
    name: `${MARK} Team ${teamId.slice(-4)}`,
    createdBy: personId,
  });
  await db.insert(paddles).values({
    id: newId(),
    orgId,
    auctionId,
    teamId,
    personId,
    paddleNumber: newId().slice(-6),
  });
}

async function fixture(
  where: { orgId: string; competitionId: string },
  creator: string,
  seq: number,
  status: "completed" | "cancelled" | "scheduled",
  at: Date,
): Promise<void> {
  await db.insert(fixtures).values({
    id: newId(),
    orgId: where.orgId,
    competitionId: where.competitionId,
    fixtureNumber: `M${String(seq)}`,
    seq,
    status,
    createdBy: creator,
    ...(status === "completed" ? { completedAt: at } : {}),
    ...(status === "cancelled" ? { cancelledAt: at } : {}),
  });
}

async function askOf(personId: string) {
  const [row] = await db.select().from(reviewRequests).where(eq(reviewRequests.personId, personId));
  return row;
}

function mailTo(personId: string): OutgoingMail | undefined {
  return sent.find((mail) => mail.to === `fr1p3-${personId.toLowerCase()}@example.test`);
}

async function cleanup(): Promise<void> {
  const stale = await db
    .select({ id: organizations.id })
    .from(organizations)
    .where(like(organizations.name, `${MARK}%`));
  const ids = [...new Set([...orgIds, ...stale.map((row) => row.id)])];
  if (ids.length > 0) {
    await db.delete(paddles).where(inArray(paddles.orgId, ids));
    await db.delete(teams).where(inArray(teams.orgId, ids));
    await db.delete(auctionEvents).where(inArray(auctionEvents.orgId, ids));
    await db.delete(auctions).where(inArray(auctions.orgId, ids));
    await db.delete(fixtures).where(inArray(fixtures.orgId, ids));
    await db.delete(grants).where(inArray(grants.scopeId, ids));
    await db.delete(competitions).where(inArray(competitions.orgId, ids));
    await db.delete(organizations).where(inArray(organizations.id, ids));
  }
  await db.delete(people).where(like(people.name, `${MARK}%`));
}

beforeAll(async () => {
  await cleanup();
  setTransactionalMailerForTest({
    send: (mail: OutgoingMail) => {
      sent.push(mail);
      return Promise.resolve("sent");
    },
  });
});

afterAll(async () => {
  setTransactionalMailerForTest(null);
  await cleanup();
  await handle.sql.end({ timeout: 5 });
});

describe("FR-1 P3 · an auction that closed", () => {
  it("asks its organizers and its paddle holders, each in their own words", async () => {
    const organizer = await person();
    const staff = await person();
    const owner = await person();
    const where = await org(organizer);
    await grant(where.orgId, organizer, "org:owner");
    await grant(where.orgId, staff, "org:staff");
    const auctionId = await auction(where, organizer);
    await paddle(where.orgId, auctionId, owner);

    sent.length = 0;
    await sweepReviewAsks(SWEEP_AT);

    for (const id of [organizer, staff, owner]) {
      const ask = await askOf(id);
      expect(ask?.source, id).toBe("auction_completed");
      expect(ask?.sentAt, id).not.toBeNull();
    }
    expect(mailTo(organizer)?.text).toContain("You've run a tournament");
    expect(mailTo(owner)?.text).toContain("You bid for a team");
  });

  it("waits two hours, and gives up after fourteen days", async () => {
    const tooSoon = await person();
    const tooLate = await person();
    const a = await org(tooSoon);
    await grant(a.orgId, tooSoon, "org:owner");
    await auction(a, tooSoon, { closedAt: new Date(SWEEP_AT.getTime() - HOUR) });
    const b = await org(tooLate);
    await grant(b.orgId, tooLate, "org:owner");
    await auction(b, tooLate, { closedAt: new Date(SWEEP_AT.getTime() - 15 * DAY) });

    await sweepReviewAsks(SWEEP_AT);
    expect(await askOf(tooSoon)).toBeUndefined();
    expect(await askOf(tooLate)).toBeUndefined();

    // An hour later the first one is due.
    await sweepReviewAsks(new Date(SWEEP_AT.getTime() + 2 * HOUR));
    expect((await askOf(tooSoon))?.source).toBe("auction_completed");
  });

  it("ignores an auction marked completed that nobody ever closed", async () => {
    const organizer = await person();
    const where = await org(organizer);
    await grant(where.orgId, organizer, "org:owner");
    await auction(where, organizer, { closedAt: null });
    await sweepReviewAsks(SWEEP_AT);
    expect(await askOf(organizer)).toBeUndefined();
  });

  it("asks nobody for a live auction", async () => {
    const organizer = await person();
    const where = await org(organizer);
    await grant(where.orgId, organizer, "org:owner");
    await auction(where, organizer, { status: "live" });
    await sweepReviewAsks(SWEEP_AT);
    expect(await askOf(organizer)).toBeUndefined();
  });
});

describe("FR-1 P3 · who is not asked", () => {
  it("not a revoked organizer, and not a member with no organizer grant", async () => {
    const organizer = await person();
    const revoked = await person();
    const viewer = await person();
    const where = await org(organizer);
    await grant(where.orgId, organizer, "org:owner");
    await grant(where.orgId, revoked, "org:owner", true);
    await grant(where.orgId, viewer, "viewer");
    await auction(where, organizer);
    await sweepReviewAsks(SWEEP_AT);
    expect(await askOf(organizer)).toBeDefined();
    expect(await askOf(revoked)).toBeUndefined();
    expect(await askOf(viewer)).toBeUndefined();
  });

  it("not somebody with no email, and never a known minor", async () => {
    const organizer = await person();
    const noEmail = await person({ email: false });
    const minor = await person({ dateOfBirth: "2008-06-01" });
    const where = await org(organizer);
    await grant(where.orgId, organizer, "org:owner");
    const auctionId = await auction(where, organizer);
    await paddle(where.orgId, auctionId, noEmail);
    await paddle(where.orgId, auctionId, minor);
    sent.length = 0;
    const result = await sweepReviewAsks(SWEEP_AT);
    expect(await askOf(noEmail)).toBeUndefined();
    expect(await askOf(minor)).toBeUndefined();
    expect(mailTo(minor)).toBeUndefined();
    expect(result.minors).toBeGreaterThanOrEqual(1);
  });

  it("records but never mails somebody who switched feedback requests off", async () => {
    const organizer = await person();
    const where = await org(organizer);
    await grant(where.orgId, organizer, "org:owner");
    await db.insert(notificationPreferences).values({
      id: newId(),
      personId: organizer,
      topic: "feedback",
      channel: "email",
      allowed: false,
    });
    await auction(where, organizer);
    sent.length = 0;
    await sweepReviewAsks(SWEEP_AT);
    const ask = await askOf(organizer);
    expect(ask).toBeDefined();
    expect(ask?.sentAt).toBeNull();
    expect(mailTo(organizer)).toBeUndefined();
  });
});

describe("FR-1 P3 · one ask per person, ever", () => {
  it("a second sweep mails nobody again", async () => {
    const organizer = await person();
    const where = await org(organizer);
    await grant(where.orgId, organizer, "org:owner");
    await auction(where, organizer);
    await sweepReviewAsks(SWEEP_AT);
    const first = await askOf(organizer);
    sent.length = 0;
    await sweepReviewAsks(new Date(SWEEP_AT.getTime() + HOUR));
    expect(mailTo(organizer)).toBeUndefined();
    const second = await askOf(organizer);
    // Untouched — the sweep never re-issues, only the desk does.
    expect(second?.expiresAt.getTime()).toBe(first?.expiresAt.getTime());
  });

  it("an organizer who also held a paddle is asked once, as the organizer", async () => {
    const both = await person();
    const where = await org(both);
    await grant(where.orgId, both, "org:owner");
    const auctionId = await auction(where, both);
    await paddle(where.orgId, auctionId, both);
    sent.length = 0;
    await sweepReviewAsks(SWEEP_AT);
    expect(
      sent.filter((mail) => mail.to === `fr1p3-${both.toLowerCase()}@example.test`).length,
    ).toBe(1);
    expect(mailTo(both)?.text).toContain("You've run a tournament");
  });

  it("somebody already asked from the desk is left alone", async () => {
    const organizer = await person();
    const where = await org(organizer);
    await grant(where.orgId, organizer, "org:owner");
    await db.insert(reviewRequests).values({
      id: newId(),
      personId: organizer,
      source: "manual_admin",
      tokenHash: `fr1p3-${newId()}`,
      expiresAt: new Date(SWEEP_AT.getTime() + 30 * DAY),
    });
    await auction(where, organizer);
    sent.length = 0;
    await sweepReviewAsks(SWEEP_AT);
    expect(mailTo(organizer)).toBeUndefined();
    expect((await askOf(organizer))?.source).toBe("manual_admin");
  });
});

describe("FR-1 P3 · a season that finished", () => {
  it("asks the organizers once every fixture is played or called off", async () => {
    const organizer = await person();
    const where = await org(organizer);
    await grant(where.orgId, organizer, "org:owner");
    await fixture(where, organizer, 1, "completed", new Date(CLOSED_AT.getTime() - DAY));
    await fixture(where, organizer, 2, "cancelled", CLOSED_AT);
    await sweepReviewAsks(SWEEP_AT);
    expect((await askOf(organizer))?.source).toBe("season_completed");
  });

  it("not while a fixture is still to be played", async () => {
    const organizer = await person();
    const where = await org(organizer);
    await grant(where.orgId, organizer, "org:owner");
    await fixture(where, organizer, 1, "completed", CLOSED_AT);
    await fixture(where, organizer, 2, "scheduled", CLOSED_AT);
    await sweepReviewAsks(SWEEP_AT);
    expect(await askOf(organizer)).toBeUndefined();
  });

  it("not when every fixture was called off — nothing was played", async () => {
    const organizer = await person();
    const where = await org(organizer);
    await grant(where.orgId, organizer, "org:owner");
    await fixture(where, organizer, 1, "cancelled", CLOSED_AT);
    await fixture(where, organizer, 2, "cancelled", CLOSED_AT);
    await sweepReviewAsks(SWEEP_AT);
    expect(await askOf(organizer)).toBeUndefined();
  });
});
