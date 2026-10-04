// CLUB-ONLY PLAYERS (0104) — a roster a club knows by name alone.
//
// BPL4's master sheet: 156 names, 106 of them carrying a made-up number
// (9000000001…) only because the import refused a row without one. A phone is
// an IDENTITY here, so every filler would have become a platform-wide person a
// stranger could sign in as. These pin the replacement: a filler is never
// stored, a phoneless row becomes a person with no credential owned by the
// club, and a second file finds that player again by name. Real Postgres.
import {
  applyMapping,
  detectMapping,
  mappingOf,
  parseRegistrationCsv,
  parseRegistrationRecords,
  sportPackFor,
  tokenizeCsv,
} from "@desiauction/core";
import {
  auditLog,
  createDb,
  newId,
  otpCodes,
  otpInbox,
  people,
  registrations,
  sessions,
  type DbHandle,
} from "@desiauction/db";
import { and, desc, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { env } from "../../env";
import { requestOtp, verifyOtp } from "../auth/otp";
import { DevInboxSender } from "../auth/otp-sender";
import { createOrg } from "../orgs/orgs";
import { purgeOrg } from "../test-support/purge-org";
import { createCompetition } from "./competitions";
import { attachPhoneToClubOnly } from "./club-only-phone";
import {
  commitRegistrationImport,
  planAgainstStored,
  screenAgainstStored,
  storedForImport,
} from "./registration-import";
import { addPlayerByPhone, queryRegistrations } from "./registrations";

const handle: DbHandle = createDb(env.DATABASE_URL);
const db = handle.db;
const sender = new DevInboxSender(db);

const RUN = String(Date.now()).slice(-7);
const PHONE_OWNER = `+9197${RUN}3`;
/** A real-looking number unique to this run (no six-digit run, no sequence). */
const REAL = `83${RUN}5`;

let owner = "";
let org = { id: "", name: "", slug: "" };
let compId = "";
const realPersonIds: string[] = [];

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

/** The season's players by shown name, with the person behind each. */
async function roster() {
  return db
    .select({
      registrationId: registrations.id,
      name: people.name,
      enteredName: registrations.enteredName,
      phone: people.phone,
      email: people.email,
      clubOrgId: people.clubOrgId,
      role: registrations.role,
      fatherName: registrations.fatherName,
      status: registrations.status,
    })
    .from(registrations)
    .innerJoin(people, eq(people.id, registrations.personId))
    .where(eq(registrations.competitionId, compId));
}

beforeAll(async () => {
  owner = await login(PHONE_OWNER);
  org = await createOrg(db, owner, `Club Only ${RUN}`);
  const competition = await createCompetition(db, org.id, owner, {
    sport: "cricket",
    name: `BPL ${RUN}`,
  });
  compId = competition.id;
});

afterAll(async () => {
  if (org.id !== "") {
    await purgeOrg(db, org.id);
  }
  // Club-only people go with the org (0104 CASCADE); the real stub does not.
  const personIds = [owner, ...realPersonIds].filter((id) => id !== "");
  await db.delete(sessions).where(inArray(sessions.personId, personIds));
  await db.delete(auditLog).where(inArray(auditLog.actor, personIds));
  await db.delete(people).where(inArray(people.id, personIds));
  await db.delete(otpCodes).where(eq(otpCodes.phone, PHONE_OWNER));
  await db.delete(otpInbox).where(eq(otpInbox.phone, PHONE_OWNER));
  await handle.sql.end();
});

describe("CLUB-ONLY PLAYERS — a Hindi master sheet of names", () => {
  const SHEET = [
    "﻿क्रमांक,खिलाड़ी का नाम (फाइनल हिंदी नाम),पिता का नाम,मोबाइल नंबर,गांव,फोटो",
    "1,अरविंद बिश्नोई,,9000000001,,",
    "2,दिनेश पंवार,,9000000002,,",
    `3,रवि बिश्नोई,Shaitanaram ji,${REAL},Vishnunagar,`,
    "4,मोहन गोदारा,,,,",
  ].join("\n");

  /** The sheet read the way the import screen reads it: detected, then parsed. */
  function parseSheet(text: string) {
    const records = tokenizeCsv(text);
    const mapping = mappingOf(detectMapping(records[0] ?? [], records));
    return parseRegistrationRecords(applyMapping(records, mapping), undefined, { now: new Date() });
  }

  it("imports every name, stores no filler, and gives no phoneless player a credential", async () => {
    const parsed = parseSheet(SHEET);
    expect(parsed.errors).toEqual([]);
    expect(parsed.placeholders.map((entry) => entry.line)).toEqual([2, 3]);

    const result = await commitRegistrationImport(db, compId, org.id, owner, parsed.rows);
    expect(result.imported).toBe(4);

    const players = await roster();
    expect(players).toHaveLength(4);
    const byName = new Map(players.map((player) => [player.name, player]));
    for (const name of ["अरविंद बिश्नोई", "दिनेश पंवार", "मोहन गोदारा"]) {
      const player = byName.get(name);
      // No phone, no email: nobody can sign in as them, nothing is sent to them.
      expect(player?.phone).toBeNull();
      expect(player?.email).toBeNull();
      expect(player?.clubOrgId).toBe(org.id);
      expect(player?.role).toBeNull();
    }
    // The real number is an ordinary stub, as it always was.
    const real = byName.get("रवि बिश्नोई");
    expect(real?.phone).toBe(`+91${REAL}`);
    expect(real?.clubOrgId).toBeNull();
    expect(real?.fatherName).toBe("Shaitanaram ji");
    const [stub] = await db
      .select({ id: people.id })
      .from(people)
      .where(eq(people.phone, `+91${REAL}`));
    if (stub !== undefined) {
      realPersonIds.push(stub.id);
    }
    // And no filler reached a person anywhere in this season.
    expect(players.some((player) => player.phone === "+919000000001")).toBe(false);
  });

  it("finds the club-only players again by name: a second file fills blanks, adds nobody", async () => {
    const corrected = SHEET.replace("1,अरविंद बिश्नोई,,", "1,अरविंद बिश्नोई,Hapu ram,");
    const parsed = parseSheet(corrected);
    const result = await commitRegistrationImport(db, compId, org.id, owner, parsed.rows);
    expect(result).toEqual({ imported: 0, updated: 1, unchanged: 3, reinstated: 0, named: 0 });
    const players = await roster();
    expect(players).toHaveLength(4);
    expect(players.find((player) => player.name === "अरविंद बिश्नोई")?.fatherName).toBe("Hapu ram");
  });

  /*
   * STEP 2 — THE NUMBER ARRIVES LATER. The corrected sheet now has a real phone
   * for a player first imported without one; it attaches to that player rather
   * than adding them a second time.
   */
  it("a corrected sheet gives a club-only player their number instead of adding them twice", async () => {
    const parsed = parseRegistrationCsv(`name,phone\nमोहन गोदारा,84${RUN}7`);
    const stored = await storedForImport(db, compId, parsed.rows);
    const screened = screenAgainstStored(parsed.rows, stored);
    expect(screened.errors).toEqual([]);
    // The preview says so, as a change like any other.
    const plan = planAgainstStored(screened.rows, stored, "fill-blanks", sportPackFor("cricket"));
    expect(plan.counts).toEqual({ new: 0, changed: 1, unchanged: 0, reinstate: 0 });
    expect(plan.rows[0]?.plan).toEqual({
      kind: "changed",
      changes: [{ field: "phone", label: "Mobile number", from: null, to: `+9184${RUN}7` }],
    });

    const result = await commitRegistrationImport(db, compId, org.id, owner, screened.rows);
    expect(result).toEqual({ imported: 0, updated: 1, unchanged: 0, reinstated: 0, named: 0 });
    const players = await roster();
    expect(players).toHaveLength(4);
    const mohan = players.find((player) => player.name === "मोहन गोदारा");
    expect(mohan?.phone).toBe(`+9184${RUN}7`);
    // An ordinary player from here on: the club-only marker is gone.
    expect(mohan?.clubOrgId).toBeNull();
    const [person] = await db
      .select({ id: people.id })
      .from(people)
      .where(eq(people.phone, `+9184${RUN}7`));
    if (person !== undefined) {
      realPersonIds.push(person.id);
    }
  });

  it("Add phone moves a club-only player onto the account that holds the number, quietly", async () => {
    const added = await addPlayerByPhone(db, compId, org.id, owner, {
      name: "लिंक खिलाड़ी",
      phone: null,
      role: "",
      basePriceBand: null,
    });
    if (!added.ok) {
      throw new Error("setup failed");
    }
    const accountId = newId();
    await db.insert(people).values({ id: accountId, phone: `+9187${RUN}2`, name: "Own Account" });
    realPersonIds.push(accountId);

    const attached = await attachPhoneToClubOnly(db, {
      competitionId: compId,
      orgId: org.id,
      actorId: owner,
      registrationId: added.registrationId,
      phone: `+9187${RUN}2`,
      source: "organizer_manual",
    });
    expect(attached).toEqual({ ok: true, personId: accountId, linked: true });
    const [entry] = await db
      .select({ personId: registrations.personId, enteredName: registrations.enteredName })
      .from(registrations)
      .where(eq(registrations.id, added.registrationId));
    // The season still shows the club's name for them, never the account's.
    expect(entry).toEqual({ personId: accountId, enteredName: "लिंक खिलाड़ी" });
    // The emptied club-only person is gone.
    const left = await db
      .select({ id: people.id })
      .from(people)
      .where(eq(people.id, added.personId));
    expect(left).toEqual([]);
  });

  it("refuses a number already registered in this season", async () => {
    const added = await addPlayerByPhone(db, compId, org.id, owner, {
      name: "दूसरा खिलाड़ी",
      phone: null,
      role: "",
      basePriceBand: null,
    });
    if (!added.ok) {
      throw new Error("setup failed");
    }
    const attached = await attachPhoneToClubOnly(db, {
      competitionId: compId,
      orgId: org.id,
      actorId: owner,
      registrationId: added.registrationId,
      phone: `+9187${RUN}2`,
      source: "organizer_manual",
    });
    expect(attached).toEqual({ ok: false, reason: "already_in_season" });
  });

  it("lists who is still missing a phone, a role or a photo", async () => {
    const names = async (missing: "phone" | "role" | "photo") =>
      (await queryRegistrations(db, compId, { missing, page: 1, pageSize: 100 })).rows
        .map((row) => row.name)
        .sort();
    expect(await names("phone")).toEqual(["अरविंद बिश्नोई", "दिनेश पंवार", "दूसरा खिलाड़ी"].sort());
    expect(await names("role")).toHaveLength(6);
    expect(await names("photo")).toHaveLength(6);
    const page = await queryRegistrations(db, compId, { missing: "phone", page: 1, pageSize: 100 });
    expect(page.rows.every((row) => row.clubOnly)).toBe(true);
  });

  it("adds a club-only player by hand, and refuses a second one with the same name", async () => {
    const first = await addPlayerByPhone(db, compId, org.id, owner, {
      name: "सुरेश सियाक",
      phone: null,
      role: "",
      basePriceBand: null,
    });
    expect(first.ok).toBe(true);
    const again = await addPlayerByPhone(db, compId, org.id, owner, {
      name: "  सुरेश   सियाक ",
      phone: null,
      role: "",
      basePriceBand: null,
    });
    expect(again).toEqual({ ok: false, reason: "duplicate_name" });
  });

  it("will not match a name two club-only players share — it asks instead", async () => {
    // Two of one name can only arrive past the guards (a rename on the
    // dashboard); a phoneless row naming them must not pick one.
    const [suresh] = await db
      .select({ id: registrations.id })
      .from(registrations)
      .innerJoin(people, eq(people.id, registrations.personId))
      .where(and(eq(registrations.competitionId, compId), eq(people.name, "सुरेश सियाक")));
    await db
      .update(registrations)
      .set({ enteredName: "अरविंद बिश्नोई" })
      .where(eq(registrations.id, suresh?.id ?? ""));
    const parsed = parseRegistrationCsv("name,father_name\nअरविंद बिश्नोई,Chokha ram");
    const screened = screenAgainstStored(
      parsed.rows,
      await storedForImport(db, compId, parsed.rows),
    );
    expect(screened.rows).toEqual([]);
    expect(screened.errors[0]?.message).toMatch(/more than one player named/);
  });

  it("the database refuses a club-only person who holds a phone", async () => {
    await expect(
      db.insert(people).values({
        id: `01CLUBONLY${RUN}PHONE00`.slice(0, 26),
        phone: `+9185${RUN}1`,
        clubOrgId: org.id,
      }),
    ).rejects.toMatchObject({ cause: { constraint_name: "people_club_only_uncontactable_check" } });
  });
});

describe("0105 — 'everyone in this sheet is 18 or older'", () => {
  it("unticked confirms nobody; ticked confirms every player the file names", async () => {
    const season = await createCompetition(db, org.id, owner, {
      sport: "cricket",
      name: `Adults ${RUN}`,
    });
    const rows = parseRegistrationCsv("name,father_name\nकिशन लाल,\nभंवर लाल,").rows;
    const confirmedIn = async () =>
      db
        .select({ at: registrations.adultConfirmedAt })
        .from(registrations)
        .where(eq(registrations.competitionId, season.id));

    await commitRegistrationImport(db, season.id, org.id, owner, rows);
    expect((await confirmedIn()).map((row) => row.at)).toEqual([null, null]);

    // The same file again, ticked: both rows are "unchanged" and still confirmed.
    const at = new Date();
    const result = await commitRegistrationImport(
      db,
      season.id,
      org.id,
      owner,
      rows,
      "fill-blanks",
      null,
      at,
    );
    expect(result.unchanged).toBe(2);
    const after = await confirmedIn();
    expect(after).toHaveLength(2);
    expect(after.every((row) => row.at?.getTime() === at.getTime())).toBe(true);
  });
});
