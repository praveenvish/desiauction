import {
  auditLog,
  consentRecords,
  createDb,
  grants,
  invites,
  messageOutbox,
  newId,
  organizations,
  orgMembers,
  people,
  type DbHandle,
} from "@desiauction/db";
import { and, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { env } from "../../env";
import { clubInviteMail } from "../messaging/club-mail";
import type { OutgoingMail, TransactionalMailer } from "../messaging/transactional-mail";
import { purgeOrg } from "../test-support/purge-org";
import { acceptInvite, clubInviteTokenFrom, createInvite, liveClubInvite } from "./invites";
import { notifyMemberJoined } from "./organizer-notify";
import { createOrg } from "./orgs";

/**
 * JOINING A CLUB (email programme PR13), against a real database: the link an
 * organizer may email, and "someone joined" to whoever sent it — once.
 */

const handle: DbHandle = createDb(env.DATABASE_URL);
const db = handle.db;
const RUN = String(Date.now()).slice(-7);

const owner = newId();
const joiner = newId();
let org = { id: "", name: "", slug: "" };
let other = { id: "", name: "", slug: "" };

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
      id: owner,
      phone: `+9187${RUN}1`,
      name: "Priya Owner",
      email: `club-${RUN}@example.test`,
      emailVerifiedAt: new Date(),
    },
    {
      id: joiner,
      phone: `+9187${RUN}2`,
      name: "Rahul Mehta",
      email: `joiner-${RUN}@example.test`,
      emailVerifiedAt: new Date(),
    },
  ]);
  org = await createOrg(db, owner, `Invite Club ${RUN}`);
  other = await createOrg(db, owner, `Other Club ${RUN}`);
});

afterAll(async () => {
  const ids = [owner, joiner];
  await db.delete(messageOutbox).where(inArray(messageOutbox.personId, ids));
  for (const id of [org.id, other.id]) {
    await db.delete(invites).where(eq(invites.orgId, id));
    await purgeOrg(db, id);
    await db.delete(grants).where(eq(grants.scopeId, id));
    await db.delete(orgMembers).where(eq(orgMembers.orgId, id));
    await db.delete(auditLog).where(eq(auditLog.scopeId, id));
    await db.delete(organizations).where(eq(organizations.id, id));
  }
  await db.delete(auditLog).where(inArray(auditLog.actor, ids));
  await db.delete(auditLog).where(inArray(auditLog.scopeId, ids));
  await db.delete(consentRecords).where(inArray(consentRecords.personId, ids));
  await db.delete(people).where(inArray(people.id, ids));
  await handle.sql.end();
});

describe("emailing a club invite", () => {
  let token = "";

  it("reads the token from the link the panel shows", async () => {
    token = (await createInvite(db, org.id, owner, "org:staff")).token;
    expect(clubInviteTokenFrom(`https://desiauction.in/join/${token}`)).toBe(token);
    expect(clubInviteTokenFrom(`/join/${token}`)).toBe(token);
    expect(clubInviteTokenFrom(`https://desiauction.in/owner-join/${token}`)).toBeNull();
  });

  it("finds a live link only in its own club", async () => {
    expect(await liveClubInvite(db, org.id, token)).toMatchObject({ capabilitySet: "org:staff" });
    expect(await liveClubInvite(db, other.id, token)).toBeNull();
    expect(await liveClubInvite(db, org.id, "not-a-real-token-at-all")).toBeNull();
  });

  it("says what the access allows, and that the link is theirs alone", async () => {
    const mail = await clubInviteMail(
      {
        orgName: org.name,
        inviterName: "Priya Owner",
        capabilitySet: "org:staff",
        acceptUrl: `https://desiauction.in/join/${token}`,
      },
      "en",
    );
    expect(mail.subject).toBe(`Priya Owner invited you to join ${org.name} on DesiAuction`);
    expect(mail.text).toContain("As staff you can run seasons");
    expect(mail.text).toContain("Whoever opens it joins the club");
    expect(mail.text).toContain(`/join/${token}`);
    // A direct send to somebody without an account: no "Manage emails".
    expect(mail.text).not.toContain("Manage emails");
  });

  it("is refused once the link has been used", async () => {
    const accepted = await acceptInvite(db, joiner, token);
    expect(accepted).toMatchObject({
      ok: true,
      orgId: org.id,
      invitedBy: owner,
      capabilitySet: "org:staff",
    });
    expect(await liveClubInvite(db, org.id, token)).toBeNull();
  });
});

describe("someone joined", () => {
  it("tells whoever sent the link and the owners — never the new member — once", async () => {
    const invite = await createInvite(db, org.id, owner, "viewer");
    const accepted = await acceptInvite(db, joiner, invite.token);
    if (!accepted.ok) throw new Error("accept failed");
    const { mailer, sent } = recording();
    const input = {
      inviteId: accepted.inviteId,
      orgId: org.id,
      orgName: org.name,
      orgSlug: org.slug,
      memberId: joiner,
      invitedBy: owner,
      capabilitySet: accepted.capabilitySet,
    };
    expect(await notifyMemberJoined(db, input, { outboxDb: db, mailer })).toBe(1);
    expect(await notifyMemberJoined(db, input, { outboxDb: db, mailer })).toBe(0);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.to).toBe(`club-${RUN}@example.test`);
    expect(sent[0]?.subject).toBe(`Rahul Mehta joined ${org.name} as a member`);
    expect(sent[0]?.text).toContain(`/org/${org.slug}#members`);
    const inbox = await db
      .select({ meta: auditLog.meta })
      .from(auditLog)
      .where(and(eq(auditLog.scopeId, owner), eq(auditLog.action, "club.member_joined")));
    expect(inbox).toEqual([{ meta: { member: "Rahul Mehta" } }]);
  });
});
