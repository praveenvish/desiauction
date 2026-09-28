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
  passUpgradeRequests,
  people,
  type DbHandle,
} from "@desiauction/db";
import { and, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { env } from "../../env";
import { createCompetition } from "../competition/competitions";
import { resolvePassRequest } from "../competition/pass-grant";
import { SUPPORT_EMAIL } from "../messaging/email-layout";
import type { OutgoingMail, TransactionalMailer } from "../messaging/transactional-mail";
import { purgeOrg } from "../test-support/purge-org";
import { notifyPassAnswered, notifyPassRequested } from "./organizer-notify";
import { createOrg } from "./orgs";

/**
 * THE SEASON'S PASS (email programme PR15), against a real database: the
 * organizer hears their request arrived, the support mailbox hears there is
 * one to answer, and the answer reaches whoever asked and the club's owners.
 */

const handle: DbHandle = createDb(env.DATABASE_URL);
const db = handle.db;
const RUN = String(Date.now()).slice(-7);

const owner = newId();
const operator = newId();
let org = { id: "", name: "", slug: "" };
let season = { id: "", slug: "" };

function recording(): { mailer: TransactionalMailer; sent: OutgoingMail[] } {
  const sent: OutgoingMail[] = [];
  return {
    sent,
    mailer: {
      send: (mail) => {
        sent.push(mail);
        return Promise.resolve("sent");
      },
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
      phone: `+9189${RUN}1`,
      name: "Priya Owner",
      email: `plan-${RUN}@example.test`,
      emailVerifiedAt: new Date(),
    },
    { id: operator, phone: `+9189${RUN}2`, name: "Ops" },
  ]);
  org = await createOrg(db, owner, `Plan Club ${RUN}`);
  const created = await createCompetition(db, org.id, owner, {
    sport: "cricket",
    name: `Plan League ${RUN}`,
    location: "Malad",
    startsOn: "2026-10-01",
    endsOn: "2026-10-30",
  });
  season = { id: created.id, slug: created.slug };
});

afterAll(async () => {
  const ids = [owner, operator];
  await db.delete(messageOutbox).where(inArray(messageOutbox.personId, ids));
  await db.delete(passUpgradeRequests).where(eq(passUpgradeRequests.orgId, org.id));
  await purgeOrg(db, org.id);
  await db.delete(competitions).where(eq(competitions.orgId, org.id));
  await db.delete(grants).where(eq(grants.scopeId, org.id));
  await db.delete(orgMembers).where(eq(orgMembers.orgId, org.id));
  await db.delete(auditLog).where(eq(auditLog.scopeId, org.id));
  await db.delete(organizations).where(eq(organizations.id, org.id));
  await db.delete(auditLog).where(inArray(auditLog.actor, ids));
  await db.delete(auditLog).where(inArray(auditLog.scopeId, ids));
  await db.delete(consentRecords).where(inArray(consentRecords.personId, ids));
  await db.delete(people).where(inArray(people.id, ids));
  await handle.sql.end();
});

describe("asking for a bigger pass", () => {
  it("tells the organizer we have it, and the support mailbox there is one to answer", async () => {
    const requestId = newId();
    await db.insert(passUpgradeRequests).values({
      id: requestId,
      orgId: org.id,
      competitionId: season.id,
      fromTier: "free",
      requestedTier: "pro",
      note: "Eight teams this year",
      requestedBy: owner,
    });
    const { mailer, sent } = recording();
    await notifyPassRequested(
      db,
      {
        competitionId: season.id,
        requestId,
        requestedBy: owner,
        fromTier: "free",
        requestedTier: "pro",
        note: "Eight teams this year",
      },
      { outboxDb: db, mailer },
    );
    const organizer = sent.find((mail) => mail.to === `plan-${RUN}@example.test`);
    expect(organizer?.subject).toBe(`We've got your Pro Pass request for Plan League ${RUN}`);
    expect(organizer?.text).toContain("nothing is charged");
    const staff = sent.find((mail) => mail.to === SUPPORT_EMAIL);
    expect(staff?.subject).toBe(`[Pass] Plan League ${RUN} asks for Pro Pass`);
    expect(staff?.text).toContain("Eight teams this year");
    expect(staff?.text).toContain("/admin/passes");
  });
});

describe("the answer", () => {
  it("says what the season can hold now, once, and writes the inbox", async () => {
    const result = await resolvePassRequest(db, {
      slug: season.slug,
      outcome: "granted",
      actorId: operator,
    });
    if (!result.ok) throw new Error(result.detail);
    expect(result).toMatchObject({ requestedBy: owner, requestedTier: "pro", toTier: "pro" });
    const { mailer, sent } = recording();
    const input = {
      competitionId: result.competitionId,
      requestId: result.requestId,
      requestedBy: result.requestedBy,
      outcome: result.outcome,
      fromTier: result.fromTier,
      passTier: result.toTier,
      note: null,
    };
    expect(await notifyPassAnswered(db, input, { outboxDb: db, mailer })).toBe(1);
    expect(await notifyPassAnswered(db, input, { outboxDb: db, mailer })).toBe(0);
    expect(sent[0]?.subject).toBe(`Plan League ${RUN} is now on Pro Pass`);
    expect(sent[0]?.text).toContain("Teams: Up to 16");
    expect(sent[0]?.text).toContain("Players: Up to 400");
    const inbox = await db
      .select({ meta: auditLog.meta })
      .from(auditLog)
      .where(and(eq(auditLog.scopeId, owner), eq(auditLog.action, "plan.answered")));
    expect(inbox).toHaveLength(1);
  });

  it("declines plainly, with the note, and no limits", async () => {
    const { mailer, sent } = recording();
    await notifyPassAnswered(
      db,
      {
        competitionId: season.id,
        requestId: newId(),
        requestedBy: owner,
        outcome: "declined",
        fromTier: "free",
        passTier: "association",
        note: "Association is for federations — Pro fits you.",
      },
      { outboxDb: db, mailer },
    );
    expect(sent[0]?.subject).toBe(`Your Association request for Plan League ${RUN}`);
    expect(sent[0]?.text).toContain("stays on Free");
    expect(sent[0]?.text).toContain("Pro fits you");
    expect(sent[0]?.text).not.toContain("Up to");
  });
});
