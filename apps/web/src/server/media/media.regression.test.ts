// PERMANENT MEDIA REGRESSION SUITE (parity §3.1, R6). Encodes the media-write
// authorization contract: the subject id is un-trusted and resolved inside the
// tenant boundary; team/competition writes require the manage capability; a
// player photo may be set by the registrant themselves OR an organizer with
// review rights; and a non-member is refused. Real Postgres, unique ids per run.
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
  tournaments as tournamentsTable,
  sessions,
  teams as teamsTable,
  type DbHandle,
} from "@desiauction/db";
import { desc, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { requestOtp, verifyOtp } from "../auth/otp";
import { DevInboxSender } from "../auth/otp-sender";
import {
  createCompetition,
  createTeam,
  type CompetitionSummary,
} from "../competition/competitions";
import { ForbiddenError } from "../orgs/authz";
import { createOrg } from "../orgs/orgs";
import { env } from "../../env";
import { persistMediaKey, requireMediaWrite, resolveMediaSubject } from "./authz";

const handle: DbHandle = createDb(env.DATABASE_URL);
const db = handle.db;
const sender = new DevInboxSender(db);

const RUN = String(Date.now()).slice(-7);
const PHONE_OWNER = `+9198${RUN}2`;
const PHONE_OUTSIDER = `+9196${RUN}4`;
const PHONE_PLAYER = `+9197${RUN}5`;
const TEST_PHONES = [PHONE_OWNER, PHONE_OUTSIDER, PHONE_PLAYER];

let owner = "";
let outsider = "";
let player = "";
let orgX = { id: "", name: "", slug: "" };
let orgY = { id: "", name: "", slug: "" };
let comp!: CompetitionSummary;
let teamId = "";
let registrationId = "";

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

beforeAll(async () => {
  owner = await login(PHONE_OWNER);
  outsider = await login(PHONE_OUTSIDER);
  player = await login(PHONE_PLAYER);
  orgX = await createOrg(db, owner, `Media Org X ${RUN}`);
  orgY = await createOrg(db, outsider, `Media Org Y ${RUN}`);
  comp = await createCompetition(db, orgX.id, owner, { name: `Media Cup ${RUN}` });
  const team = await createTeam(db, orgX.id, comp.id, owner, `Alpha ${RUN}`, "ALP");
  if (!team.ok) {
    throw new Error("team setup failed");
  }
  teamId = team.team.id;
  registrationId = newId();
  await db.insert(registrationsTable).values({
    id: registrationId,
    orgId: orgX.id,
    competitionId: comp.id,
    personId: player,
    role: "batter",
    status: "submitted",
    registrationNumber: registrationNumber(registrationId),
  });
});

afterAll(async () => {
  const ids = [owner, outsider, player].filter((id) => id !== "");
  const orgIds = [orgX.id, orgY.id].filter((id) => id !== "");
  if (orgIds.length > 0) {
    await db.delete(registrationsTable).where(inArray(registrationsTable.orgId, orgIds));
    await db.delete(teamsTable).where(inArray(teamsTable.orgId, orgIds));
    await db.delete(competitionsTable).where(inArray(competitionsTable.orgId, orgIds));
    await db.delete(tournamentsTable).where(inArray(tournamentsTable.orgId, orgIds));
    await db.delete(grantsTable).where(inArray(grantsTable.scopeId, orgIds));
    await db.delete(orgMembers).where(inArray(orgMembers.orgId, orgIds));
    await db.delete(auditLog).where(inArray(auditLog.scopeId, [...orgIds, ...ids]));
    await db.delete(organizations).where(inArray(organizations.id, orgIds));
  }
  if (ids.length > 0) {
    await db.delete(sessions).where(inArray(sessions.personId, ids));
    await db.delete(auditLog).where(inArray(auditLog.actor, ids));
    await db.delete(people).where(inArray(people.id, ids));
  }
  await db.delete(otpCodes).where(inArray(otpCodes.phone, TEST_PHONES));
  await db.delete(otpInbox).where(inArray(otpInbox.phone, TEST_PHONES));
  await handle.sql.end();
});

describe("MEDIA REGRESSION — write authorization contract", () => {
  it("resolves a subject only when it belongs to the competition", async () => {
    expect(await resolveMediaSubject(db, comp, "team", teamId)).toEqual({
      storageSubjectId: teamId,
      ownerPersonId: null,
    });
    expect(await resolveMediaSubject(db, comp, "team", newId())).toBeNull();
    expect(await resolveMediaSubject(db, comp, "competition", comp.id)).toEqual({
      storageSubjectId: comp.id,
      ownerPersonId: null,
    });
    expect(await resolveMediaSubject(db, comp, "competition", newId())).toBeNull();
    // Player subject resolves to the PERSON (person-level photo, D7).
    expect(await resolveMediaSubject(db, comp, "player", registrationId)).toEqual({
      storageSubjectId: player,
      ownerPersonId: player,
    });
  });

  it("lets an org owner write team, competition and player media", async () => {
    const team = { storageSubjectId: teamId, ownerPersonId: null };
    const competition = { storageSubjectId: comp.id, ownerPersonId: null };
    const playerSubject = { storageSubjectId: player, ownerPersonId: player };
    await expect(requireMediaWrite(db, owner, comp, "team", team)).resolves.toBeUndefined();
    await expect(
      requireMediaWrite(db, owner, comp, "competition", competition),
    ).resolves.toBeUndefined();
    await expect(
      requireMediaWrite(db, owner, comp, "player", playerSubject),
    ).resolves.toBeUndefined();
  });

  it("lets a player set their OWN photo but nothing else", async () => {
    const ownPhoto = { storageSubjectId: player, ownerPersonId: player };
    const team = { storageSubjectId: teamId, ownerPersonId: null };
    await expect(requireMediaWrite(db, player, comp, "player", ownPhoto)).resolves.toBeUndefined();
    await expect(requireMediaWrite(db, player, comp, "team", team)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  it("refuses a non-member for every subject", async () => {
    const team = { storageSubjectId: teamId, ownerPersonId: null };
    const otherPhoto = { storageSubjectId: player, ownerPersonId: player };
    await expect(requireMediaWrite(db, outsider, comp, "team", team)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(
      requireMediaWrite(db, outsider, comp, "player", otherPhoto),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("persists keys and captures photo consent on attach", async () => {
    const now = new Date();
    await persistMediaKey(
      db,
      "team",
      { storageSubjectId: teamId, ownerPersonId: null },
      "k/team",
      now,
      "organizer_upload_attestation",
    );
    const [team] = await db
      .select({ logoUrl: teamsTable.logoUrl })
      .from(teamsTable)
      .where(eq(teamsTable.id, teamId))
      .limit(1);
    expect(team?.logoUrl).toBe("k/team");

    await persistMediaKey(
      db,
      "player",
      { storageSubjectId: player, ownerPersonId: player },
      "k/photo",
      now,
      "self_upload",
    );
    const [row] = await db
      .select({
        photoUrl: people.photoUrl,
        consentAt: people.photoConsentAt,
        via: people.photoConsentVia,
      })
      .from(people)
      .where(eq(people.id, player))
      .limit(1);
    expect(row?.photoUrl).toBe("k/photo");
    expect(row?.consentAt).not.toBeNull();
    expect(row?.via).toBe("self_upload");
  });
});
