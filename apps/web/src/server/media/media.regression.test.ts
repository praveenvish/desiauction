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
import { and, desc, eq, inArray } from "drizzle-orm";
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
import {
  clearCompetitionImage,
  clearEntryPhoto,
  currentCompetitionImageKey,
  currentPlayerPhotoKey,
  persistMediaKey,
  requireMediaWrite,
  resolveMediaSubject,
} from "./authz";
import { PRESIGN_QUOTAS, takePresignQuota } from "./presign-quota";
import { addPlayerByPhone } from "../competition/registrations";
import { shownName, shownPhotoConsentAt, shownPhotoKey } from "../competition/shown-name";
import { purgeOrg } from "../test-support/purge-org";

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
  comp = await createCompetition(db, orgX.id, owner, {
    sport: "cricket",
    name: `Media Cup ${RUN}`,
  });
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
  // PA-1R Phase 3: the spine these teardowns never deleted (purge-org.ts).
  for (const purgeId of orgIds) {
    await purgeOrg(db, purgeId);
  }
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
    expect(await resolveMediaSubject(db, comp, "team", teamId, owner)).toEqual({
      storageSubjectId: teamId,
      ownerPersonId: null,
    });
    expect(await resolveMediaSubject(db, comp, "team", newId(), owner)).toBeNull();
    expect(await resolveMediaSubject(db, comp, "competition", comp.id, owner)).toEqual({
      storageSubjectId: comp.id,
      ownerPersonId: null,
    });
    expect(await resolveMediaSubject(db, comp, "competition", newId(), owner)).toBeNull();
    // An ORGANIZER's player photo resolves to the ENTRY, typed name or not
    // (go-live gate P2): only the person writes their platform-wide photo.
    expect(await resolveMediaSubject(db, comp, "player", registrationId, owner)).toEqual({
      storageSubjectId: registrationId,
      ownerPersonId: player,
      entryPhoto: { registrationId },
    });
    // The person themselves resolves to their own account (D7).
    expect(await resolveMediaSubject(db, comp, "player", registrationId, player)).toEqual({
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

  it("writes the season's cover photo to its own column, apart from the crest (0082)", async () => {
    const competitionSubject = { storageSubjectId: comp.id, ownerPersonId: null };
    const now = new Date();
    await persistMediaKey(db, "competition", competitionSubject, "k/logo", now, "x");
    await persistMediaKey(db, "competition", competitionSubject, "k/cover", now, "x", "cover");
    const read = async () => {
      const [row] = await db
        .select({ logo: competitionsTable.logoUrl, cover: competitionsTable.coverUrl })
        .from(competitionsTable)
        .where(eq(competitionsTable.id, comp.id))
        .limit(1);
      return row;
    };
    expect(await read()).toEqual({ logo: "k/logo", cover: "k/cover" });
    expect(await currentCompetitionImageKey(db, comp.id, "cover")).toBe("k/cover");

    // Taking the cover down leaves the crest where it was.
    await clearCompetitionImage(db, comp.id, "cover");
    expect(await read()).toEqual({ logo: "k/logo", cover: null });
    expect(await currentCompetitionImageKey(db, comp.id, "cover")).toBeNull();
    // Only a season manager may write either picture.
    await expect(
      requireMediaWrite(db, outsider, comp, "competition", competitionSubject),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("keeps the club's photo for a typed-name entry on the ENTRY, never the account (0077)", async () => {
    // The club added this phone under a name it typed, so the account behind it
    // may be a stranger to the club. The club's photo must not replace theirs —
    // and must not be refused either, which would say the phone has an account.
    await db
      .update(registrationsTable)
      .set({ enteredName: "Typed By Club" })
      .where(eq(registrationsTable.id, registrationId));
    const [before] = await db
      .select({ photoUrl: people.photoUrl })
      .from(people)
      .where(eq(people.id, player))
      .limit(1);

    const byClub = await resolveMediaSubject(db, comp, "player", registrationId, owner);
    expect(byClub).toEqual({
      storageSubjectId: registrationId,
      ownerPersonId: player,
      entryPhoto: { registrationId },
    });
    if (byClub === null) throw new Error("unreachable");
    await requireMediaWrite(db, owner, comp, "player", byClub);
    await persistMediaKey(
      db,
      "player",
      byClub,
      "k/entry",
      new Date(),
      "organizer_upload_attestation",
    );
    const [entry] = await db
      .select({
        key: registrationsTable.enteredPhotoKey,
        via: registrationsTable.enteredPhotoConsentVia,
      })
      .from(registrationsTable)
      .where(eq(registrationsTable.id, registrationId))
      .limit(1);
    expect(entry).toEqual({ key: "k/entry", via: "organizer_upload_attestation" });
    const [after] = await db
      .select({ photoUrl: people.photoUrl })
      .from(people)
      .where(eq(people.id, player))
      .limit(1);
    expect(after?.photoUrl).toBe(before?.photoUrl);

    // The person themselves still sets their OWN account photo.
    expect(await resolveMediaSubject(db, comp, "player", registrationId, player)).toEqual({
      storageSubjectId: player,
      ownerPersonId: player,
    });

    await db
      .update(registrationsTable)
      .set({
        enteredName: null,
        enteredPhotoKey: null,
        enteredPhotoConsentVia: null,
        enteredPhotoConsentAt: null,
      })
      .where(eq(registrationsTable.id, registrationId));
  });
});

describe("MEDIA REGRESSION — a club's writes stop at its own entry (go-live gate P2)", () => {
  async function shown(regId: string) {
    const [row] = await db
      .select({ name: shownName, photoKey: shownPhotoKey, consentAt: shownPhotoConsentAt })
      .from(registrationsTable)
      .innerJoin(people, eq(people.id, registrationsTable.personId))
      .where(eq(registrationsTable.id, regId))
      .limit(1);
    return row;
  }

  it("an organizer's photo on an UNtyped entry lands on the entry; the account is untouched", async () => {
    await db
      .update(people)
      .set({ photoUrl: "k/own.jpg", photoConsentAt: new Date(), photoConsentVia: "self_upload" })
      .where(eq(people.id, player));
    const byClub = await resolveMediaSubject(db, comp, "player", registrationId, owner);
    if (byClub === null) throw new Error("unreachable");
    await requireMediaWrite(db, owner, comp, "player", byClub);
    await persistMediaKey(
      db,
      "player",
      byClub,
      "k/club.jpg",
      new Date(),
      "organizer_upload_attestation",
    );

    const [account] = await db
      .select({ photoUrl: people.photoUrl, via: people.photoConsentVia })
      .from(people)
      .where(eq(people.id, player));
    expect(account).toEqual({ photoUrl: "k/own.jpg", via: "self_upload" });
    // The season shows the club's entry photo, with the entry's consent.
    const seen = await shown(registrationId);
    expect(seen?.photoKey).toBe("k/club.jpg");
    expect(seen?.consentAt).not.toBeNull();

    // Removing it clears only the entry — the season falls back to the
    // player's own photo, which the club could never delete.
    expect(await currentPlayerPhotoKey(db, byClub)).toBe("k/club.jpg");
    await clearEntryPhoto(db, registrationId);
    expect((await shown(registrationId))?.photoKey).toBe("k/own.jpg");
    const [still] = await db
      .select({ photoUrl: people.photoUrl })
      .from(people)
      .where(eq(people.id, player));
    expect(still?.photoUrl).toBe("k/own.jpg");
  });

  it("adding a nameless account names the ENTRY, never people.name", async () => {
    const phone = `+9195${RUN}6`;
    const stubId = newId();
    await db.insert(people).values({ id: stubId, phone, name: null });
    try {
      const added = await addPlayerByPhone(db, comp.id, orgX.id, owner, {
        name: "Club Typed Stub",
        phone,
        role: "batter",
        basePriceBand: null,
      });
      if (!added.ok) throw new Error("expected ok");
      expect(added.personId).toBe(stubId);
      const [account] = await db
        .select({ name: people.name })
        .from(people)
        .where(eq(people.id, stubId));
      expect(account?.name).toBeNull();
      expect((await shown(added.registrationId))?.name).toBe("Club Typed Stub");
    } finally {
      await db
        .delete(auditLog)
        .where(and(eq(auditLog.scopeId, orgX.id), eq(auditLog.action, "registration.added")));
      await db.delete(registrationsTable).where(eq(registrationsTable.personId, stubId));
      await db.delete(people).where(eq(people.id, stubId));
    }
  });
});

describe("MEDIA REGRESSION — presign budget (go-live gate P0-6 c)", () => {
  it("allows the hour's budget, then refuses, per person and per path", async () => {
    const at = new Date();
    const cap = PRESIGN_QUOTAS["media.own_upload_requested"];
    for (let i = 0; i < cap; i++) {
      expect(await takePresignQuota(db, outsider, "media.own_upload_requested", {}, at)).toBe(true);
    }
    expect(await takePresignQuota(db, outsider, "media.own_upload_requested", {}, at)).toBe(false);
    // The organizer path has its own, larger budget.
    expect(await takePresignQuota(db, outsider, "media.upload_requested", {}, at)).toBe(true);
    // Another person is unaffected.
    expect(await takePresignQuota(db, player, "media.own_upload_requested", {}, at)).toBe(true);
    // An hour later the budget has refilled.
    const later = new Date(at.getTime() + 61 * 60 * 1000);
    expect(await takePresignQuota(db, outsider, "media.own_upload_requested", {}, later)).toBe(
      true,
    );
  });
});
