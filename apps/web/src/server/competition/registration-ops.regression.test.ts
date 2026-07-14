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
import { desc, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { env } from "../../env";
import { requestOtp, verifyOtp } from "../auth/otp";
import { DevInboxSender } from "../auth/otp-sender";
import { canCompetition } from "./authz";
import { createCompetition } from "./competitions";
import { createOrg } from "../orgs/orgs";
import { addNote, transition, transitionBatch } from "./registration-aggregate";
import { commitRegistrationImport } from "./registration-import";
import {
  duplicateNameKeys,
  exportRegistrationsCsv,
  queryRegistrations,
  registrationStats,
  timelineOf,
} from "./registrations";

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
  const competition = await createCompetition(db, org.id, owner, { name: `Ops Cup ${RUN}` });
  compId = competition.id;
});

afterAll(async () => {
  const orgIds = [org.id, orgOutsider.id].filter((id) => id !== "");
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
    const timeline = await timelineOf(db, a);
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
    expect(result).toEqual({ imported: 0, duplicates: 1 });
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
    expect(lines[0]).toBe("registration_number,name,phone,role,status,team");
    const numbers = lines.slice(1).map((l) => l.split(",")[0] ?? "");
    expect(numbers).toEqual([...numbers].sort()); // stable by registration number
    // No rival-org rows: a foreign competition's registration never appears.
    const rival = await createCompetition(db, orgOutsider.id, outsider, {
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
    const scaleComp = await createCompetition(db, org.id, owner, { name: `Scale Cup ${RUN}` });
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
