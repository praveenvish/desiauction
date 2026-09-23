// THE AUCTIONEER — a per-season conduct grant (launch polish, Phase 3), against
// real Postgres. Local processes connect as the database owner, so RLS (0076)
// is proven separately under desiauction_app; this suite proves the grant's
// MEANING: it conducts one season, nothing more, and only for a club member.
import {
  auctionOwnerInvites,
  auctions,
  createDb,
  grants as grantsTable,
  newId,
  orgMembers,
  otpCodes,
  otpInbox,
  paddles,
  people,
  type DbHandle,
} from "@desiauction/db";
import { desc, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { env } from "../../env";
import { requestOtp, verifyOtp } from "../auth/otp";
import { DevInboxSender } from "../auth/otp-sender";
import { canCompetition } from "../competition/authz";
import { createCompetition, type CompetitionSummary } from "../competition/competitions";
import { createInvite } from "../orgs/invites";
import { createOrg } from "../orgs/orgs";
import { purgeOrg } from "../test-support/purge-org";
import {
  assignAuctioneer,
  auctioneerCandidates,
  auctioneersOf,
  lockSeasonAppointments,
  removeAuctioneer,
} from "./auctioneers";

const handle: DbHandle = createDb(env.DATABASE_URL);
const db = handle.db;
const sender = new DevInboxSender(db);
const RUN = String(Date.now()).slice(-7);
const PHONE_OWNER = `+9196${RUN}9`;

let owner = "";
let member = "";
let stranger = "";
let teamOwner = "";
let paddleHolder = "";
let seasonAuctionId = "";
let orgId = "";
let season: CompetitionSummary = null as unknown as CompetitionSummary;
let otherSeason: CompetitionSummary = null as unknown as CompetitionSummary;

beforeAll(async () => {
  await requestOtp(db, sender, PHONE_OWNER);
  const [code] = await db
    .select()
    .from(otpInbox)
    .where(eq(otpInbox.phone, PHONE_OWNER))
    .orderBy(desc(otpInbox.createdAt))
    .limit(1);
  const verified = await verifyOtp(db, PHONE_OWNER, code?.code ?? "");
  if (!verified.ok) throw new Error("login failed");
  owner = verified.personId;
  const org = await createOrg(db, owner, `Auctioneer Org ${RUN}`);
  orgId = org.id;
  const base = { sport: "cricket", location: "Pune", startsOn: "2026-08-01", endsOn: "2026-09-01" };
  season = await createCompetition(db, orgId, owner, { ...base, name: `Night One ${RUN}` });
  otherSeason = await createCompetition(db, orgId, owner, { ...base, name: `Night Two ${RUN}` });
  member = newId();
  stranger = newId();
  teamOwner = newId();
  paddleHolder = newId();
  await db.insert(people).values([
    { id: member, phone: `+9195${RUN}1`, name: "Host Member" },
    { id: stranger, phone: `+9195${RUN}2`, name: "Stranger" },
    { id: teamOwner, phone: `+9195${RUN}3`, name: "Team Owner" },
    { id: paddleHolder, phone: `+9195${RUN}4`, name: "Paddle Holder" },
  ]);
  await db.insert(orgMembers).values([
    { orgId, personId: member },
    { orgId, personId: teamOwner },
    { orgId, personId: paddleHolder },
  ]);
});

afterAll(async () => {
  if (orgId !== "") await purgeOrg(db, orgId);
  await db
    .delete(people)
    .where(inArray(people.id, [member, stranger, teamOwner, paddleHolder, owner]));
  await db.delete(otpCodes).where(eq(otpCodes.phone, PHONE_OWNER));
  await db.delete(otpInbox).where(eq(otpInbox.phone, PHONE_OWNER));
  await handle.sql.end();
});

const scopeOf = (competition: CompetitionSummary) => ({
  orgId,
  competitionId: competition.id,
});

describe("AUCTIONEER — conduct one season, nothing more", () => {
  it("refuses someone who is not a member of the club", async () => {
    expect(
      await assignAuctioneer(db, {
        orgId,
        competitionId: season.id,
        personId: stranger,
        actorId: owner,
      }),
    ).toEqual({ ok: false, reason: "not_a_member" });
  });

  it("a member appointed for one season conducts that season — not the next, and never undoes", async () => {
    expect(await canCompetition(db, member, scopeOf(season), "auction.conduct")).toBe(false);
    expect(
      await assignAuctioneer(db, {
        orgId,
        competitionId: season.id,
        personId: member,
        actorId: owner,
      }),
    ).toEqual({ ok: true });
    expect((await auctioneersOf(db, season.id)).map((row) => row.personId)).toEqual([member]);

    expect(await canCompetition(db, member, scopeOf(season), "auction.conduct")).toBe(true);
    expect(await canCompetition(db, member, scopeOf(otherSeason), "auction.conduct")).toBe(false);
    expect(await canCompetition(db, member, scopeOf(season), "auction.override")).toBe(false);
    expect(await canCompetition(db, member, scopeOf(season), "registration.review")).toBe(false);
    expect(
      await assignAuctioneer(db, {
        orgId,
        competitionId: season.id,
        personId: member,
        actorId: owner,
      }),
    ).toEqual({ ok: false, reason: "already_assigned" });
  });

  it("removing the auctioneer takes the room back", async () => {
    expect(
      await removeAuctioneer(db, {
        orgId,
        competitionId: season.id,
        personId: member,
        actorId: owner,
      }),
    ).toEqual({ ok: true });
    expect(await canCompetition(db, member, scopeOf(season), "auction.conduct")).toBe(false);
    expect(
      await removeAuctioneer(db, {
        orgId,
        competitionId: season.id,
        personId: member,
        actorId: owner,
      }),
    ).toEqual({ ok: false, reason: "not_assigned" });
  });

  it("never appoints someone who owns a team in the season (security review, Phase 5)", async () => {
    // Team owners are viewer-level club members, so they pass the membership
    // check — and conducting shows every rival's purse and every owner's phone.
    const auctionId = newId();
    seasonAuctionId = auctionId;
    await db.insert(auctions).values({
      id: auctionId,
      orgId,
      competitionId: season.id,
      name: `Night One ${RUN}`,
      config: {},
      createdBy: owner,
    });
    await db.insert(auctionOwnerInvites).values({
      id: newId(),
      orgId,
      auctionId,
      teamId: newId(),
      tokenHash: `test-${RUN}-${newId()}`,
      createdBy: owner,
      expiresAt: new Date(Date.now() + 86_400_000),
      acceptedBy: teamOwner,
      acceptedAt: new Date(),
    });
    const candidates = await auctioneerCandidates(db, orgId, season.id);
    expect(candidates.map((row) => row.personId)).not.toContain(teamOwner);
    expect(candidates.map((row) => row.personId)).toContain(member);
    expect(
      await assignAuctioneer(db, {
        orgId,
        competitionId: season.id,
        personId: teamOwner,
        actorId: owner,
      }),
    ).toEqual({ ok: false, reason: "team_owner" });
    // Owning a team in ANOTHER season is no bar here.
    expect(
      (await auctioneerCandidates(db, orgId, otherSeason.id)).map((row) => row.personId),
    ).toContain(teamOwner);
  });

  it("never appoints someone holding a paddle in the season (go-live gate P3)", async () => {
    // IssuePaddle hands a paddle straight to a person — no owner link, no
    // grant — so the two routes above missed them.
    await db.insert(paddles).values({
      id: newId(),
      orgId,
      auctionId: seasonAuctionId,
      teamId: newId(),
      personId: paddleHolder,
      paddleNumber: `P-${RUN}`,
    });
    const candidates = await auctioneerCandidates(db, orgId, season.id);
    expect(candidates.map((row) => row.personId)).not.toContain(paddleHolder);
    expect(
      await assignAuctioneer(db, {
        orgId,
        competitionId: season.id,
        personId: paddleHolder,
        actorId: owner,
      }),
    ).toEqual({ ok: false, reason: "team_owner" });
  });

  it("appointment and acceptance serialise on one lock per season (go-live gate P3)", async () => {
    // Two transactions on the same season: the second waits for the first to
    // commit. Proven by ordering, not timing — the waiter can only record its
    // step after the holder has recorded both of its own.
    const steps: string[] = [];
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const first = db.transaction(async (tx) => {
      await lockSeasonAppointments(tx, season.id);
      steps.push("first:locked");
      await held;
      steps.push("first:done");
    });
    // Give the first transaction the lock before the second asks for it.
    while (!steps.includes("first:locked")) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    const second = db.transaction(async (tx) => {
      await lockSeasonAppointments(tx, season.id);
      steps.push("second:locked");
    });
    await new Promise((resolve) => setTimeout(resolve, 100));
    release();
    await Promise.all([first, second]);
    expect(steps).toEqual(["first:locked", "first:done", "second:locked"]);
    // A different season is a different lock: nothing waits on it.
    await db.transaction((tx) => lockSeasonAppointments(tx, otherSeason.id));
  });

  it("the database refuses any other set on a season scope, and a second live grant (0077)", async () => {
    await expect(
      db.insert(grantsTable).values({
        id: newId(),
        personId: member,
        scopeType: "tournament",
        scopeId: season.id,
        capabilitySet: "org:owner",
        grantedBy: owner,
      }),
    ).rejects.toThrow();
    const grant = {
      personId: member,
      scopeType: "tournament" as const,
      scopeId: otherSeason.id,
      capabilitySet: "auction:conductor",
      grantedBy: owner,
    };
    await db.insert(grantsTable).values({ id: newId(), ...grant });
    await expect(db.insert(grantsTable).values({ id: newId(), ...grant })).rejects.toThrow();
  });

  it("an invite cannot carry the auctioneer set — it would conduct every season", async () => {
    await expect(createInvite(db, orgId, owner, "auction:conductor")).rejects.toThrow(
      "unknown capability set",
    );
  });
});
