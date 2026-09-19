// ANNOUNCE CAPTAINS & ICONS, against real Postgres: nobody is told until the
// organizer presses Announce; a second press tells nobody twice; a person with
// two roles gets one email; a role added later is told on its own; moving a
// captain to another team is a new appointment; a captain the auction bought
// is never told they skipped it.
import { DEFAULT_AUCTION_CONFIG, registrationNumber } from "@desiauction/core";
import {
  auctions,
  auditLog,
  createDb,
  lots,
  messageOutbox,
  newId,
  paddles,
  people,
  registrations,
  type DbHandle,
} from "@desiauction/db";
import { and, desc, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { env } from "../../env";
import { createOrg } from "../orgs/orgs";
import { purgeOrg } from "../test-support/purge-org";
import { announceAppointments, appointmentsView } from "./appointments";
import { createCompetition, createTeam } from "./competitions";

const handle: DbHandle = createDb(env.DATABASE_URL);
const db = handle.db;
const RUN = String(Date.now()).slice(-7);

let organizer = "";
let captain = "";
let bought = "";
let orgId = "";
let competitionId = "";
let kings = "";
let tigers = "";
let registrationId = "";

beforeAll(async () => {
  organizer = newId();
  captain = newId();
  await db.insert(people).values([
    { id: organizer, phone: `+9192${RUN}1`, name: "Organizer" },
    { id: captain, phone: `+9192${RUN}2`, name: "Arjun Sharma" },
  ]);
  bought = newId();
  await db.insert(people).values({ id: bought, phone: `+9192${RUN}3`, name: "Rohit Kumar" });
  orgId = (await createOrg(db, organizer, `Appoint Club ${RUN}`)).id;
  competitionId = (
    await createCompetition(db, orgId, organizer, {
      name: `Appoint Cup ${RUN}`,
      sport: "cricket",
      location: "Pune",
      startsOn: "2026-10-01",
      endsOn: "2026-10-30",
    })
  ).id;
  const k = await createTeam(db, orgId, competitionId, organizer, "Cup Kings");
  const t = await createTeam(db, orgId, competitionId, organizer, "Cup Tigers");
  if (!k.ok || !t.ok) throw new Error("teams not created");
  kings = k.team.id;
  tigers = t.team.id;
  registrationId = newId();
  await db.insert(registrations).values({
    id: registrationId,
    orgId,
    competitionId,
    personId: captain,
    role: "batter",
    status: "approved",
    registrationNumber: registrationNumber(registrationId),
    teamId: kings,
    isCaptain: true,
  });
});

afterAll(async () => {
  await db.delete(messageOutbox).where(inArray(messageOutbox.personId, [captain, bought]));
  await db
    .delete(auditLog)
    .where(
      and(inArray(auditLog.scopeId, [captain, bought]), eq(auditLog.action, "team.appointed")),
    );
  if (orgId !== "") await purgeOrg(db, orgId);
  await db.delete(people).where(inArray(people.id, [organizer, captain, bought]));
  await handle.sql.end();
});

async function latestMail(personId: string) {
  const [row] = await db
    .select({ subject: messageOutbox.subject, text: messageOutbox.bodyText })
    .from(messageOutbox)
    .where(eq(messageOutbox.personId, personId))
    .orderBy(desc(messageOutbox.createdAt), desc(messageOutbox.id))
    .limit(1);
  return row;
}

describe("ANNOUNCE — nobody hears until the organizer says so", () => {
  it("lists a named captain as pending, and has told nobody yet", async () => {
    const view = await appointmentsView(db, competitionId);
    expect(view.pending.map((item) => [item.listedName, item.roles, item.teamName])).toEqual([
      ["Arjun Sharma", ["captain"], "Cup Kings"],
    ]);
    expect(view.told).toBe(0);
    const queued = await db.select().from(messageOutbox).where(eq(messageOutbox.personId, captain));
    expect(queued).toHaveLength(0);
  });

  it("tells them once — an email queued and a line in their inbox", async () => {
    expect(await announceAppointments(db, { competitionId, actorId: organizer })).toBe(1);
    const mail = await latestMail(captain);
    expect(mail?.subject).toBe("You're the captain of Cup Kings");
    // Named before any auction: a captain is signed directly now.
    expect(mail?.text).toContain("without going through the auction");
    const inbox = await db
      .select({ meta: auditLog.meta })
      .from(auditLog)
      .where(and(eq(auditLog.scopeId, captain), eq(auditLog.action, "team.appointed")));
    expect(inbox).toHaveLength(1);
  });

  it("a second press tells nobody twice", async () => {
    expect(await announceAppointments(db, { competitionId, actorId: organizer })).toBe(0);
    const view = await appointmentsView(db, competitionId);
    expect(view.pending).toHaveLength(0);
    expect(view.told).toBe(1);
  });
});

describe("ANNOUNCE — one email per person, whatever the roles", () => {
  it("making the captain the icon too announces only the new role", async () => {
    await db
      .update(registrations)
      .set({ isIcon: true })
      .where(eq(registrations.id, registrationId));
    const view = await appointmentsView(db, competitionId);
    expect(view.pending.map((item) => item.roles)).toEqual([["icon"]]);
    expect(await announceAppointments(db, { competitionId, actorId: organizer })).toBe(1);
    expect((await latestMail(captain))?.subject).toBe("You're the icon player of Cup Kings");
  });

  it("moving them to another team is a new appointment — both roles, one email", async () => {
    await db
      .update(registrations)
      .set({ teamId: tigers })
      .where(eq(registrations.id, registrationId));
    const view = await appointmentsView(db, competitionId);
    expect(view.pending.map((item) => [item.teamName, item.roles])).toEqual([
      ["Cup Tigers", ["captain", "icon"]],
    ]);
    expect(await announceAppointments(db, { competitionId, actorId: organizer })).toBe(1);
    expect((await latestMail(captain))?.subject).toBe(
      "You're the captain and icon player of Cup Tigers",
    );
  });
});

describe("ANNOUNCE — a captain the auction bought", () => {
  it("is congratulated, and never told they skipped the auction", async () => {
    const boughtRegistration = newId();
    await db.insert(registrations).values({
      id: boughtRegistration,
      orgId,
      competitionId,
      personId: bought,
      role: "batter",
      status: "approved",
      registrationNumber: registrationNumber(boughtRegistration),
      teamId: kings,
    });
    const auctionId = newId();
    await db.insert(auctions).values({
      id: auctionId,
      orgId,
      competitionId,
      name: "Appoint Auction",
      status: "completed",
      config: DEFAULT_AUCTION_CONFIG,
      createdBy: organizer,
    });
    const paddleId = newId();
    await db.insert(paddles).values({
      id: paddleId,
      orgId,
      auctionId,
      teamId: kings,
      personId: organizer,
      paddleNumber: "P01",
    });
    await db.insert(lots).values({
      id: newId(),
      orgId,
      auctionId,
      registrationId: boughtRegistration,
      lotNumber: "L001",
      seq: 1,
      basePrice: 1_000_000,
      status: "sold",
      soldPrice: 2_000_000,
      soldToPaddleId: paddleId,
    });
    // Named captain AFTER the hammer — Kings' armband, as Arjun moved away.
    await db
      .update(registrations)
      .set({ isCaptain: true })
      .where(eq(registrations.id, boughtRegistration));
    expect(await announceAppointments(db, { competitionId, actorId: organizer })).toBe(1);
    const mail = await latestMail(bought);
    expect(mail?.subject).toBe("You're the captain of Cup Kings");
    expect(mail?.text).not.toContain("without going through the auction");
  });
});
