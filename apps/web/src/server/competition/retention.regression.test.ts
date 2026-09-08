/**
 * PERMANENT REGRESSION — the flag that was read five times and written never.
 *
 * `registrations.is_retained` has existed since migration 0018, and the schema
 * says what it means: "kept from a prior season, excluded from the pool like an
 * icon". Five surfaces believed that — the poster prints RETAINED, the public
 * showcase, the career page, the live summary's pre-signed roster, the squad
 * board's badges. Two did not: `auctionReady` filtered the pool on `isIcon`
 * alone, and `registrationStats.auctionPool` counted the same way.
 *
 * So a retained player was BOTH on the block and on their team's sheet — bid
 * for in the room while the squad-size arithmetic already counted them, and
 * announced as RETAINED on the poster afterwards. `squad-board.tsx` carries the
 * scar: it de-duplicates a player who is "BOTH pre-signed and auctioned", a
 * combination its own comment called impossible.
 *
 * It was unreachable, and that is the only reason it never happened: NOTHING
 * COULD SET THE FLAG. No toggle, no import column, no backfill — only
 * hand-written SQL. Every consequence of retaining a player was built and
 * retaining one was not possible.
 *
 * This file exists because giving the flag a writer makes a latent
 * inconsistency a live one, so the writer and the two readers landed together.
 */
import { registrationNumber } from "@desiauction/core";
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
import { auctionReady } from "../auction/auction-ready";
import {
  advanceCompetition,
  createCompetition,
  createTeam,
  resolveCompetition,
  type CompetitionSummary,
} from "./competitions";
import { createOrg } from "../orgs/orgs";
import { setRegistrationMarks } from "./registration-aggregate";
import { orphanPreSigned, registrationStats } from "./registrations";
import { purgeOrg } from "../test-support/purge-org";

const handle: DbHandle = createDb(env.DATABASE_URL);
const db = handle.db;
const sender = new DevInboxSender(db);

const RUN = String(Date.now()).slice(-7);
const PHONE_OWNER = `+9198${RUN}5`;
const SEED_PHONE_PREFIX = `+91953${RUN}`;

let owner = "";
let org = { id: "", name: "", slug: "" };
let comp: CompetitionSummary;
let teamId = "";
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

/** An approved registration, optionally already on a team. */
async function seedApproved(
  name: string,
  phoneSuffix: string,
  onTeam: string | null = null,
): Promise<string> {
  const personId = newId();
  await db
    .insert(people)
    .values({ id: personId, phone: `${SEED_PHONE_PREFIX}${phoneSuffix}`, name });
  seededPersonIds.push(personId);
  const id = newId();
  await db.insert(registrationsTable).values({
    id,
    orgId: org.id,
    competitionId: comp.id,
    personId,
    role: "batter",
    status: "approved",
    teamId: onTeam,
    registrationNumber: registrationNumber(id),
  });
  return id;
}

beforeAll(async () => {
  owner = await login(PHONE_OWNER);
  org = await createOrg(db, owner, `Retention Org ${RUN}`);
  const created = await createCompetition(db, org.id, owner, {
    sport: "cricket",
    name: `Retention Cup ${RUN}`,
    // The doc-44 identity minimums, without which setup → registration_open
    // fails its guard.
    location: "Malad",
    startsOn: "2026-08-01",
    endsOn: "2026-09-15",
  });
  comp = created;
  const team = await createTeam(db, org.id, comp.id, owner, `Retention XI ${RUN}`, "RXI");
  if (!team.ok) {
    throw new Error(`could not create the team: ${team.reason}`);
  }
  teamId = team.team.id;
  // The pool projection only reports on a season whose intake has closed.
  for (const status of ["setup", "registration_open", "registration_closed"] as const) {
    const current = await resolveCompetition(db, owner, comp.slug);
    if (current === null) {
      throw new Error("competition vanished");
    }
    const advanced = await advanceCompetition(db, current, owner, status);
    if (!advanced.ok) {
      throw new Error(`could not reach ${status}: ${JSON.stringify(advanced)}`);
    }
  }
  const settled = await resolveCompetition(db, owner, comp.slug);
  if (settled === null) {
    throw new Error("competition vanished");
  }
  comp = settled;
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

describe("RETENTION — the mark an organizer can finally set", () => {
  it("writes the flag, and clears it again", async () => {
    const id = await seedApproved("Retain Ravi", "r01", teamId);
    expect(
      await setRegistrationMarks(db, org.id, comp.id, id, { isRetained: true }, owner),
    ).toEqual({ ok: true });
    expect(await retainedOf(id)).toBe(true);
    expect(
      await setRegistrationMarks(db, org.id, comp.id, id, { isRetained: false }, owner),
    ).toEqual({ ok: true });
    expect(await retainedOf(id)).toBe(false);
  });

  it("lets a retained player wear the armband, unlike an Icon", async () => {
    /*
     * The icon/captain refusal is a rule about two competing answers to ONE
     * question — what this player is to the team. Retention answers a different
     * question: where they came from. Retaining last season's captain is the
     * commonest retention there is, so extending that refusal by analogy would
     * block ordinary tournaments to enforce a tidiness nothing needs.
     */
    const id = await seedApproved("Retain Captain", "r02", teamId);
    expect(
      await setRegistrationMarks(
        db,
        org.id,
        comp.id,
        id,
        { isRetained: true, isCaptain: true },
        owner,
      ),
    ).toEqual({ ok: true });
    // The contrast, on the same row: Icon and Captain together is still refused.
    expect(await setRegistrationMarks(db, org.id, comp.id, id, { isIcon: true }, owner)).toEqual({
      ok: false,
      reason: "icon_and_captain",
    });
  });
});

describe("RETENTION — the two readers that disagreed with the schema", () => {
  it("takes a retained player off the block", async () => {
    const before = await auctionReady(db, comp);
    const id = await seedApproved("Retain Rohit", "r03", teamId);
    const withPlayer = await auctionReady(db, comp);
    expect(withPlayer.pool.length).toBe(before.pool.length + 1);

    await setRegistrationMarks(db, org.id, comp.id, id, { isRetained: true }, owner);
    const retained = await auctionReady(db, comp);
    // THE DEFECT: this used to stay at `before.pool.length + 1`. The player was
    // bid for in the room and counted onto their team's sheet at the same time.
    expect(retained.pool.map((entry) => entry.registrationId)).not.toContain(id);
    expect(retained.pool.length).toBe(before.pool.length);
  });

  it("counts the pool the way the auction does, so two tabs cannot disagree", async () => {
    const id = await seedApproved("Retain Rahul", "r04", teamId);
    const before = await registrationStats(db, comp.id);
    await setRegistrationMarks(db, org.id, comp.id, id, { isRetained: true }, owner);
    const after = await registrationStats(db, comp.id);

    expect(after.approved).toBe(before.approved);
    expect(after.retained).toBe(before.retained + 1);
    expect(after.auctionPool).toBe(before.auctionPool - 1);

    // The identity the tile's own hint prints: approved, minus both pre-signed
    // marks, is what auction night contains — and it agrees with the projection
    // rather than merely looking plausible.
    expect(after.auctionPool + after.icons + after.retained).toBe(after.approved);
    const ready = await auctionReady(db, comp);
    expect(ready.pool.length).toBe(after.auctionPool);
  });
});

describe("RETENTION — the player a season can silently lose", () => {
  it("names a retained player with no team, the way it names a teamless icon", async () => {
    /*
     * A pre-signed player with no team vanishes twice: `auctionReady` drops them
     * from the pool and `preSignedPlayers` discards null-team rows. They are in
     * no auction and no squad — approved, and nowhere. The warning covered icons
     * only, which was safe exactly as long as retention had no writer.
     */
    const id = await seedApproved("Retain Orphan", "r05", null);
    await setRegistrationMarks(db, org.id, comp.id, id, { isRetained: true }, owner);
    const orphans = await orphanPreSigned(db, comp.id);
    expect(orphans.map((row) => row.id)).toContain(id);
    expect(orphans.find((row) => row.id === id)?.kind).toBe("retained");
  });

  it("says nothing about a retained player who has a team", async () => {
    const id = await seedApproved("Retain Settled", "r06", teamId);
    await setRegistrationMarks(db, org.id, comp.id, id, { isRetained: true }, owner);
    expect((await orphanPreSigned(db, comp.id)).map((row) => row.id)).not.toContain(id);
  });

  it("calls a player who is both an Icon and retained an Icon, once", async () => {
    // One row, one description. `outcomeOf` on the poster gives Icon the same
    // precedence, so no two surfaces can name the same player differently.
    const id = await seedApproved("Retain Marquee", "r07", null);
    await setRegistrationMarks(db, org.id, comp.id, id, { isRetained: true, isIcon: true }, owner);
    const mine = (await orphanPreSigned(db, comp.id)).filter((row) => row.id === id);
    expect(mine.length).toBe(1);
    expect(mine[0]?.kind).toBe("icon");
  });
});

async function retainedOf(id: string): Promise<boolean> {
  const [row] = await db
    .select({ isRetained: registrationsTable.isRetained })
    .from(registrationsTable)
    .where(eq(registrationsTable.id, id))
    .limit(1);
  return row?.isRetained ?? false;
}
