// ANNOUNCE CAPTAINS & ICONS, against real Postgres: nobody is told until the
// organizer presses Announce; a second press tells nobody twice; moving a
// captain to another team is a new appointment.
import { registrationNumber } from "@desiauction/core";
import {
  auditLog,
  createDb,
  messageOutbox,
  newId,
  people,
  registrations,
  type DbHandle,
} from "@desiauction/db";
import { and, eq, inArray } from "drizzle-orm";
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
  await db.delete(messageOutbox).where(inArray(messageOutbox.personId, [captain]));
  await db
    .delete(auditLog)
    .where(and(eq(auditLog.scopeId, captain), eq(auditLog.action, "team.appointed")));
  if (orgId !== "") await purgeOrg(db, orgId);
  await db.delete(people).where(inArray(people.id, [organizer, captain]));
  await handle.sql.end();
});

describe("ANNOUNCE — nobody hears until the organizer says so", () => {
  it("lists a named captain as pending, and has told nobody yet", async () => {
    const view = await appointmentsView(db, competitionId);
    expect(view.pending.map((item) => [item.listedName, item.role, item.teamName])).toEqual([
      ["Arjun Sharma", "captain", "Cup Kings"],
    ]);
    expect(view.told).toBe(0);
    const queued = await db.select().from(messageOutbox).where(eq(messageOutbox.personId, captain));
    expect(queued).toHaveLength(0);
  });

  it("tells them once — an email queued and a line in their inbox", async () => {
    expect(await announceAppointments(db, { competitionId, actorId: organizer })).toBe(1);
    const [queued] = await db
      .select({ subject: messageOutbox.subject })
      .from(messageOutbox)
      .where(eq(messageOutbox.personId, captain));
    expect(queued?.subject).toBe("You're the captain of Cup Kings");
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

  it("moving the captain to another team is a new appointment, told again", async () => {
    await db
      .update(registrations)
      .set({ teamId: tigers })
      .where(eq(registrations.id, registrationId));
    const view = await appointmentsView(db, competitionId);
    expect(view.pending.map((item) => item.teamName)).toEqual(["Cup Tigers"]);
    expect(await announceAppointments(db, { competitionId, actorId: organizer })).toBe(1);
  });
});
