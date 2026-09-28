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
import { purgeOrg } from "../test-support/purge-org";
import { createOrg } from "../orgs/orgs";
import { SETTLE_MS, notifyAuctionSchedule, scheduleRecipientIds } from "./auction-schedule-notify";
import {
  auctionStartOf,
  createCompetition,
  resolveCompetition,
  setAuctionStart,
  type CompetitionSummary,
} from "./competitions";

/**
 * WHEN IS AUCTION NIGHT? (0095, email programme PR6), against a real database:
 * the writer's rules, and who is told — once, after the organizer has settled.
 */

const handle: DbHandle = createDb(env.DATABASE_URL);
const db = handle.db;
const RUN = String(Date.now()).slice(-7);

const organizer = newId();
const owner = newId();
const player = newId();
const icon = newId();
const waiting = newId();
let org = { id: "", name: "", slug: "" };
let season: CompetitionSummary;
const auctionId = newId();
const teamId = newId();

const NOW = new Date("2026-09-28T06:00:00Z");
const NIGHT = new Date("2026-10-04T14:30:00Z");
const LATER = new Date("2026-10-04T15:00:00Z");

beforeAll(async () => {
  await db.insert(people).values([
    { id: organizer, phone: `+9185${RUN}1`, name: "Priya Organizer" },
    { id: owner, phone: `+9185${RUN}2`, name: "Rahul Owner" },
    { id: player, phone: `+9185${RUN}3`, name: "Arjun Player" },
    { id: icon, phone: `+9185${RUN}4`, name: "Icon Player" },
    { id: waiting, phone: `+9185${RUN}5`, name: "Waiting Player" },
  ]);
  org = await createOrg(db, organizer, `Schedule Club ${RUN}`);
  const created = await createCompetition(db, org.id, organizer, {
    sport: "cricket",
    name: `Schedule League ${RUN}`,
    location: "Malad",
    startsOn: "2026-10-01",
    endsOn: "2026-10-30",
  });
  const resolved = await resolveCompetition(db, organizer, created.slug);
  if (resolved === null) throw new Error("season vanished");
  season = resolved;
  await db.insert(registrations).values([
    {
      id: newId(),
      orgId: org.id,
      competitionId: season.id,
      personId: player,
      role: "batter",
      status: "approved",
    },
    {
      id: newId(),
      orgId: org.id,
      competitionId: season.id,
      personId: icon,
      role: "bowler",
      status: "approved",
      isIcon: true,
    },
    { id: newId(), orgId: org.id, competitionId: season.id, personId: waiting, role: "batter" },
  ]);
});

afterAll(async () => {
  const ids = [organizer, owner, player, icon, waiting];
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
  await db.delete(auditLog).where(inArray(auditLog.actor, ids));
  await db.delete(consentRecords).where(inArray(consentRecords.personId, ids));
  await db.delete(people).where(inArray(people.id, ids));
  await handle.sql.end();
});

describe("setting the time", () => {
  it("refuses a time already gone", async () => {
    const result = await setAuctionStart(
      db,
      season,
      organizer,
      new Date(NOW.getTime() - 60_000),
      NOW,
    );
    expect(result).toEqual({ ok: false, reason: "in_past" });
  });

  it("sets, moves and clears it — each audited, a repeat changing nothing", async () => {
    expect(await setAuctionStart(db, season, organizer, NIGHT, NOW)).toMatchObject({
      ok: true,
      previous: null,
      changed: true,
    });
    expect((await auctionStartOf(db, season.id))?.toISOString()).toBe(NIGHT.toISOString());
    expect(await setAuctionStart(db, season, organizer, NIGHT, NOW)).toMatchObject({
      ok: true,
      changed: false,
    });
    await setAuctionStart(db, season, organizer, LATER, NOW);
    await setAuctionStart(db, season, organizer, null, NOW);
    const trail = await db
      .select({ action: auditLog.action })
      .from(auditLog)
      .where(
        and(eq(auditLog.subject, season.id), like(auditLog.action, "competition.auction_time_%")),
      )
      .orderBy(auditLog.at);
    expect(trail.map((row) => row.action)).toEqual([
      "competition.auction_time_set",
      "competition.auction_time_changed",
      "competition.auction_time_cleared",
    ]);
  });
});

describe("who is told", () => {
  it("owners and pool players — never an icon, never a registration still waiting", async () => {
    await db.insert(teams).values({
      id: teamId,
      orgId: org.id,
      competitionId: season.id,
      name: "Cup Kings",
      createdBy: organizer,
    });
    await db.insert(auctions).values({
      id: auctionId,
      orgId: org.id,
      competitionId: season.id,
      name: "Schedule Auction",
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
    expect((await scheduleRecipientIds(db, season.id)).sort()).toEqual([owner, player].sort());
  });

  it("waits ten minutes, and a newer change replaces the one still waiting", async () => {
    const first = await notifyAuctionSchedule(
      db,
      { competitionId: season.id, change: "set", at: NIGHT, previous: null },
      { now: NOW, outboxDb: db },
    );
    expect(first).toEqual({ queued: 2, superseded: 0 });
    const second = await notifyAuctionSchedule(
      db,
      { competitionId: season.id, change: "moved", at: LATER, previous: NIGHT },
      { now: NOW, outboxDb: db },
    );
    expect(second).toEqual({ queued: 2, superseded: 2 });
    const rows = await db
      .select({
        person: messageOutbox.personId,
        status: messageOutbox.status,
        at: messageOutbox.nextAttemptAt,
        subject: messageOutbox.subject,
      })
      .from(messageOutbox)
      .where(like(messageOutbox.dedupeKey, `auction.schedule:${season.id}:%`));
    const pending = rows.filter((row) => row.status === "pending");
    expect(pending).toHaveLength(2);
    for (const row of pending) {
      expect(row.at.getTime()).toBe(NOW.getTime() + SETTLE_MS);
      expect(row.subject).toContain("New time:");
    }
    expect(rows.filter((row) => row.status === "suppressed")).toHaveLength(2);
  });
});
