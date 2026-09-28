import {
  auctions,
  auditLog,
  competitions,
  consentRecords,
  createDb,
  fixtures,
  grants,
  grounds,
  messageOutbox,
  newId,
  organizations,
  orgMembers,
  paddleGrants,
  people,
  registrations,
  teams,
  venues,
  type DbHandle,
} from "@desiauction/db";
import { and, eq, inArray, like } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { env } from "../../env";
import { createOrg } from "../orgs/orgs";
import { purgeOrg } from "../test-support/purge-org";
import { createCompetition } from "./competitions";
import { notifyFixtureChanged, notifySchedulePublished, SETTLE_MS } from "./fixture-notify";
import { matchDayDueAt, sweepMatchDays } from "./match-day";

/**
 * THE SEASON'S MATCHES (email programme PR11), against a real database: the
 * schedule held and rebuilt, a moved match, and match day — each once, to the
 * team's players and owners, and the organizer's day at a glance.
 */

const handle: DbHandle = createDb(env.DATABASE_URL);
const db = handle.db;
const RUN = String(Date.now()).slice(-7);

const organizer = newId();
const owner = newId();
const player = newId();
const rival = newId();
const auctionId = newId();
const kings = newId();
const tigers = newId();
const evening = newId();
const early = newId();
let org = { id: "", name: "", slug: "" };
let seasonId = "";

// Saturday 4 October 2031, 7:30 pm IST; and Sunday 5 October, 8:00 am IST.
const EVENING = "2031-10-04T19:30";
const EARLY = "2031-10-05T08:00";
const ist = (wall: string) => new Date(`${wall}:00+05:30`);

const outboxFor = (prefix: string) =>
  db
    .select({
      key: messageOutbox.dedupeKey,
      personId: messageOutbox.personId,
      status: messageOutbox.status,
      subject: messageOutbox.subject,
      body: messageOutbox.bodyText,
      nextAttemptAt: messageOutbox.nextAttemptAt,
    })
    .from(messageOutbox)
    .where(
      and(
        like(messageOutbox.dedupeKey, `${prefix}%`),
        inArray(messageOutbox.personId, [organizer, owner, player, rival]),
      ),
    );

beforeAll(async () => {
  await db.insert(people).values([
    {
      id: organizer,
      phone: `+9184${RUN}1`,
      name: "Priya Organizer",
      email: `matches-${RUN}@example.test`,
      emailVerifiedAt: new Date(),
    },
    { id: owner, phone: `+9184${RUN}2`, name: "Rahul Owner", email: `owner-${RUN}@example.test` },
    { id: player, phone: `+9184${RUN}3`, name: "Arjun Player", email: `p-${RUN}@example.test` },
    { id: rival, phone: `+9184${RUN}4`, name: "Sana Rival", email: `r-${RUN}@example.test` },
  ]);
  org = await createOrg(db, organizer, `Match Club ${RUN}`);
  const season = await createCompetition(db, org.id, organizer, {
    sport: "cricket",
    name: `Match League ${RUN}`,
    location: "Malad",
    startsOn: "2031-10-01",
    endsOn: "2031-10-30",
  });
  seasonId = season.id;
  await db.insert(teams).values([
    { id: kings, orgId: org.id, competitionId: seasonId, name: "Cup Kings", createdBy: organizer },
    { id: tigers, orgId: org.id, competitionId: seasonId, name: "Tigers", createdBy: organizer },
  ]);
  const venueId = newId();
  const groundId = newId();
  await db.insert(venues).values({
    id: venueId,
    orgId: org.id,
    name: `Malad Sports ${RUN}`,
    address: "Link Road, Malad West",
    city: "Mumbai",
    createdBy: organizer,
  });
  await db.insert(grounds).values({
    id: groundId,
    orgId: org.id,
    venueId,
    name: "Malad Ground",
    createdBy: organizer,
  });
  await db.insert(auctions).values({
    id: auctionId,
    orgId: org.id,
    competitionId: seasonId,
    name: "Match Auction",
    config: {},
    createdBy: organizer,
  });
  await db.insert(paddleGrants).values({
    id: newId(),
    orgId: org.id,
    auctionId,
    teamId: kings,
    personId: owner,
    grantedBy: organizer,
  });
  await db.insert(registrations).values([
    {
      id: newId(),
      orgId: org.id,
      competitionId: seasonId,
      personId: player,
      role: "batter",
      status: "approved",
      teamId: kings,
    },
    {
      id: newId(),
      orgId: org.id,
      competitionId: seasonId,
      personId: rival,
      role: "batter",
      status: "approved",
      teamId: tigers,
    },
  ]);
  await db.insert(fixtures).values([
    {
      id: evening,
      orgId: org.id,
      competitionId: seasonId,
      fixtureNumber: `M${RUN}-1`,
      seq: 1,
      homeTeamId: kings,
      awayTeamId: tigers,
      groundId,
      kickoffAt: EVENING,
      durationMinutes: 180,
      status: "published",
      createdBy: organizer,
    },
    {
      id: early,
      orgId: org.id,
      competitionId: seasonId,
      fixtureNumber: `M${RUN}-2`,
      seq: 2,
      homeTeamId: tigers,
      awayTeamId: kings,
      groundId,
      kickoffAt: EARLY,
      durationMinutes: 180,
      status: "published",
      createdBy: organizer,
    },
  ]);
});

afterAll(async () => {
  const ids = [organizer, owner, player, rival];
  await db.delete(messageOutbox).where(inArray(messageOutbox.personId, ids));
  await db.delete(fixtures).where(eq(fixtures.orgId, org.id));
  await db.delete(grounds).where(eq(grounds.orgId, org.id));
  await db.delete(venues).where(eq(venues.orgId, org.id));
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

const BEFORE = ist("2031-10-01T12:00");

describe("the schedule", () => {
  it("goes to each team's players and owner, held ten minutes", async () => {
    const result = await notifySchedulePublished(
      db,
      { competitionId: seasonId },
      { now: BEFORE, outboxDb: db },
    );
    expect(result.queued).toBe(3);
    const rows = await outboxFor(`schedule.published:${seasonId}:`);
    expect(new Set(rows.map((row) => row.personId))).toEqual(new Set([owner, player, rival]));
    for (const row of rows) {
      expect(row.status).toBe("pending");
      expect(row.nextAttemptAt.getTime()).toBe(BEFORE.getTime() + SETTLE_MS);
    }
    const mine = rows.find((row) => row.personId === player);
    expect(mine?.subject).toBe("Your Cup Kings schedule: 2 matches");
    expect(mine?.body).toContain("vs Tigers");
  });

  it("publishing again replaces the notice still waiting — one mail, the whole list", async () => {
    await notifySchedulePublished(db, { competitionId: seasonId }, { now: BEFORE, outboxDb: db });
    const rows = await outboxFor(`schedule.published:${seasonId}:${player}:`);
    expect(rows.filter((row) => row.status === "pending")).toHaveLength(1);
    expect(rows.filter((row) => row.status === "suppressed")).toHaveLength(1);
  });

  it("a match moved while the schedule waits rebuilds the schedule instead of a second mail", async () => {
    const result = await notifyFixtureChanged(
      db,
      {
        competitionId: seasonId,
        fixtureId: evening,
        change: "moved",
        previousKickoff: "2031-10-04T16:00",
        previousGround: null,
        reason: null,
      },
      { now: BEFORE, outboxDb: db },
    );
    expect(result).toEqual({ queued: 0, rebuilt: 3 });
    expect(await outboxFor(`fixture.changed:${evening}:`)).toHaveLength(0);
  });

  it("says 'more matches' to someone who already had it", async () => {
    await db
      .update(messageOutbox)
      .set({ status: "sent" })
      .where(
        and(
          like(messageOutbox.dedupeKey, `schedule.published:${seasonId}:%`),
          eq(messageOutbox.status, "pending"),
        ),
      );
    await notifySchedulePublished(
      db,
      { competitionId: seasonId, teamIds: [kings] },
      { now: BEFORE, outboxDb: db },
    );
    const pending = (await outboxFor(`schedule.published:${seasonId}:${player}:`)).filter(
      (row) => row.status === "pending",
    );
    expect(pending[0]?.subject).toBe("More Cup Kings matches published");
  });
});

describe("a published match that changes", () => {
  it("tells both teams, with the old time, and writes their inbox", async () => {
    await db
      .update(messageOutbox)
      .set({ status: "sent" })
      .where(
        and(
          like(messageOutbox.dedupeKey, `schedule.published:${seasonId}:%`),
          eq(messageOutbox.status, "pending"),
        ),
      );
    const result = await notifyFixtureChanged(
      db,
      {
        competitionId: seasonId,
        fixtureId: evening,
        change: "moved",
        previousKickoff: "2031-10-04T16:00",
        previousGround: null,
        reason: null,
      },
      { now: BEFORE, outboxDb: db },
    );
    expect(result).toEqual({ queued: 3, rebuilt: 0 });
    const rows = await outboxFor(`fixture.changed:${evening}:`);
    const rivals = rows.find((row) => row.personId === rival);
    expect(rivals?.subject).toContain("Match moved: Cup Kings vs Tigers is now");
    expect(rivals?.body).toContain("Sat 4 Oct, 4:00 pm");
    const inbox = await db
      .select({ action: auditLog.action })
      .from(auditLog)
      .where(and(eq(auditLog.scopeId, rival), eq(auditLog.action, "fixture.changed")));
    expect(inbox).toHaveLength(1);
  });

  it("a newer change replaces one still waiting", async () => {
    await notifyFixtureChanged(
      db,
      {
        competitionId: seasonId,
        fixtureId: evening,
        change: "cancelled",
        previousKickoff: EVENING,
        previousGround: "Malad Ground",
        reason: "Rain forecast",
      },
      { now: BEFORE, outboxDb: db },
    );
    const pending = (await outboxFor(`fixture.changed:${evening}:`)).filter(
      (row) => row.status === "pending",
    );
    expect(pending).toHaveLength(3);
    expect(pending.every((row) => row.subject.startsWith("Called off:"))).toBe(true);
    expect(pending[0]?.body).toContain("Rain forecast");
  });
});

describe("match day", () => {
  it("is due at 7 am on the day, or 6 pm the evening before an early match", () => {
    expect(matchDayDueAt(EVENING)).toEqual(ist("2031-10-04T07:00"));
    expect(matchDayDueAt(EARLY)).toEqual(ist("2031-10-04T18:00"));
  });

  const sweep = (now: Date) =>
    sweepMatchDays({ now, readDb: db, outboxDb: db, competitionIds: [seasonId] });

  it("waits until the note is due", async () => {
    expect(await sweep(ist("2031-10-04T06:58"))).toEqual({ queued: 0 });
  });

  it("tells both teams and the organizer once, in the morning", async () => {
    // 4 people: the organizer, the owner and player of Cup Kings, Tigers' player.
    expect(await sweep(ist("2031-10-04T07:02"))).toEqual({ queued: 4 });
    expect(await sweep(ist("2031-10-04T07:04"))).toEqual({ queued: 0 });
    const rows = await outboxFor(`match.day:${seasonId}:2031-10-04:`);
    const mine = rows.find((row) => row.personId === player);
    expect(mine?.subject).toBe("Match day: Cup Kings vs Tigers, 7:30 pm today");
    expect(mine?.body).toContain("Link Road, Malad West, Mumbai");
    // Never "you're not in the lineup" (C-23): no lineup was announced, so nothing is said.
    expect(mine?.body).not.toContain("lineup");
    const theOrganizer = rows.find((row) => row.personId === organizer);
    expect(theOrganizer?.subject).toBe(`Match day: 1 match today in Match League ${RUN}`);
    expect(theOrganizer?.body).toContain("0/2 lineups");
  });

  it("tells an early match the evening before, as tomorrow", async () => {
    expect(await sweep(ist("2031-10-04T17:55"))).toEqual({ queued: 0 });
    expect(await sweep(ist("2031-10-04T18:03"))).toEqual({ queued: 4 });
    const mine = (await outboxFor(`match.day:${seasonId}:2031-10-05:`)).find(
      (row) => row.personId === player,
    );
    expect(mine?.subject).toBe("Match day: Tigers vs Cup Kings, 8:00 am tomorrow");
  });

  it("says nothing inside the hour before kickoff", async () => {
    await db
      .delete(messageOutbox)
      .where(like(messageOutbox.dedupeKey, `match.day:${seasonId}:2031-10-05:%`));
    expect(await sweep(ist("2031-10-05T07:10"))).toEqual({ queued: 0 });
  });
});
