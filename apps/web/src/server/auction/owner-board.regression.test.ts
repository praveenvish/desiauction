// THE OWNER WORKFLOW, AT THE AGGREGATE (FR-20).
//
// Invitation → acceptance → grant → claim → release is how a team owner gets
// money authority on auction night, and the cockpit's owner panel is built on
// `ownerBoard`. Until now the whole chain was proven only through the browser
// (auction-experience / live-auction specs), which drive the happy path and
// never an expired link, a revoked one, a second team, or a release. Each of
// those decides whether the organizer's screen tells the truth about who can
// bid, so each is pinned here against real Postgres.
import { DEFAULT_AUCTION_CONFIG, registrationNumber, replayAuction } from "@desiauction/core";
import {
  auctionEvents as auctionEventsTable,
  auctionOwnerInvites,
  auctions as auctionsTable,
  auditLog,
  bids as bidsTable,
  competitions as competitionsTable,
  createDb,
  grants as grantsTable,
  lots as lotsTable,
  newId,
  organizations,
  orgMembers,
  otpCodes,
  otpInbox,
  paddleGrants,
  paddles as paddlesTable,
  people,
  registrations as registrationsTable,
  sessions,
  teams as teamsTable,
  type DbHandle,
} from "@desiauction/db";
import {
  acceptOwnerInvite,
  auctionOf,
  claimPaddle,
  createAuction,
  grantPaddle,
  inviteOwner,
  loadEvents,
  ownerBoard,
  releasePaddle,
  revokeOwnerInvite,
  type AuctionRecord,
} from "@desiauction/auction";
import { desc, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { env } from "../../env";
import { requestOtp, verifyOtp } from "../auth/otp";
import { DevInboxSender } from "../auth/otp-sender";
import {
  advanceCompetition,
  createCompetition,
  createTeam,
  resolveCompetition,
  type CompetitionSummary,
} from "../competition/competitions";
import { createOrg } from "../orgs/orgs";
import { auctionReady } from "./auction-ready";

const handle: DbHandle = createDb(env.DATABASE_URL);
const db = handle.db;
const sender = new DevInboxSender(db);

const RUN = String(Date.now()).slice(-7);
const PHONE_ORGANIZER = `+9197${RUN}1`;
const PHONE_OWNER = `+9197${RUN}2`;
const TEST_PHONES = [PHONE_ORGANIZER, PHONE_OWNER];
const SEED_PHONE_PREFIX = `+91945${RUN}`;
const DAY_MS = 86_400_000;

let organizer = "";
let owner = "";
let stranger = "";
let org = { id: "", name: "", slug: "" };
let comp: CompetitionSummary = null as unknown as CompetitionSummary;
let auction: AuctionRecord = null as unknown as AuctionRecord;
const teamIds: string[] = [];
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

async function seedPerson(name: string, suffix: string): Promise<string> {
  const id = newId();
  await db.insert(people).values({ id, phone: `${SEED_PHONE_PREFIX}${suffix}`, name });
  seededPersonIds.push(id);
  return id;
}

async function seedApproved(name: string, suffix: string): Promise<void> {
  const personId = await seedPerson(name, suffix);
  const id = newId();
  await db.insert(registrationsTable).values({
    id,
    orgId: org.id,
    competitionId: comp.id,
    personId,
    role: "batter",
    status: "approved",
    registrationNumber: registrationNumber(id),
  });
}

function team(index: number): string {
  const id = teamIds[index];
  if (id === undefined) {
    throw new Error(`no team ${String(index)}`);
  }
  return id;
}

async function board() {
  return ownerBoard(db, auction);
}

async function invite(teamIndex: number, expiresInMs: number): Promise<string> {
  const result = await inviteOwner(
    db,
    auction,
    organizer,
    team(teamIndex),
    `hash-${newId()}`,
    Date.now() + expiresInMs,
  );
  if (!result.ok) {
    throw new Error(`invite failed: ${result.reason}`);
  }
  return result.inviteId;
}

beforeAll(async () => {
  organizer = await login(PHONE_ORGANIZER);
  owner = await login(PHONE_OWNER);
  await db.update(people).set({ name: "Owner Asha" }).where(eq(people.id, owner));
  stranger = await seedPerson("Stranger Ravi", "s01");
  org = await createOrg(db, organizer, `Owner Board Org ${RUN}`);
  comp = await createCompetition(db, org.id, organizer, {
    sport: "cricket",
    name: `Owner Board League ${RUN}`,
    location: "Pune",
    startsOn: "2026-10-01",
    endsOn: "2026-10-30",
  });
  for (const name of ["Kothrud Kites", "Baner Bulls"]) {
    const created = await createTeam(db, org.id, comp.id, organizer, name);
    if (!created.ok) {
      throw new Error("team setup failed");
    }
    teamIds.push(created.team.id);
  }
  // draft → setup → registration_open → (players approved) → registration_closed.
  for (const status of ["setup", "registration_open"] as const) {
    const current = await resolveCompetition(db, organizer, comp.slug);
    if (current === null || !(await advanceCompetition(db, current, organizer, status)).ok) {
      throw new Error(`could not advance to ${status}`);
    }
  }
  await seedApproved("Player One", "p01");
  await seedApproved("Player Two", "p02");
  const open = await resolveCompetition(db, organizer, comp.slug);
  if (open === null || !(await advanceCompetition(db, open, organizer, "registration_closed")).ok) {
    throw new Error("could not close registration");
  }
  const closed = await resolveCompetition(db, organizer, comp.slug);
  if (closed === null) {
    throw new Error("competition vanished");
  }
  comp = closed;
  const created = await createAuction(
    db,
    comp,
    await auctionReady(db, comp),
    organizer,
    DEFAULT_AUCTION_CONFIG,
  );
  const record = await auctionOf(db, comp.id);
  if (!created.ok || record === null) {
    throw new Error("auction setup failed");
  }
  auction = record;
});

afterAll(async () => {
  const personIds = [organizer, owner, ...seededPersonIds].filter((id) => id !== "");
  if (org.id !== "") {
    await db.delete(paddleGrants).where(eq(paddleGrants.orgId, org.id));
    await db.delete(auctionOwnerInvites).where(eq(auctionOwnerInvites.orgId, org.id));
    await db.delete(auctionEventsTable).where(eq(auctionEventsTable.orgId, org.id));
    await db.delete(bidsTable).where(eq(bidsTable.orgId, org.id));
    await db.delete(lotsTable).where(eq(lotsTable.orgId, org.id));
    await db.delete(paddlesTable).where(eq(paddlesTable.orgId, org.id));
    await db.delete(auctionsTable).where(eq(auctionsTable.orgId, org.id));
    await db.delete(registrationsTable).where(eq(registrationsTable.orgId, org.id));
    await db.delete(teamsTable).where(eq(teamsTable.orgId, org.id));
    await db.delete(competitionsTable).where(eq(competitionsTable.orgId, org.id));
    await db.delete(grantsTable).where(eq(grantsTable.scopeId, org.id));
    await db.delete(orgMembers).where(eq(orgMembers.orgId, org.id));
    await db.delete(auditLog).where(eq(auditLog.scopeId, org.id));
    await db.delete(organizations).where(eq(organizations.id, org.id));
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

describe("OWNER BOARD — invitations", () => {
  it("starts empty, and is frozen so no reader can edit what the cockpit shows", async () => {
    const empty = await board();
    expect(empty.invites).toEqual([]);
    expect(empty.grants).toEqual([]);
    expect(Object.isFrozen(empty)).toBe(true);
  });

  it("lists a live link as pending and a lapsed, unaccepted one as expired", async () => {
    await invite(0, 7 * DAY_MS);
    await invite(1, -60_000);
    const { invites } = await board();
    expect(invites.map((row) => [row.teamName, row.expired, row.acceptedBy])).toEqual([
      ["Kothrud Kites", false, null],
      ["Baner Bulls", true, null],
    ]);
    expect(Object.isFrozen(invites[0])).toBe(true);
  });

  it("refuses to accept a lapsed link, and the board keeps calling it expired", async () => {
    const lapsed = (await board()).invites.find((row) => row.expired);
    expect(lapsed).toBeDefined();
    expect(await acceptOwnerInvite(db, auction, owner, lapsed?.id ?? "")).toEqual({
      ok: false,
      reason: "expired",
    });
    const again = (await board()).invites.find((row) => row.id === lapsed?.id);
    expect(again?.expired).toBe(true);
    expect(again?.acceptedBy).toBeNull();
  });

  it("names who accepted, and an accepted link is never shown as expired", async () => {
    const live = (await board()).invites.find((row) => row.teamId === team(0));
    const accepted = await acceptOwnerInvite(db, auction, owner, live?.id ?? "");
    expect(accepted).toEqual({ ok: true, teamId: team(0), alreadyAccepted: false });
    const row = (await board()).invites.find((entry) => entry.id === live?.id);
    expect(row?.acceptedBy).toBe(owner);
    expect(row?.acceptedByName).toBe("Owner Asha");
    expect(row?.expired).toBe(false);
    // A second person opening the same forwarded link is refused.
    expect(await acceptOwnerInvite(db, auction, stranger, live?.id ?? "")).toEqual({
      ok: false,
      reason: "already_accepted",
    });
  });

  it("drops a revoked link from the board, and will not revoke an accepted one", async () => {
    const extra = await invite(1, 7 * DAY_MS);
    expect((await board()).invites.some((row) => row.id === extra)).toBe(true);
    expect(await revokeOwnerInvite(db, auction, organizer, extra)).toEqual({ ok: true });
    expect((await board()).invites.some((row) => row.id === extra)).toBe(false);
    const accepted = (await board()).invites.find((row) => row.acceptedBy === owner);
    expect(await revokeOwnerInvite(db, auction, organizer, accepted?.id ?? "")).toEqual({
      ok: false,
      reason: "already_accepted",
    });
  });
});

describe("OWNER BOARD — grants and claims", () => {
  it("grants only a person who accepted that team's link", async () => {
    expect(await grantPaddle(db, auction, organizer, team(0), stranger)).toMatchObject({
      ok: false,
      reason: "not_an_owner",
    });
    const granted = await grantPaddle(db, auction, organizer, team(0), owner);
    expect(granted).toMatchObject({ ok: true, alreadyGranted: false });
    const { grants } = await board();
    expect(grants.map((row) => [row.teamName, row.personName, row.claimed])).toEqual([
      ["Kothrud Kites", "Owner Asha", false],
    ]);
  });

  it("refuses a second team to the same owner (invariant 18)", async () => {
    const second = await invite(1, 7 * DAY_MS);
    expect((await acceptOwnerInvite(db, auction, owner, second)).ok).toBe(true);
    expect(await grantPaddle(db, auction, organizer, team(1), owner)).toMatchObject({
      ok: false,
      reason: "owns_another_team",
    });
    expect((await board()).grants).toHaveLength(1);
  });

  it("shows the grant as claimed while the owner holds the paddle, and not after release", async () => {
    const claimed = await claimPaddle(db, auction, owner, team(0));
    expect(claimed).toMatchObject({ ok: true, alreadyHeld: false });
    expect((await board()).grants[0]?.claimed).toBe(true);

    expect(await releasePaddle(db, auction, owner, team(0), false)).toEqual({ ok: true });
    expect((await board()).grants[0]?.claimed).toBe(false);
  });

  it("an ungranted person cannot claim at all", async () => {
    expect(await claimPaddle(db, auction, stranger, team(1))).toMatchObject({
      ok: false,
      reason: "no_grant",
    });
  });

  it("the event log replays to the same acceptances the board shows", async () => {
    const replay = replayAuction(await loadEvents(db, auction.id));
    expect(replay.ok).toBe(true);
    if (!replay.ok) {
      return;
    }
    const { invites } = await board();
    for (const row of invites) {
      expect(replay.projection.ownerInvites[row.id]?.acceptedBy ?? null).toBe(row.acceptedBy);
    }
  });
});
