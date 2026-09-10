// PERMANENT REGISTRATION-OPS REGRESSION SUITE (M-IP3-2). Encodes the operations
// contract: bulk transitions identical to N individual actions, bulk rollback
// safety, CSV import validation, deterministic search/sort/pagination, statistics,
// duplicate detection, export tenant-scoping + authorization, and audit
// completeness. Real Postgres; unique phones/org per run.
import { parseRegistrationCsv, registrationNumber } from "@desiauction/core";
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
  type Db,
  type DbHandle,
} from "@desiauction/db";
import { and, desc, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { env } from "../../env";
import { requestOtp, verifyOtp } from "../auth/otp";
import { DevInboxSender } from "../auth/otp-sender";
import { canCompetition } from "./authz";
import { createCompetition, createTeam } from "./competitions";
import { createOrg } from "../orgs/orgs";
import {
  addNote,
  setRegistrationMarks,
  transition,
  transitionBatch,
} from "./registration-aggregate";
import { commitRegistrationImport } from "./registration-import";
import {
  addPlayerByPhone,
  duplicateNameKeys,
  exportRegistrationsCsv,
  myRegistration,
  kitSummary,
  photoTargetsOf,
  queryRegistrations,
  registrationStats,
  submitRegistration,
  timelineOf,
} from "./registrations";
import { purgeOrg } from "../test-support/purge-org";

const handle: DbHandle = createDb(env.DATABASE_URL);
const db = handle.db;
const sender = new DevInboxSender(db);

const RUN = String(Date.now()).slice(-7);
const PHONE_OWNER = `+9198${RUN}7`;
const PHONE_OUTSIDER = `+9196${RUN}8`;
const TEST_PHONES = [PHONE_OWNER, PHONE_OUTSIDER];
const SEED_PHONE_PREFIX = `+91955${RUN}`;

let owner = "";
let outsider = "";
let org = { id: "", name: "", slug: "" };
let orgOutsider = { id: "", name: "", slug: "" };
let compId = "";
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

/** Seed a registration directly (bypasses the open-intake gate for test setup). */
async function seed(
  competitionId: string,
  orgId: string,
  name: string,
  phoneSuffix: string,
  status: "submitted" | "waitlisted" | "approved" | "rejected" = "submitted",
): Promise<string> {
  const personId = newId();
  await db
    .insert(people)
    .values({ id: personId, phone: `${SEED_PHONE_PREFIX}${phoneSuffix}`, name });
  seededPersonIds.push(personId);
  const id = newId();
  await db.insert(registrationsTable).values({
    id,
    orgId,
    competitionId,
    personId,
    role: "batter",
    status,
    registrationNumber: registrationNumber(id),
  });
  return id;
}

beforeAll(async () => {
  owner = await login(PHONE_OWNER);
  outsider = await login(PHONE_OUTSIDER);
  org = await createOrg(db, owner, `Ops Org ${RUN}`);
  orgOutsider = await createOrg(db, outsider, `Ops Rival ${RUN}`);
  const competition = await createCompetition(db, org.id, owner, {
    sport: "cricket",
    name: `Ops Cup ${RUN}`,
  });
  compId = competition.id;
});

afterAll(async () => {
  const orgIds = [org.id, orgOutsider.id].filter((id) => id !== "");
  // PA-1R Phase 3: the spine these teardowns never deleted (purge-org.ts).
  for (const purgeId of orgIds) {
    await purgeOrg(db, purgeId);
  }
  const personIds = [owner, outsider, ...seededPersonIds].filter((id) => id !== "");
  if (orgIds.length > 0) {
    await db.delete(registrationsTable).where(inArray(registrationsTable.orgId, orgIds));
    await db.delete(teamsTable).where(inArray(teamsTable.orgId, orgIds));
    await db.delete(competitionsTable).where(inArray(competitionsTable.orgId, orgIds));
    await db.delete(grantsTable).where(inArray(grantsTable.scopeId, orgIds));
    await db.delete(orgMembers).where(inArray(orgMembers.orgId, orgIds));
    await db.delete(auditLog).where(inArray(auditLog.scopeId, [...orgIds, ...personIds]));
    await db.delete(organizations).where(inArray(organizations.id, orgIds));
  }
  if (personIds.length > 0) {
    await db.delete(sessions).where(inArray(sessions.personId, personIds));
    await db.delete(auditLog).where(inArray(auditLog.actor, personIds));
    await db.delete(people).where(inArray(people.id, personIds));
  }
  await db.delete(otpCodes).where(inArray(otpCodes.phone, TEST_PHONES));
  await db.delete(otpInbox).where(inArray(otpInbox.phone, TEST_PHONES));
  await handle.sql.end();
});

async function statusOf(db_: Db, id: string): Promise<string> {
  const [row] = await db_
    .select({ status: registrationsTable.status })
    .from(registrationsTable)
    .where(eq(registrationsTable.id, id))
    .limit(1);
  return row?.status ?? "missing";
}

describe("REGISTRATION OPS REGRESSION — operations contract", () => {
  it("bulk approve behaves identically to N individual approvals", async () => {
    const a = await seed(compId, org.id, "Bulk A", "b01", "submitted");
    const b = await seed(compId, org.id, "Bulk B", "b02", "waitlisted");
    const c = await seed(compId, org.id, "Bulk C", "b03", "approved"); // approve illegal
    const result = await transitionBatch(db, org.id, compId, [a, b, c], owner, {
      type: "approve",
    });
    expect(result.applied.sort()).toEqual([a, b].sort());
    expect(result.skipped).toEqual([{ id: c, reason: "illegal_transition" }]);
    expect(await statusOf(db, a)).toBe("approved");
    expect(await statusOf(db, b)).toBe("approved");
    expect(await statusOf(db, c)).toBe("approved"); // unchanged
  });

  it("bulk reject requires a reason and writes it; bulk waitlist works", async () => {
    const a = await seed(compId, org.id, "Rej A", "r01", "submitted");
    const b = await seed(compId, org.id, "Rej B", "r02", "submitted");
    const rejected = await transitionBatch(db, org.id, compId, [a, b], owner, {
      type: "reject",
      reason: "capacity",
    });
    expect(rejected.applied.length).toBe(2);
    const w = await seed(compId, org.id, "Wait A", "w01", "submitted");
    const waited = await transitionBatch(db, org.id, compId, [w], owner, { type: "waitlist" });
    expect(waited.applied).toEqual([w]);
    expect(await statusOf(db, w)).toBe("waitlisted");
  });

  /*
   * INVARIANT 6, BOTH HALVES.
   *
   * Doc 42: "rejection requires a private reason ... reasons never render
   * publicly, ever". Doc 48: the player sees decisions about themselves,
   * "reasons excluded". The categories are spelled "duplicate, ineligible,
   * withdrew, capacity, OTHER+NOTE" — so the note is required by the same
   * sentence that makes it private.
   *
   * For a long time only the privacy half was true, and trivially: nothing
   * could supply a note, so there was nothing to leak. Now that the note can be
   * written, the privacy half needs a test rather than an accident.
   */
  describe("invariant 6 — the note is the organizer's, and only the organizer's", () => {
    const SECRET = "he was banned by the district association in 2024";

    async function personOf(registrationId: string): Promise<string> {
      const [row] = await db
        .select({ personId: registrationsTable.personId })
        .from(registrationsTable)
        .where(eq(registrationsTable.id, registrationId))
        .limit(1);
      return row?.personId ?? "";
    }

    it("stores the note, shows it to the organizer, and withholds it from the player", async () => {
      const id = await seed(compId, org.id, "Note A", "inv6a", "submitted");
      const done = await transition(db, org.id, compId, id, owner, {
        type: "reject",
        reason: "other",
        note: SECRET,
      });
      expect(done).toEqual({ ok: true, status: "rejected" });

      // The column now holds what "other" meant.
      const [stored] = await db
        .select({ note: registrationsTable.rejectionNote })
        .from(registrationsTable)
        .where(eq(registrationsTable.id, id))
        .limit(1);
      expect(stored?.note).toBe(SECRET);

      // The organizer's own projection carries it back.
      const rows = await queryRegistrations(db, compId, {
        status: "rejected",
        page: 1,
        pageSize: 50,
      });
      const mine = rows.rows.find((row) => row.id === id);
      expect(mine?.rejectionNote).toBe(SECRET);

      /*
       * And the player's does not — asserted over the WHOLE projection rather
       * than one field name, because the thing invariant 6 forbids is the
       * organizer's words reaching the player, not one particular key. A future
       * field that happened to carry them would pass a `rejectionNote`
       * undefined check and fail this one.
       */
      const theirs = await myRegistration(db, compId, await personOf(id));
      expect(theirs).not.toBeNull();
      expect(JSON.stringify(theirs)).not.toContain(SECRET);
      // The CATEGORY is theirs — a respectful sentence is built from it.
      expect(theirs?.rejectionReason).toBe("other");
    });

    it("clears the note on restore, with the rest of the rejection provenance", async () => {
      const id = await seed(compId, org.id, "Note B", "inv6b", "submitted");
      await transition(db, org.id, compId, id, owner, {
        type: "reject",
        reason: "other",
        note: SECRET,
      });
      await transition(db, org.id, compId, id, owner, { type: "restore" });
      const [row] = await db
        .select({
          reason: registrationsTable.rejectionReason,
          note: registrationsTable.rejectionNote,
        })
        .from(registrationsTable)
        .where(eq(registrationsTable.id, id))
        .limit(1);
      // A note about a decision that has been undone is a stale accusation
      // sitting on a live registration.
      expect(row?.reason).toBeNull();
      expect(row?.note).toBeNull();
    });

    it("leaves the note null when the organizer gave none", async () => {
      const id = await seed(compId, org.id, "Note C", "inv6c", "submitted");
      await transition(db, org.id, compId, id, owner, { type: "reject", reason: "capacity" });
      const [row] = await db
        .select({ note: registrationsTable.rejectionNote })
        .from(registrationsTable)
        .where(eq(registrationsTable.id, id))
        .limit(1);
      // Null, not "": "they wrote nothing down" rather than "they wrote nothing".
      expect(row?.note).toBeNull();
    });
  });

  it("restore returns a rejected registration to submitted (the only exit)", async () => {
    const a = await seed(compId, org.id, "Restore A", "x01", "rejected");
    const restored = await transition(db, org.id, compId, a, owner, { type: "restore" });
    expect(restored).toEqual({ ok: true, status: "submitted" });
    // Rejection provenance is cleared on restore.
    const [row] = await db
      .select({ reason: registrationsTable.rejectionReason })
      .from(registrationsTable)
      .where(eq(registrationsTable.id, a))
      .limit(1);
    expect(row?.reason).toBeNull();
  });

  it("a withdrawn registration does not block a rejoin; a live one still does", async () => {
    // Its own season, opened for intake, so the rest of the suite's competition
    // keeps its state.
    const season = await createCompetition(db, org.id, owner, {
      sport: "cricket",
      name: `Rejoin Cup ${RUN}`,
    });
    await db
      .update(competitionsTable)
      .set({ status: "registration_open" })
      .where(eq(competitionsTable.id, season.id));
    const personId = newId();
    await db
      .insert(people)
      .values({ id: personId, phone: `${SEED_PHONE_PREFIX}j01`, name: "Rejoin Raju" });
    seededPersonIds.push(personId);

    const first = await submitRegistration(db, season.id, org.id, personId, "batter");
    expect(first.ok).toBe(true);
    const regId = first.ok ? first.registrationId : "";
    const [before] = await db
      .select({ number: registrationsTable.registrationNumber })
      .from(registrationsTable)
      .where(eq(registrationsTable.id, regId))
      .limit(1);

    // A LIVE registration still refuses a second one — the duplicate rule stands.
    expect(await submitRegistration(db, season.id, org.id, personId, "bowler")).toEqual({
      ok: false,
      reason: "duplicate",
    });

    // The player withdraws (by mistake, as far as the product knows) …
    expect(await transition(db, org.id, season.id, regId, personId, { type: "withdraw" })).toEqual({
      ok: true,
      status: "withdrawn",
    });

    // … and may rejoin. The SAME row is reinstated: one registration per player
    // per season is still true, and the registration number they quote is still
    // the one they were given.
    const rejoined = await submitRegistration(db, season.id, org.id, personId, "bowler");
    expect(rejoined).toEqual({ ok: true, registrationId: regId });
    const rows = await db
      .select({
        id: registrationsTable.id,
        status: registrationsTable.status,
        role: registrationsTable.role,
        number: registrationsTable.registrationNumber,
        reviewedBy: registrationsTable.reviewedBy,
      })
      .from(registrationsTable)
      .where(
        and(
          eq(registrationsTable.competitionId, season.id),
          eq(registrationsTable.personId, personId),
        ),
      );
    expect(rows.length).toBe(1);
    expect(rows[0]?.status).toBe("submitted");
    expect(rows[0]?.role).toBe("bowler"); // the fresh application's answers win
    expect(rows[0]?.number).toBe(before?.number);
    expect(rows[0]?.reviewedBy).toBeNull(); // back in triage, unreviewed

    // Apply → withdraw → rejoin is ONE timeline, and the rejoin says what it is.
    const timeline = await timelineOf(db, regId, season.id);
    const actions = timeline.map((entry) => entry.action).sort();
    expect(actions).toEqual([
      "registration.submitted",
      "registration.submitted",
      "registration.withdraw",
    ]);
    expect(
      timeline.some(
        (entry) => (entry.meta as { reinstated?: string } | null)?.reinstated === "true",
      ),
    ).toBe(true);

    // And the reinstated registration is live again, so it blocks the next one.
    expect(await submitRegistration(db, season.id, org.id, personId, "batter")).toEqual({
      ok: false,
      reason: "duplicate",
    });

    // A REJECTED registration is the organizer's decision and is NOT overturned
    // by re-applying — only withdrawal reinstates.
    expect(
      await transition(db, org.id, season.id, regId, owner, { type: "reject", reason: "capacity" }),
    ).toEqual({ ok: true, status: "rejected" });
    expect(await submitRegistration(db, season.id, org.id, personId, "batter")).toEqual({
      ok: false,
      reason: "duplicate",
    });
  });

  it("BULK ROLLBACK SAFETY: a mid-batch failure leaves NO partial state", async () => {
    const a = await seed(compId, org.id, "Rollback A", "k01", "submitted");
    const b = await seed(compId, org.id, "Rollback B", "k02", "submitted");
    // An over-length orgId makes the audit insert fail (char(26)); the whole
    // transaction must roll back, leaving both registrations untouched.
    const badOrgId = "THIS_ORG_ID_IS_WAY_TOO_LONG_FOR_CHAR_26";
    await expect(
      transitionBatch(db, badOrgId, compId, [a, b], owner, { type: "approve" }),
    ).rejects.toThrow();
    expect(await statusOf(db, a)).toBe("submitted");
    expect(await statusOf(db, b)).toBe("submitted");
  });

  it("every transition writes exactly one audit row (audit completeness)", async () => {
    const a = await seed(compId, org.id, "Audit A", "a01", "submitted");
    await transition(db, org.id, compId, a, owner, { type: "waitlist" });
    await transition(db, org.id, compId, a, owner, { type: "approve" });
    await addNote(db, org.id, a, owner, "checked ID");
    const timeline = await timelineOf(db, a, compId);
    const actions = timeline.map((t) => t.action);
    expect(actions).toContain("registration.waitlist");
    expect(actions).toContain("registration.approve");
    expect(actions).toContain("registration.note");
    // Ordered oldest→newest.
    expect(timeline.map((t) => t.at.getTime())).toEqual(
      [...timeline.map((t) => t.at.getTime())].sort((x, y) => x - y),
    );
  });

  // Valid Indian-mobile digits (normalizePhone runs on CSV import, unlike seeds).
  const IMPORT_PHONE_1 = `98${RUN}0`; // 10 digits, starts 9
  const IMPORT_PHONE_2 = `98${RUN}1`;

  it("CSV import creates person stubs + submitted registrations, atomically", async () => {
    const csv =
      "name,phone,role,base_price_band\n" +
      `Import One,${IMPORT_PHONE_1},batter,A\n` +
      `Import Two,+91 ${IMPORT_PHONE_2},bowler,`;
    const parsed = parseRegistrationCsv(csv);
    expect(parsed.errors).toEqual([]);
    const before = (await registrationStats(db, compId)).total;
    const result = await commitRegistrationImport(db, compId, org.id, owner, parsed.rows);
    expect(result.imported).toBe(2);
    const created = await db
      .select({ id: people.id })
      .from(people)
      .where(inArray(people.phone, [`+91${IMPORT_PHONE_1}`, `+91${IMPORT_PHONE_2}`]));
    seededPersonIds.push(...created.map((p) => p.id));
    expect((await registrationStats(db, compId)).total).toBe(before + 2);
  });

  it("CSV import re-run skips already-registered people (no duplicate corruption)", async () => {
    const csv = `name,phone,role\nImport One,${IMPORT_PHONE_1},batter`;
    const parsed = parseRegistrationCsv(csv);
    const result = await commitRegistrationImport(db, compId, org.id, owner, parsed.rows);
    // The file agrees with what is stored, so the row is READ and left alone —
    // not inserted again, and no longer reported as a nameless "duplicate".
    expect(result).toEqual({ imported: 0, updated: 0, unchanged: 1, reinstated: 0, named: 0 });
  });

  /*
   * PHASE 3 — the second file, which is the normal case. Before this the commit
   * path only ever INSERTED: a corrected roster did nothing at all and reported
   * the whole squad as duplicates, so every fix stayed in the spreadsheet.
   */
  it("a corrected re-import UPDATES the registration instead of doing nothing", async () => {
    const phone = `98${RUN}9`;
    const first = `name,phone,role,tshirt_size\nRe Import,${phone},batter,`;
    await commitRegistrationImport(db, compId, org.id, owner, parseRegistrationCsv(first).rows);
    const [person] = await db
      .select({ id: people.id })
      .from(people)
      .where(eq(people.phone, `+91${phone}`))
      .limit(1);
    if (person === undefined) {
      throw new Error("the imported person should exist");
    }
    seededPersonIds.push(person.id);

    // The club sends the sheet again, with the role fixed and a size added.
    const second = `name,phone,role,tshirt_size\nRe Import,${phone},all_rounder,L`;
    const result = await commitRegistrationImport(
      db,
      compId,
      org.id,
      owner,
      parseRegistrationCsv(second).rows,
    );
    expect(result).toEqual({ imported: 0, updated: 1, unchanged: 0, reinstated: 0, named: 0 });

    const read = async (): Promise<unknown> => {
      const [row] = await db
        .select({
          role: registrationsTable.role,
          tshirtSize: registrationsTable.tshirtSize,
          status: registrationsTable.status,
        })
        .from(registrationsTable)
        .where(
          and(
            eq(registrationsTable.competitionId, compId),
            eq(registrationsTable.personId, person.id),
          ),
        )
        .limit(1);
      return row;
    };
    /*
     * The BLANK was filled and the SET value was protected — which is the whole
     * of rule 2. The size lands because nothing was there; the role does not,
     * because a stale sheet must not quietly overturn a value already recorded.
     * Correcting a role is what "let this file win" is for, below.
     */
    expect(await read()).toEqual({ role: "batter", tshirtSize: "L", status: "submitted" });

    const forced = await commitRegistrationImport(
      db,
      compId,
      org.id,
      owner,
      parseRegistrationCsv(second).rows,
      "file-wins",
    );
    expect(forced.updated).toBe(1);
    expect(await read()).toEqual({ role: "all_rounder", tshirtSize: "L", status: "submitted" });
  });

  it("a re-import does NOT revert a value the organizer edited by hand", async () => {
    const phone = `94${RUN}1`;
    const first = `name,phone,role,tshirt_size\nHand Edit,${phone},batter,M`;
    await commitRegistrationImport(db, compId, org.id, owner, parseRegistrationCsv(first).rows);
    const [person] = await db
      .select({ id: people.id })
      .from(people)
      .where(eq(people.phone, `+91${phone}`))
      .limit(1);
    if (person === undefined) {
      throw new Error("the imported person should exist");
    }
    seededPersonIds.push(person.id);
    // The organizer corrects the size in the app.
    await db
      .update(registrationsTable)
      .set({ tshirtSize: "XL" })
      .where(
        and(
          eq(registrationsTable.competitionId, compId),
          eq(registrationsTable.personId, person.id),
        ),
      );

    // The club's sheet still holds the OLD size. The default must not revert it.
    const stale = `name,phone,role,tshirt_size\nHand Edit,${phone},batter,M`;
    const kept = await commitRegistrationImport(
      db,
      compId,
      org.id,
      owner,
      parseRegistrationCsv(stale).rows,
    );
    expect(kept.unchanged).toBe(1);
    const sizeNow = async (): Promise<string | null> => {
      const [row] = await db
        .select({ tshirtSize: registrationsTable.tshirtSize })
        .from(registrationsTable)
        .where(
          and(
            eq(registrationsTable.competitionId, compId),
            eq(registrationsTable.personId, person.id),
          ),
        )
        .limit(1);
      return row?.tshirtSize ?? null;
    };
    expect(await sizeNow()).toBe("XL");

    // ...and DOES revert it when the organizer explicitly asks the file to win.
    const forced = await commitRegistrationImport(
      db,
      compId,
      org.id,
      owner,
      parseRegistrationCsv(stale).rows,
      "file-wins",
    );
    expect(forced.updated).toBe(1);
    expect(await sizeNow()).toBe("M");
  });

  it("a re-import never changes an approved player's status", async () => {
    const phone = `94${RUN}2`;
    const csv = `name,phone,role\nApproved Player,${phone},batter`;
    await commitRegistrationImport(db, compId, org.id, owner, parseRegistrationCsv(csv).rows);
    const [person] = await db
      .select({ id: people.id })
      .from(people)
      .where(eq(people.phone, `+91${phone}`))
      .limit(1);
    if (person === undefined) {
      throw new Error("the imported person should exist");
    }
    seededPersonIds.push(person.id);
    const [reg] = await db
      .select({ id: registrationsTable.id })
      .from(registrationsTable)
      .where(
        and(
          eq(registrationsTable.competitionId, compId),
          eq(registrationsTable.personId, person.id),
        ),
      )
      .limit(1);
    if (reg === undefined) {
      throw new Error("the registration should exist");
    }
    await transition(db, org.id, compId, reg.id, owner, { type: "approve" });
    expect(await statusOf(db, reg.id)).toBe("approved");

    // The roster is uploaded again, with a corrected role.
    const again = `name,phone,role\nApproved Player,${phone},bowler`;
    await commitRegistrationImport(
      db,
      compId,
      org.id,
      owner,
      parseRegistrationCsv(again).rows,
      "file-wins",
    );
    // The ROLE moves; the decision an organizer made does not.
    expect(await statusOf(db, reg.id)).toBe("approved");
  });

  /*
   * PHASE 0 — the import path had drifted from the two paths it claims to
   * mirror. Both cases below were silent: nothing errored, the counts looked
   * plausible, and the organizer had no way to see what had not happened.
   */
  it("CSV import reinstates a withdrawn player instead of calling them a duplicate", async () => {
    const [registration] = await db
      .select({ id: registrationsTable.id, personId: registrationsTable.personId })
      .from(registrationsTable)
      .innerJoin(people, eq(people.id, registrationsTable.personId))
      .where(
        and(eq(registrationsTable.competitionId, compId), eq(people.phone, `+91${IMPORT_PHONE_1}`)),
      )
      .limit(1);
    if (registration === undefined) {
      throw new Error("the imported registration should exist by now");
    }
    const withdrawn = await transition(db, org.id, compId, registration.id, owner, {
      type: "withdraw",
    });
    expect(withdrawn.ok).toBe(true);

    // The organizer's final sheet still lists them — because they came back.
    const csv = `name,phone,role\nImport One,${IMPORT_PHONE_1},all_rounder`;
    const parsed = parseRegistrationCsv(csv);
    const result = await commitRegistrationImport(db, compId, org.id, owner, parsed.rows);
    expect(result).toEqual({ imported: 0, updated: 0, unchanged: 0, reinstated: 1, named: 0 });

    const [after] = await db
      .select({ status: registrationsTable.status, role: registrationsTable.role })
      .from(registrationsTable)
      .where(eq(registrationsTable.id, registration.id))
      .limit(1);
    // Back in triage on their ORIGINAL row, carrying the file's fresh role —
    // not a second registration, and not still withdrawn.
    expect(after?.status).toBe("submitted");
    expect(after?.role).toBe("all_rounder");
  });

  it("CSV import names an existing nameless stub, and never renames a named person", async () => {
    const stubPhone = `+9198${RUN}5`;
    const stubId = newId();
    await db.insert(people).values({ id: stubId, phone: stubPhone, name: null });
    seededPersonIds.push(stubId);

    const csv = `name,phone,role\nNamed By File,98${RUN}5,batter`;
    const first = await commitRegistrationImport(
      db,
      compId,
      org.id,
      owner,
      parseRegistrationCsv(csv).rows,
    );
    expect(first).toEqual({ imported: 1, updated: 0, unchanged: 0, reinstated: 0, named: 1 });
    const [named] = await db
      .select({ name: people.name })
      .from(people)
      .where(eq(people.id, stubId))
      .limit(1);
    expect(named?.name).toBe("Named By File");

    // A second file disagreeing about their name does NOT get to correct it.
    const rename = `name,phone,role\nSomebody Else,98${RUN}5,batter`;
    await commitRegistrationImport(db, compId, org.id, owner, parseRegistrationCsv(rename).rows);
    const [unchanged] = await db
      .select({ name: people.name })
      .from(people)
      .where(eq(people.id, stubId))
      .limit(1);
    expect(unchanged?.name).toBe("Named By File");
  });

  /*
   * PHASE 2 — the desk columns a club's form already collects, which until
   * migration 0034 had nowhere to land and stayed in the spreadsheet.
   */
  it("CSV import stores the fee, the reference and the organizer's note", async () => {
    const phone = `98${RUN}6`;
    const csv =
      "name,phone,role,fee_status,fee_amount,fee_reference,note,tshirt_size\n" +
      `Desk Player,${phone},batter,Yes,"1,500",UTR123456789,Paid at the ground in cash,L`;
    const parsed = parseRegistrationCsv(csv);
    expect(parsed.errors).toEqual([]);
    // Rupees on the page become integer paise in the row (C-7, no floats).
    expect(parsed.rows[0]?.feeAmountPaise).toBe(150000);
    expect(parsed.rows[0]?.feeStatus).toBe("paid");

    const result = await commitRegistrationImport(db, compId, org.id, owner, parsed.rows);
    expect(result.imported).toBe(1);
    const [person] = await db
      .select({ id: people.id })
      .from(people)
      .where(eq(people.phone, `+91${phone}`))
      .limit(1);
    if (person === undefined) {
      throw new Error("the imported person should exist");
    }
    seededPersonIds.push(person.id);

    const [stored] = await db
      .select({
        feeStatus: registrationsTable.feeStatus,
        feeAmountPaise: registrationsTable.feeAmountPaise,
        feeReference: registrationsTable.feeReference,
        note: registrationsTable.note,
        tshirtSize: registrationsTable.tshirtSize,
      })
      .from(registrationsTable)
      .where(
        and(
          eq(registrationsTable.competitionId, compId),
          eq(registrationsTable.personId, person.id),
        ),
      )
      .limit(1);
    expect(stored).toEqual({
      feeStatus: "paid",
      feeAmountPaise: 150000,
      feeReference: "UTR123456789",
      note: "Paid at the ground in cash",
      tshirtSize: "L",
    });
  });

  it("a fee column it cannot read is a line error, never a silent 'unpaid'", () => {
    const csv = "name,phone,role,fee_amount\n" + `Bad Fee,98${RUN}7,batter,about five hundred`;
    const parsed = parseRegistrationCsv(csv);
    expect(parsed.rows).toEqual([]);
    expect(parsed.errors[0]?.message).toMatch(/fee amount/i);
  });

  it("defaults a registration nobody priced to pending, not paid", async () => {
    const phone = `98${RUN}8`;
    const csv = `name,phone,role\nNo Fee Column,${phone},batter`;
    const parsed = parseRegistrationCsv(csv);
    await commitRegistrationImport(db, compId, org.id, owner, parsed.rows);
    const [person] = await db
      .select({ id: people.id })
      .from(people)
      .where(eq(people.phone, `+91${phone}`))
      .limit(1);
    if (person === undefined) {
      throw new Error("the imported person should exist");
    }
    seededPersonIds.push(person.id);
    const [stored] = await db
      .select({
        feeStatus: registrationsTable.feeStatus,
        feeAmountPaise: registrationsTable.feeAmountPaise,
      })
      .from(registrationsTable)
      .where(
        and(
          eq(registrationsTable.competitionId, compId),
          eq(registrationsTable.personId, person.id),
        ),
      )
      .limit(1);
    // No amount recorded is NOT zero — a waived fee and a fee of nothing are
    // different facts and the column must let a reader tell them apart.
    expect(stored).toEqual({ feeStatus: "pending", feeAmountPaise: null });
  });

  // Manual add = the import's semantics one row at a time (same stub, same gate).
  const MANUAL_PHONE = `+9197${RUN}2`;

  it("manual add creates a person stub + submitted registration with its own timeline", async () => {
    const result = await addPlayerByPhone(db, compId, org.id, owner, {
      name: "Manual Player",
      phone: MANUAL_PHONE,
      role: "bowler",
      basePriceBand: "A",
    });
    if (!result.ok) {
      throw new Error("expected ok");
    }
    seededPersonIds.push(result.personId);
    expect(result.personExisted).toBe(false);
    expect(result.number).toBe(registrationNumber(result.registrationId));
    const page = await queryRegistrations(db, compId, {
      search: "Manual Player",
      page: 1,
      pageSize: 25,
    });
    expect(page.rows.map((r) => r.id)).toContain(result.registrationId);
    expect(page.rows.find((r) => r.id === result.registrationId)?.status).toBe("submitted");
    // The DA-27 lesson: the timeline starts where the player entered.
    const actions = (await timelineOf(db, result.registrationId, compId)).map((t) => t.action);
    expect(actions).toContain("registration.added");

    // PRR P1-1: the same registration id, queried under a DIFFERENT competition,
    // returns nothing — the object-level scope is the boundary, not RLS alone.
    const foreign = await timelineOf(db, result.registrationId, newId());
    expect(foreign).toEqual([]);
  });

  it("manual re-add of the same phone reuses the person and refuses the duplicate", async () => {
    const result = await addPlayerByPhone(db, compId, org.id, owner, {
      name: "Manual Player Again",
      phone: MANUAL_PHONE,
      role: "batter",
      basePriceBand: null,
    });
    expect(result).toEqual({ ok: false, reason: "duplicate" });
    // The person's name was NOT overwritten by the retry (it is not ours to correct).
    const [person] = await db.select().from(people).where(eq(people.phone, MANUAL_PHONE)).limit(1);
    expect(person?.name).toBe("Manual Player");
  });

  it("photo targets cover the whole competition and flag who already has a photo", async () => {
    const withPhoto = await seed(compId, org.id, "Pictured Player", "ph1", "approved");
    const [seeded] = await db
      .select({ personId: registrationsTable.personId })
      .from(registrationsTable)
      .where(eq(registrationsTable.id, withPhoto))
      .limit(1);
    await db
      .update(people)
      .set({ photoUrl: "orgs/x/player/p/photo.webp", photoConsentAt: new Date() })
      .where(eq(people.id, seeded?.personId ?? ""));
    const targets = await photoTargetsOf(db, compId);
    const total = (await registrationStats(db, compId)).total;
    expect(targets).toHaveLength(total);
    const pictured = targets.find((t) => t.registrationId === withPhoto);
    expect(pictured?.hasPhoto).toBe(true);
    expect(targets.filter((t) => t.registrationId !== withPhoto).every((t) => !t.hasPhoto)).toBe(
      true,
    );
  });

  it("deterministic search / filter / sort / pagination", async () => {
    const uniq = await seed(compId, org.id, "Zebedee Unique", "srch1", "submitted");
    // Search by name.
    const byName = await queryRegistrations(db, compId, {
      search: "Zebedee",
      page: 1,
      pageSize: 25,
    });
    expect(byName.rows.map((r) => r.id)).toContain(uniq);
    expect(byName.rows.every((r) => (r.name ?? "").includes("Zebedee"))).toBe(true);
    // Filter by status.
    const approvedOnly = await queryRegistrations(db, compId, {
      status: "approved",
      page: 1,
      pageSize: 25,
    });
    expect(approvedOnly.rows.every((r) => r.status === "approved")).toBe(true);
    // Deterministic pagination: two disjoint pages, stable order, no overlap.
    const p1 = await queryRegistrations(db, compId, { sort: "number", page: 1, pageSize: 3 });
    const p2 = await queryRegistrations(db, compId, { sort: "number", page: 2, pageSize: 3 });
    const overlap = p1.rows.filter((r) => p2.rows.some((o) => o.id === r.id));
    expect(overlap).toEqual([]);
    const numbers = p1.rows.map((r) => r.number);
    expect(numbers).toEqual([...numbers].sort());
  });

  it("duplicate-name detection flags repeated names", async () => {
    await seed(compId, org.id, "Twin Player", "dup1", "submitted");
    await seed(compId, org.id, "Twin Player", "dup2", "submitted");
    const keys = await duplicateNameKeys(db, compId);
    expect(keys.has("twin player")).toBe(true);
    const page = await queryRegistrations(db, compId, {
      search: "Twin Player",
      page: 1,
      pageSize: 25,
    });
    expect(page.rows.every((r) => r.duplicateName)).toBe(true);
  });

  it("DA-19: an approved player is told, on their own person-scoped ledger", async () => {
    const id = await seed(compId, org.id, "Told Player", "n01", "submitted");
    const [before] = await db
      .select({ personId: registrationsTable.personId })
      .from(registrationsTable)
      .where(eq(registrationsTable.id, id))
      .limit(1);
    const personId = before?.personId ?? "";
    await transition(db, org.id, compId, id, owner, { type: "approve" });
    // 48 players were approved during certification and not one was told: the
    // organiser's audit row is org-scoped and invisible to them.
    const notices = await db
      .select({ action: auditLog.action })
      .from(auditLog)
      .where(and(eq(auditLog.scopeId, personId), eq(auditLog.action, "registration.approved")));
    expect(notices).toHaveLength(1);
  });

  /*
   * THE REGISTRATION DESK, which was write-only.
   *
   * `fee_status`, `fee_amount`, `fee_reference` and `note` have been
   * importable, validated and stored since the desk columns landed — and
   * rendered on no screen and in no export. A club took cash at the ground,
   * imported it, and still had to open their spreadsheet to answer "who has
   * paid?", which is the thing the import exists to replace.
   */
  describe("the desk's arithmetic", () => {
    it("counts every live registration's fee state and sums what came in", async () => {
      const season = await createCompetition(db, org.id, owner, {
        sport: "cricket",
        name: `Desk Cup ${RUN}`,
      });
      const paidA = await seed(season.id, org.id, "Paid A", "f01", "approved");
      const paidB = await seed(season.id, org.id, "Paid B", "f02", "submitted");
      const waived = await seed(season.id, org.id, "Waived", "f03", "approved");
      const gone = await seed(season.id, org.id, "Withdrawn", "f04", "approved");
      await seed(season.id, org.id, "Owes", "f05", "waitlisted");
      await db
        .update(registrationsTable)
        .set({ feeStatus: "paid", feeAmountPaise: 50_000 })
        .where(inArray(registrationsTable.id, [paidA, paidB]));
      await db
        .update(registrationsTable)
        .set({ feeStatus: "waived" })
        .where(eq(registrationsTable.id, waived));
      // Paid, then left. Their money is a refund question, not an outstanding
      // one, so they must not appear in either count.
      await db
        .update(registrationsTable)
        .set({ feeStatus: "paid", feeAmountPaise: 99_999, status: "withdrawn" })
        .where(eq(registrationsTable.id, gone));

      const stats = await registrationStats(db, season.id);
      // Counted across ALL live statuses, not approved only: a club takes the
      // fee when somebody signs up, long before triage decides anything.
      expect(stats.fees).toEqual({ pending: 1, paid: 2, waived: 1, refunded: 0 });
      expect(stats.feeCollectedPaise).toBe(100_000);
    });

    it("narrows to one fee state, which is the desk's own question", async () => {
      const season = await createCompetition(db, org.id, owner, {
        sport: "cricket",
        name: `Desk Filter Cup ${RUN}`,
      });
      const paid = await seed(season.id, org.id, "Filter Paid", "f06", "approved");
      await seed(season.id, org.id, "Filter Owes", "f07", "approved");
      await db
        .update(registrationsTable)
        .set({ feeStatus: "paid" })
        .where(eq(registrationsTable.id, paid));

      const owing = await queryRegistrations(db, season.id, {
        fee: "pending",
        page: 1,
        pageSize: 20,
      });
      expect(owing.rows.map((row) => row.name)).toEqual(["Filter Owes"]);
      // And the row carries the desk, which it did not: the drawer and the
      // table both read this payload, so a field absent here is a field no
      // screen can ever show.
      expect(owing.rows[0]?.feeStatus).toBe("pending");
    });
  });

  /*
   * THE KIT BLOCK, write-only for as long as the fee was.
   *
   * The schema comment says what it is for — "only organizers who order jerseys
   * populate it" — so a club imports two hundred names, numbers and sizes to
   * place an order, and the product could not give the list back or add it up.
   */
  describe("what to order", () => {
    it("counts sizes, folding spelling but not meaning", async () => {
      const season = await createCompetition(db, org.id, owner, {
        sport: "cricket",
        name: `Kit Cup ${RUN}`,
      });
      const ids = [];
      for (const [i, size] of ["L", "l", " L ", "Large", "XL"].entries()) {
        const id = await seed(season.id, org.id, `Kit ${String(i)}`, `kt${String(i)}`, "approved");
        await db
          .update(registrationsTable)
          .set({ tshirtSize: size, trouserSize: "32" })
          .where(eq(registrationsTable.id, id));
        ids.push(id);
      }
      // Approved but sizeless — the ones still to chase.
      await seed(season.id, org.id, "Kit None", "kt5", "approved");
      // Declined, and must not be counted: ordering for them buys shirts for
      // people who are not coming.
      const out = await seed(season.id, org.id, "Kit Out", "kt6", "rejected");
      await db
        .update(registrationsTable)
        .set({ tshirtSize: "XXL" })
        .where(eq(registrationsTable.id, out));

      const kit = await kitSummary(db, season.id);
      /*
       * "L", "l" and " L " are plainly one answer and fold together. "Large" is
       * NOT folded into "L" — it might mean the same thing, and guessing which
       * spellings match is how an order comes back wrong. A club that sees both
       * listed knows to tidy the sheet before ringing the supplier.
       */
      expect(kit.tshirt).toEqual([
        { size: "L", count: 3 },
        { size: "LARGE", count: 1 },
        { size: "XL", count: 1 },
      ]);
      expect(kit.trouser).toEqual([{ size: "32", count: 5 }]);
      expect(kit.missing, "approved, no size recorded").toBe(1);
      expect(
        kit.tshirt.some((entry) => entry.size === "XXL"),
        "a declined applicant is not on the order",
      ).toBe(false);
    });

    it("carries the kit on the row, so a screen can show it", async () => {
      const season = await createCompetition(db, org.id, owner, {
        sport: "cricket",
        name: `Kit Row Cup ${RUN}`,
      });
      const id = await seed(season.id, org.id, "Kit Row", "kt7", "approved");
      await db
        .update(registrationsTable)
        .set({ jerseyName: "RAHUL", jerseyNumber: "7", tshirtSize: "M", fatherName: "Suresh" })
        .where(eq(registrationsTable.id, id));
      const page = await queryRegistrations(db, season.id, { page: 1, pageSize: 20 });
      // Absent here is absent everywhere: the table and the drawer both read
      // this payload, so a field missing from it can never reach a screen.
      expect(page.rows[0]).toMatchObject({
        jerseyName: "RAHUL",
        jerseyNumber: "7",
        tshirtSize: "M",
        fatherName: "Suresh",
      });
    });
  });

  /*
   * THE SQUAD A FILE ALREADY KNEW.
   *
   * `IMPORT_FIELDS` had eighteen columns and not one of them was team, icon,
   * captain or retained — so an organizer imported forty players and then
   * re-entered every affiliation by hand, one toggle at a time, restating what
   * the file in front of them contained. These columns move auction pool
   * membership, which is why they waited for the roster lock to exist.
   */
  describe("importing the squad", () => {
    it("lands the team and the marks off the file, resolving the team by NAME", async () => {
      const team = await createTeam(db, org.id, compId, owner, `Import XI ${RUN}`);
      expect(team.ok).toBe(true);
      if (!team.ok) return;
      const phone = `97${RUN}1`;
      const csv =
        "name,phone,role,team,is_icon,is_retained\n" +
        // Spelled in lower case with loose spacing, as a spreadsheet does.
        `Squad One,${phone},batter,  ${team.team.name.toLowerCase()} ,no,yes`;
      const parsed = parseRegistrationCsv(csv, undefined, { knownTeams: [team.team.name] });
      expect(parsed.errors).toEqual([]);
      expect(await commitRegistrationImport(db, compId, org.id, owner, parsed.rows)).toMatchObject({
        imported: 1,
      });
      const [person] = await db
        .select({ id: people.id })
        .from(people)
        .where(eq(people.phone, `+91${phone}`));
      seededPersonIds.push(person?.id ?? "");
      const [row] = await db
        .select({
          teamId: registrationsTable.teamId,
          isIcon: registrationsTable.isIcon,
          isRetained: registrationsTable.isRetained,
        })
        .from(registrationsTable)
        .where(
          and(
            eq(registrationsTable.competitionId, compId),
            eq(registrationsTable.personId, person?.id ?? ""),
          ),
        );
      expect(row).toEqual({ teamId: team.team.id, isIcon: false, isRetained: true });
    });

    it("a column the file does not have clears nothing", async () => {
      /*
       * The failure this guards against is the expensive one: a club whose
       * sheet has no icon column re-imports a corrected roster, and every Icon
       * and Captain the organizer set by hand is silently cleared. Absent must
       * stay ABSENT, not become false.
       */
      const team = await createTeam(db, org.id, compId, owner, `Keep XI ${RUN}`);
      expect(team.ok).toBe(true);
      if (!team.ok) return;
      // Arrives by import, so the phone is one a CSV can carry back.
      const phone = `97${RUN}3`;
      const first = parseRegistrationCsv(`name,phone,role\nMarked By Hand,${phone},batter`);
      expect(first.errors).toEqual([]);
      await commitRegistrationImport(db, compId, org.id, owner, first.rows);
      const [person] = await db
        .select({ id: people.id })
        .from(people)
        .where(eq(people.phone, `+91${phone}`));
      seededPersonIds.push(person?.id ?? "");
      const [seeded] = await db
        .select({ id: registrationsTable.id })
        .from(registrationsTable)
        .where(
          and(
            eq(registrationsTable.competitionId, compId),
            eq(registrationsTable.personId, person?.id ?? ""),
          ),
        );
      const id = seeded?.id ?? "";
      // Then marked by hand on the dashboard, as an organizer would.
      await setRegistrationMarks(
        db,
        org.id,
        compId,
        id,
        { isIcon: true, teamId: team.team.id },
        owner,
      );
      // A second file, carrying only the columns a plain roster has.
      const csv = `name,phone,role\nMarked By Hand,${phone},bowler`;
      const parsed = parseRegistrationCsv(csv);
      expect(parsed.errors).toEqual([]);
      // FILE-WINS, deliberately: the weaker policy would leave the marks alone
      // for the uninteresting reason that it leaves everything alone. This
      // asserts that even when the file is allowed to overwrite, a column it
      // does not have is still not an instruction to clear anything.
      await commitRegistrationImport(db, compId, org.id, owner, parsed.rows, "file-wins");
      const [after] = await db
        .select({
          isIcon: registrationsTable.isIcon,
          teamId: registrationsTable.teamId,
          role: registrationsTable.role,
        })
        .from(registrationsTable)
        .where(eq(registrationsTable.id, id));
      expect(after?.isIcon, "the icon mark survived a file that never mentioned it").toBe(true);
      expect(after?.teamId).toBe(team.team.id);
      // And the column the file DID carry still updated.
      expect(after?.role).toBe("bowler");
    });

    it("moves the armband when a file names a captain the team already has", async () => {
      // DA-04's rule, reached through an import: "this player instead". Two
      // captains within ONE file are refused by the parser, where there is no
      // "instead" to honour.
      const team = await createTeam(db, org.id, compId, owner, `Armband XI ${RUN}`);
      expect(team.ok).toBe(true);
      if (!team.ok) return;
      const incumbent = await seed(compId, org.id, "Old Captain", "arm1");
      await setRegistrationMarks(
        db,
        org.id,
        compId,
        incumbent,
        { isCaptain: true, teamId: team.team.id },
        owner,
      );
      const phone = `97${RUN}2`;
      const csv =
        "name,phone,role,team,is_captain\n" + `New Captain,${phone},batter,${team.team.name},yes`;
      const parsed = parseRegistrationCsv(csv, undefined, { knownTeams: [team.team.name] });
      expect(parsed.errors).toEqual([]);
      await commitRegistrationImport(db, compId, org.id, owner, parsed.rows);
      const [person] = await db
        .select({ id: people.id })
        .from(people)
        .where(eq(people.phone, `+91${phone}`));
      seededPersonIds.push(person?.id ?? "");
      const [old] = await db
        .select({ isCaptain: registrationsTable.isCaptain })
        .from(registrationsTable)
        .where(eq(registrationsTable.id, incumbent));
      expect(old?.isCaptain, "the incumbent was demoted rather than colliding").toBe(false);
    });
  });

  it("DA-04: a team has exactly one captain — naming a new one moves the armband", async () => {
    const team = await createTeam(db, org.id, compId, owner, `Captaincy XI ${RUN}`);
    expect(team.ok).toBe(true);
    if (!team.ok) return;
    const first = await seed(compId, org.id, "First Captain", "cap1");
    const second = await seed(compId, org.id, "Second Captain", "cap2");

    await setRegistrationMarks(
      db,
      org.id,
      compId,
      first,
      { isCaptain: true, teamId: team.team.id },
      owner,
    );
    // The second naming must SUCCEED and demote the first, not collide: an
    // organiser naming a captain means "this player instead", not "error".
    await setRegistrationMarks(
      db,
      org.id,
      compId,
      second,
      { isCaptain: true, teamId: team.team.id },
      owner,
    );

    const captains = await db
      .select({ id: registrationsTable.id })
      .from(registrationsTable)
      .where(
        and(eq(registrationsTable.teamId, team.team.id), eq(registrationsTable.isCaptain, true)),
      );
    expect(captains.map((row) => row.id)).toEqual([second]);
  });

  it("a registration is never both Icon and Captain — the write path refuses, both ways", async () => {
    const team = await createTeam(db, org.id, compId, owner, `Exclusive XI ${RUN}`);
    expect(team.ok).toBe(true);
    if (!team.ok) return;
    const captain = await seed(compId, org.id, "Armband Holder", "excl1");
    const icon = await seed(compId, org.id, "Marquee Signing", "excl2");

    // Each mark on its own is legitimate and must keep working.
    expect(
      await setRegistrationMarks(
        db,
        org.id,
        compId,
        captain,
        { isCaptain: true, teamId: team.team.id },
        owner,
      ),
    ).toEqual({ ok: true });
    expect(
      await setRegistrationMarks(
        db,
        org.id,
        compId,
        icon,
        { isIcon: true, teamId: team.team.id },
        owner,
      ),
    ).toEqual({ ok: true });

    // Icon onto a stored Captain: refused on the EFFECTIVE state, not the patch.
    expect(
      await setRegistrationMarks(db, org.id, compId, captain, { isIcon: true }, owner),
    ).toEqual({ ok: false, reason: "icon_and_captain" });
    // Captain onto a stored Icon: the mirror case.
    expect(
      await setRegistrationMarks(db, org.id, compId, icon, { isCaptain: true }, owner),
    ).toEqual({ ok: false, reason: "icon_and_captain" });
    // Both in one call.
    expect(
      await setRegistrationMarks(
        db,
        org.id,
        compId,
        captain,
        { isIcon: true, isCaptain: true },
        owner,
      ),
    ).toEqual({ ok: false, reason: "icon_and_captain" });

    // A refusal writes NOTHING — not the flag, and not an audit row implying it.
    const [afterCaptain] = await db
      .select({ isIcon: registrationsTable.isIcon, isCaptain: registrationsTable.isCaptain })
      .from(registrationsTable)
      .where(eq(registrationsTable.id, captain));
    expect(afterCaptain).toEqual({ isIcon: false, isCaptain: true });
    const [afterIcon] = await db
      .select({ isIcon: registrationsTable.isIcon, isCaptain: registrationsTable.isCaptain })
      .from(registrationsTable)
      .where(eq(registrationsTable.id, icon));
    expect(afterIcon).toEqual({ isIcon: true, isCaptain: false });

    // Clearing one mark unblocks the other — the rule is a rule, not a trap.
    expect(
      await setRegistrationMarks(db, org.id, compId, captain, { isCaptain: false }, owner),
    ).toEqual({ ok: true });
    expect(
      await setRegistrationMarks(db, org.id, compId, captain, { isIcon: true }, owner),
    ).toEqual({ ok: true });
  });

  it("statistics reconcile with the actual rows", async () => {
    const stats = await registrationStats(db, compId);
    const rows = await db
      .select({ status: registrationsTable.status })
      .from(registrationsTable)
      .where(eq(registrationsTable.competitionId, compId));
    expect(stats.total).toBe(rows.length);
    const approved = rows.filter((r) => r.status === "approved").length;
    expect(stats.approved).toBe(approved);
  });

  it("export is deterministic, stable-ordered, and competition-scoped (no leakage)", async () => {
    const csv = await exportRegistrationsCsv(db, compId);
    const lines = csv.split("\n");
    // The header is the IMPORT's canonical vocabulary, so a file this product
    // exported re-imports with no mapping step — which it could not before, and
    // an organizer who exported a roster to fix one phone number in Excel lost
    // every squad affiliation on the way back in.
    expect(lines[0]).toBe(
      "registration_number,name,phone,role,status,team,is_icon,is_captain,is_retained," +
        "fee_status,fee_amount,fee_reference,jersey_name,jersey_number,tshirt_size,trouser_size",
    );
    // `father_name` is deliberately absent: it is an identity check on an entry
    // form, not kit, and this file is handed to a jersey supplier.
    expect(lines[0]).not.toContain("father_name");
    const numbers = lines.slice(1).map((l) => l.split(",")[0] ?? "");
    expect(numbers).toEqual([...numbers].sort()); // stable by registration number
    // No rival-org rows: a foreign competition's registration never appears.
    const rival = await createCompetition(db, orgOutsider.id, outsider, {
      sport: "cricket",
      name: `Rival Cup ${RUN}`,
    });
    await seed(rival.id, orgOutsider.id, "Rival Player", "rv01", "submitted");
    const ourCsv = await exportRegistrationsCsv(db, compId);
    expect(ourCsv).not.toContain("Rival Player");
  });

  it("export authorization: an outsider lacks registration.review on this competition", async () => {
    expect(
      await canCompetition(
        db,
        outsider,
        { orgId: org.id, competitionId: compId },
        "registration.review",
      ),
    ).toBe(false);
    expect(
      await canCompetition(
        db,
        owner,
        { orgId: org.id, competitionId: compId },
        "registration.review",
      ),
    ).toBe(true);
  });

  it("SCALE: 300 registrations page and aggregate correctly, bounded per page", async () => {
    const scaleComp = await createCompetition(db, org.id, owner, {
      sport: "cricket",
      name: `Scale Cup ${RUN}`,
    });
    const rows = Array.from({ length: 300 }, (_, i) => {
      const personId = newId();
      const id = newId();
      return { personId, id, i };
    });
    // Bulk insert people + registrations.
    await db.insert(people).values(
      rows.map((r) => ({
        id: r.personId,
        phone: `${SEED_PHONE_PREFIX}s${String(r.i)}`,
        name: `Scale ${String(r.i)}`,
      })),
    );
    seededPersonIds.push(...rows.map((r) => r.personId));
    await db.insert(registrationsTable).values(
      rows.map((r) => ({
        id: r.id,
        orgId: org.id,
        competitionId: scaleComp.id,
        personId: r.personId,
        role: "batter" as const,
        status: "submitted" as const,
        registrationNumber: registrationNumber(r.id),
      })),
    );
    const stats = await registrationStats(db, scaleComp.id);
    expect(stats.total).toBe(300);
    expect(stats.submitted).toBe(300);
    const page = await queryRegistrations(db, scaleComp.id, { page: 1, pageSize: 25 });
    expect(page.rows.length).toBe(25); // never the whole dataset
    expect(page.total).toBe(300);
    const lastPage = await queryRegistrations(db, scaleComp.id, { page: 12, pageSize: 25 });
    expect(lastPage.rows.length).toBe(25);
    const beyond = await queryRegistrations(db, scaleComp.id, { page: 13, pageSize: 25 });
    expect(beyond.rows.length).toBe(0);
  });
});
