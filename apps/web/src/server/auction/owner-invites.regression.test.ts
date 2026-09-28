import {
  auctionOwnerInvites,
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
  teams,
  type DbHandle,
} from "@desiauction/db";
import { and, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { env } from "../../env";
import { createCompetition } from "../competition/competitions";
import type { OutgoingMail, TransactionalMailer } from "../messaging/transactional-mail";
import { notifyOwnerJoined } from "../orgs/organizer-notify";
import { createOrg } from "../orgs/orgs";
import { purgeOrg } from "../test-support/purge-org";
import { hashInviteToken, inviteTokenFrom, liveInviteByToken } from "./owner-invite-lookup";

/**
 * TEAM OWNERS (email programme PR7), against a real database: which links may
 * be emailed, and when the organizers are told every team has its owner.
 */

const handle: DbHandle = createDb(env.DATABASE_URL);
const db = handle.db;
const RUN = String(Date.now()).slice(-7);

const organizer = newId();
const ownerA = newId();
const ownerB = newId();
const auctionId = newId();
const otherAuction = newId();
const teamA = newId();
const teamB = newId();
const TOKEN = `tok${RUN}abcdefghijklmnop`;
let org = { id: "", name: "", slug: "" };
let seasonId = "";

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
      phone: `+9184${RUN}1`,
      name: "Priya Organizer",
      email: `owners-${RUN}@example.test`,
      emailVerifiedAt: new Date(),
    },
    { id: ownerA, phone: `+9184${RUN}2`, name: "Rahul Mehta" },
    { id: ownerB, phone: `+9184${RUN}3`, name: "Sana Iqbal" },
  ]);
  org = await createOrg(db, organizer, `Owner Club ${RUN}`);
  const season = await createCompetition(db, org.id, organizer, {
    sport: "cricket",
    name: `Owner League ${RUN}`,
    location: "Malad",
    startsOn: "2026-10-01",
    endsOn: "2026-10-30",
  });
  seasonId = season.id;
  await db.insert(teams).values([
    { id: teamA, orgId: org.id, competitionId: seasonId, name: "Cup Kings", createdBy: organizer },
    { id: teamB, orgId: org.id, competitionId: seasonId, name: "Tigers", createdBy: organizer },
  ]);
  await db.insert(auctions).values({
    id: auctionId,
    orgId: org.id,
    competitionId: seasonId,
    name: "Owner Auction",
    config: {},
    createdBy: organizer,
  });
  await db.insert(auctionOwnerInvites).values({
    id: newId(),
    orgId: org.id,
    auctionId,
    teamId: teamA,
    tokenHash: hashInviteToken(TOKEN),
    createdBy: organizer,
    expiresAt: new Date(Date.now() + 86_400_000),
  });
});

afterAll(async () => {
  const ids = [organizer, ownerA, ownerB];
  await db.delete(messageOutbox).where(inArray(messageOutbox.personId, ids));
  await db.delete(paddleGrants).where(eq(paddleGrants.orgId, org.id));
  await db.delete(auctionOwnerInvites).where(eq(auctionOwnerInvites.orgId, org.id));
  await db.delete(auctions).where(eq(auctions.orgId, org.id));
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

describe("which link may be emailed", () => {
  it("reads the token from the link, and nothing else", () => {
    expect(inviteTokenFrom(`https://desiauction.in/owner-join/${TOKEN}`)).toBe(TOKEN);
    expect(inviteTokenFrom("https://desiauction.in/owner-join/short")).toBeNull();
    expect(inviteTokenFrom(`https://desiauction.in/join/${TOKEN}`)).toBeNull();
  });

  it("only a live, unaccepted invitation on this auction", async () => {
    expect((await liveInviteByToken(db, auctionId, TOKEN))?.teamName).toBe("Cup Kings");
    expect(await liveInviteByToken(db, otherAuction, TOKEN)).toBeNull();
    expect(await liveInviteByToken(db, auctionId, `${TOKEN}x`)).toBeNull();
    expect(
      await liveInviteByToken(db, auctionId, TOKEN, new Date(Date.now() + 2 * 86_400_000)),
    ).toBeNull();
  });
});

describe("when an owner joins", () => {
  it("tells the organizers in their inbox, and nothing more while a team is unowned", async () => {
    await db
      .update(auctionOwnerInvites)
      .set({ acceptedBy: ownerA, acceptedAt: new Date() })
      .where(eq(auctionOwnerInvites.auctionId, auctionId));
    expect(await liveInviteByToken(db, auctionId, TOKEN)).toBeNull();
    const { mailer, sent } = recording();
    const result = await notifyOwnerJoined(
      db,
      { auctionId, teamName: "Cup Kings" },
      { outboxDb: db, mailer },
    );
    expect(result.ready).toBe(false);
    expect(sent).toHaveLength(0);
    const inbox = await db
      .select({ action: auditLog.action })
      .from(auditLog)
      .where(and(eq(auditLog.scopeId, organizer), eq(auditLog.action, "auction.owner_joined")));
    expect(inbox).toHaveLength(1);
  });

  it("sends 'every team has its owner' when the set is complete — once", async () => {
    await db.insert(paddleGrants).values({
      id: newId(),
      orgId: org.id,
      auctionId,
      teamId: teamB,
      personId: ownerB,
      grantedBy: organizer,
    });
    const { mailer, sent } = recording();
    const first = await notifyOwnerJoined(
      db,
      { auctionId, teamName: "Tigers" },
      { outboxDb: db, mailer },
    );
    expect(first.ready).toBe(true);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.subject).toBe(`All 2 owners are in for Owner League ${RUN}`);
    expect(sent[0]?.text).toContain("  Cup Kings: Rahul Mehta");
    expect(sent[0]?.text).toContain("  Tigers: Sana Iqbal");
    await notifyOwnerJoined(db, { auctionId, teamName: "Tigers" }, { outboxDb: db, mailer });
    expect(sent).toHaveLength(1);
  });
});
