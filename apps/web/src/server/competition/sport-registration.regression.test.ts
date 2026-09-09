/**
 * PERMANENT REGRESSION — the sports that shipped with the door locked.
 *
 * SP-1 built four sport packs and wired the picker, the registration form, the
 * standings, the terminology and the auction to read them. Migration 0047
 * opened `registrations.role` — no enum, nullable — with a comment that says
 * exactly why: "a column-level list could only ever name one sport's" roles.
 *
 * Everything in FRONT of that column still asked cricket. `evaluateRegistration`
 * called `parseRole` (`parseRoleIn(CRICKET)`), `submitRegistration`'s own
 * defence-in-depth check called `isRegistrationRole` (cricket again), and
 * `validateNewPlayer` — the one validation truth behind both the CSV import and
 * the organizer's add-by-hand dialog — called `parseRole` too.
 *
 * So a football player picking "Midfielder" on a form the FOOTBALL PACK had
 * drawn was refused `invalid_role`, twice over; a football roster imported zero
 * rows; and adding one by hand failed the same way. Three of the four shipped
 * sports could not admit a single player by any route.
 *
 * This file is the proof that each route is open, and still shut to a role the
 * season's sport does not have.
 */
import { parseRegistrationCsv, sportPackFor } from "@desiauction/core";
import {
  auditLog,
  competitions as competitionsTable,
  createDb,
  grants as grantsTable,
  newId,
  organizations,
  orgMembers,
  otpCodes,
  otpInbox,
  people,
  registrations as registrationsTable,
  sessions,
  teams as teamsTable,
  type DbHandle,
} from "@desiauction/db";
import { desc, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { env } from "../../env";
import { requestOtp, verifyOtp } from "../auth/otp";
import { DevInboxSender } from "../auth/otp-sender";
import { advanceCompetition, createCompetition, resolveCompetition } from "./competitions";
import { createOrg } from "../orgs/orgs";
import { commitRegistrationImport } from "./registration-import";
import { addPlayerByPhone, submitRegistration } from "./registrations";
import { purgeOrg } from "../test-support/purge-org";

const handle: DbHandle = createDb(env.DATABASE_URL);
const db = handle.db;
const sender = new DevInboxSender(db);

const RUN = String(Date.now()).slice(-7);
const PHONE_OWNER = `+9198${RUN}4`;

let owner = "";
let org = { id: "", name: "", slug: "" };
let football = "";
let cricket = "";
const seededPersonIds: string[] = [];

async function login(phone: string): Promise<string> {
  await requestOtp(db, sender, phone);
  const [row] = await db
    .select()
    .from(otpInbox)
    .where(eq(otpInbox.phone, phone))
    .orderBy(desc(otpInbox.createdAt))
    .limit(1);
  const verified = await verifyOtp(db, phone, row?.code ?? "");
  if (!verified.ok) {
    throw new Error("login failed");
  }
  return verified.personId;
}

/** A season of the given sport, open for intake. */
async function openSeason(sport: string, name: string): Promise<string> {
  const created = await createCompetition(db, org.id, owner, {
    sport,
    name,
    location: "Malad",
    startsOn: "2026-08-01",
    endsOn: "2026-09-15",
  });
  for (const status of ["setup", "registration_open"] as const) {
    const current = await resolveCompetition(db, owner, created.slug);
    if (current === null) {
      throw new Error("competition vanished");
    }
    const advanced = await advanceCompetition(db, current, owner, status);
    if (!advanced.ok) {
      throw new Error(`could not reach ${status}: ${JSON.stringify(advanced)}`);
    }
  }
  return created.id;
}

/** A person with no registrations, to walk through a door. */
async function person(name: string, suffix: string): Promise<string> {
  const id = newId();
  await db.insert(people).values({ id, phone: `+91954${RUN}${suffix}`, name });
  seededPersonIds.push(id);
  return id;
}

beforeAll(async () => {
  owner = await login(PHONE_OWNER);
  org = await createOrg(db, owner, `Sport Door Org ${RUN}`);
  football = await openSeason("football", `Football Cup ${RUN}`);
  cricket = await openSeason("cricket", `Cricket Cup ${RUN}`);
});

afterAll(async () => {
  if (org.id !== "") {
    await purgeOrg(db, org.id);
    await db.delete(registrationsTable).where(eq(registrationsTable.orgId, org.id));
    await db.delete(teamsTable).where(eq(teamsTable.orgId, org.id));
    await db.delete(competitionsTable).where(eq(competitionsTable.orgId, org.id));
    await db.delete(grantsTable).where(eq(grantsTable.scopeId, org.id));
    await db.delete(orgMembers).where(eq(orgMembers.orgId, org.id));
    await db.delete(auditLog).where(eq(auditLog.scopeId, org.id));
    await db.delete(organizations).where(eq(organizations.id, org.id));
  }
  const personIds = [owner, ...seededPersonIds].filter((id) => id !== "");
  if (personIds.length > 0) {
    await db.delete(sessions).where(inArray(sessions.personId, personIds));
    await db.delete(auditLog).where(inArray(auditLog.actor, personIds));
    await db.delete(people).where(inArray(people.id, personIds));
  }
  await db.delete(otpCodes).where(eq(otpCodes.phone, PHONE_OWNER));
  await db.delete(otpInbox).where(eq(otpInbox.phone, PHONE_OWNER));
  await handle.sql.end();
});

describe("SPORT DOORS — a player can enter a season that is not cricket", () => {
  it("self-registration takes a football role", async () => {
    // Returned `invalid_role` for every football role there is.
    const personId = await person("Midfield Mo", "01");
    const result = await submitRegistration(db, football, org.id, personId, "midfielder");
    expect(result).toMatchObject({ ok: true });
  });

  it("self-registration still refuses a role the season's sport does not have", async () => {
    // The fix must not have widened the door to "anything goes": a cricket role
    // in a football season is exactly as wrong as gibberish.
    const personId = await person("Keeper Kay", "02");
    expect(await submitRegistration(db, football, org.id, personId, "wicket_keeper")).toEqual({
      ok: false,
      reason: "invalid_role",
    });
    expect(await submitRegistration(db, football, org.id, personId, "banana")).toEqual({
      ok: false,
      reason: "invalid_role",
    });
  });

  it("and a cricket season still refuses a football role", async () => {
    const personId = await person("Wrong Sport", "03");
    expect(await submitRegistration(db, cricket, org.id, personId, "midfielder")).toEqual({
      ok: false,
      reason: "invalid_role",
    });
  });

  it("the organizer can add a football player by hand", async () => {
    const result = await addPlayerByPhone(db, football, org.id, owner, {
      name: "Winger Wes",
      phone: `+91954${RUN}04`,
      role: "forward",
      basePriceBand: null,
    });
    expect(result).toMatchObject({ ok: true });
    const [row] = await db
      .select({ id: people.id })
      .from(people)
      .where(eq(people.phone, `+91954${RUN}04`));
    seededPersonIds.push(row?.id ?? "");
  });

  it("a football roster imports, spellings and all", async () => {
    /*
     * The whole file used to fail: "invalid role" on every line, so an
     * organizer's only reading was that their roster was wrong. "CB" is the
     * football pack's own alias for defender — the aliases existed the whole
     * time, and nothing asked the pack.
     */
    const csv =
      "name,phone,role\n" +
      `Striker Sam,95${RUN}5,forward\n` +
      `Back Bob,95${RUN}6,CB\n` +
      `Keeper Ken,95${RUN}7,goalkeeper`;
    const parsed = parseRegistrationCsv(csv, undefined, { pack: sportPackFor("football") });
    expect(parsed.errors).toEqual([]);
    expect(await commitRegistrationImport(db, football, org.id, owner, parsed.rows)).toMatchObject({
      imported: 3,
    });
    const stored = await db
      .select({ id: people.id, role: registrationsTable.role })
      .from(registrationsTable)
      .innerJoin(people, eq(people.id, registrationsTable.personId))
      .where(eq(registrationsTable.competitionId, football));
    seededPersonIds.push(...stored.map((row) => row.id));
    // The alias landed as the pack's key, not as the spelling the file used.
    expect(stored.map((row) => row.role)).toContain("defender");
  });
});
