// MY PLAN — PERMANENT REGRESSION SUITE (WR-1, milestone M2).
//
// Encodes the storage contract of an owner's private plan: the pool is the
// auction's own lots; a target must be one of them; a max sits between the
// lot's base and the purse; a fallback is a lot and never a loop; every write
// leaves a revision behind; plans are per TEAM and one team's rows never
// answer another team's read; the feature switch subtracts by layer and audits
// its flips. Real Postgres; unique phones/orgs per run.
//
// What this suite does NOT prove is the participant-arm RLS policy: every
// local process connects as the database owner, which bypasses it. That proof
// lives in `apps/web/scripts/verify-rls.ts` (participantProof) and in the
// hand-run probe recorded in docs/product/WR-1_MY_PLAN.md.
import { auctionOf, createAuction, issuePaddle, type AuctionRecord } from "@desiauction/auction";
import {
  DEFAULT_AUCTION_CONFIG,
  FEATURE_PLATFORM_SCOPE_ID,
  evaluatePlan,
  paise,
  registrationNumber,
} from "@desiauction/core";
import {
  auctionEvents as auctionEventsTable,
  auctionTeamTargetRevisions,
  auctionTeamTargets,
  auctions as auctionsTable,
  auditLog,
  bids as bidsTable,
  competitions as competitionsTable,
  createDb,
  featureSettings,
  grants as grantsTable,
  lots as lotsTable,
  newId,
  organizations,
  orgMembers,
  otpCodes,
  otpInbox,
  paddles as paddlesTable,
  people,
  registrations as registrationsTable,
  sessions,
  teams as teamsTable,
  type DbHandle,
} from "@desiauction/db";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
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
import { featureEnabled, setAuctionFeature } from "../feature-settings";
import { createOrg } from "../orgs/orgs";
import { auctionReady } from "./auction-ready";
import { rulesOf } from "./live-summary";
import {
  addTarget,
  pickPlanTeam,
  planLots,
  planRulesOf,
  removeTarget,
  targetsOf,
  teamStanding,
  updateTarget,
  type WriteContext,
} from "./owner-plan";

const handle: DbHandle = createDb(env.DATABASE_URL);
const db = handle.db;
const sender = new DevInboxSender(db);

const RUN = String(Date.now()).slice(-7);
const PHONE_ORGANIZER = `+9197${RUN}1`;
const PHONE_OWNER_A = `+9197${RUN}2`;
const PHONE_OWNER_B = `+9197${RUN}3`;
const TEST_PHONES = [PHONE_ORGANIZER, PHONE_OWNER_A, PHONE_OWNER_B];
const SEED_PHONE_PREFIX = `+91943${RUN}`;

let organizer = "";
let ownerA = "";
let ownerB = "";
let org = { id: "", name: "", slug: "" };
let comp: CompetitionSummary = null as unknown as CompetitionSummary;
let auction: AuctionRecord = null as unknown as AuctionRecord;
let teamA = "";
let teamB = "";
const seededPersonIds: string[] = [];
const reg: Record<string, string> = {};

const PURSE = paise(DEFAULT_AUCTION_CONFIG.pursePerTeam);

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

function must<T>(value: T | undefined | null, label: string): T {
  if (value === undefined || value === null) {
    throw new Error(`expected ${label}`);
  }
  return value;
}

async function seedApproved(name: string, suffix: string, band: string | null): Promise<string> {
  const personId = newId();
  await db.insert(people).values({ id: personId, phone: `${SEED_PHONE_PREFIX}${suffix}`, name });
  seededPersonIds.push(personId);
  const id = newId();
  await db.insert(registrationsTable).values({
    id,
    orgId: org.id,
    competitionId: comp.id,
    personId,
    role: "batter",
    status: "approved",
    registrationNumber: registrationNumber(id),
    ...(band !== null ? { basePriceBand: band } : {}),
  });
  return id;
}

async function context(teamId: string, actorId: string): Promise<WriteContext> {
  const [lots, existing] = await Promise.all([
    planLots(db, auction.id),
    targetsOf(db, auction.id, teamId),
  ]);
  return {
    orgId: org.id,
    auctionId: auction.id,
    teamId,
    actorId,
    atSeq: 7,
    pursePerTeam: PURSE,
    lots,
    existing,
  };
}

async function revisionsOf(teamId: string) {
  return db
    .select()
    .from(auctionTeamTargetRevisions)
    .where(
      and(
        eq(auctionTeamTargetRevisions.auctionId, auction.id),
        eq(auctionTeamTargetRevisions.teamId, teamId),
      ),
    )
    .orderBy(asc(auctionTeamTargetRevisions.at));
}

beforeAll(async () => {
  organizer = await login(PHONE_ORGANIZER);
  ownerA = await login(PHONE_OWNER_A);
  ownerB = await login(PHONE_OWNER_B);
  org = await createOrg(db, organizer, `Plan Org ${RUN}`);
  comp = await createCompetition(db, org.id, organizer, {
    sport: "cricket",
    name: `Plan League ${RUN}`,
    location: "Thane",
    startsOn: "2026-10-01",
    endsOn: "2026-11-15",
  });
  for (const [name, assign] of [
    ["Kalyan Kings", (id: string) => (teamA = id)],
    ["Dombivli Daredevils", (id: string) => (teamB = id)],
  ] as const) {
    const team = await createTeam(db, org.id, comp.id, organizer, name);
    if (!team.ok) {
      throw new Error("team setup failed");
    }
    assign(team.team.id);
  }
  reg["kohli"] = await seedApproved("Kohli Plan", "p01", "A");
  reg["sharma"] = await seedApproved("Sharma Plan", "p02", "B");
  reg["patel"] = await seedApproved("Patel Plan", "p03", null);
  let current = must(await resolveCompetition(db, organizer, comp.slug), "competition");
  for (const status of ["setup", "registration_open", "registration_closed"] as const) {
    const moved = await advanceCompetition(db, current, organizer, status);
    if (!moved.ok) {
      throw new Error(`advance to ${status} failed`);
    }
    current = must(await resolveCompetition(db, organizer, comp.slug), "competition");
  }
  comp = current;
  const ready = await auctionReady(db, comp);
  const created = await createAuction(db, comp, ready, organizer, DEFAULT_AUCTION_CONFIG);
  if (!created.ok) {
    throw new Error(`auction creation failed: ${created.reason}`);
  }
  auction = must(await auctionOf(db, comp.id), "auction");
  // A held paddle is one of the three participation routes; it is enough here.
  for (const [teamId, personId] of [
    [teamA, ownerA],
    [teamB, ownerB],
  ] as const) {
    const issued = await issuePaddle(db, auction, organizer, teamId, personId);
    if (!issued.ok) {
      throw new Error(`paddle issue failed: ${issued.reason}`);
    }
  }
});

afterAll(async () => {
  const personIds = [organizer, ownerA, ownerB, ...seededPersonIds].filter((id) => id !== "");
  if (org.id !== "") {
    await db.delete(featureSettings).where(eq(featureSettings.orgId, org.id));
    await db.delete(auctionTeamTargetRevisions).where(eq(auctionTeamTargetRevisions.orgId, org.id));
    await db.delete(auctionTeamTargets).where(eq(auctionTeamTargets.orgId, org.id));
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
    await db
      .delete(featureSettings)
      .where(
        and(
          eq(featureSettings.scopeType, "platform"),
          inArray(featureSettings.updatedBy, personIds),
        ),
      );
    await db.delete(sessions).where(inArray(sessions.personId, personIds));
    await db.delete(auditLog).where(inArray(auditLog.actor, personIds));
    await db.delete(people).where(inArray(people.id, personIds));
  }
  await db.delete(otpCodes).where(inArray(otpCodes.phone, TEST_PHONES));
  await db.delete(otpInbox).where(inArray(otpInbox.phone, TEST_PHONES));
  await handle.sql.end();
});

describe("MY PLAN — the pool is the auction's own lots", () => {
  it("lists every lot with the player behind it, in queue order, priced by band", async () => {
    const rows = await planLots(db, auction.id);
    expect(rows.map((row) => row.lotNumber)).toEqual(["L001", "L002", "L003"]);
    const kohli = must(
      rows.find((row) => row.registrationId === reg["kohli"]),
      "kohli lot",
    );
    const patel = must(
      rows.find((row) => row.registrationId === reg["patel"]),
      "patel lot",
    );
    expect(kohli.playerName).toBe("Kohli Plan");
    expect(kohli.basePrice).toBe(5_000_000);
    expect(patel.basePrice).toBe(1_000_000);
    expect(rows.every((row) => row.status === "prepared" && row.soldToTeamId === null)).toBe(true);
  });

  it("standing from rows alone: full purse, empty squad, before a lot is sold", async () => {
    const rows = await planLots(db, auction.id);
    expect(teamStanding(rows, 0, teamA, PURSE)).toEqual({ purseRemaining: PURSE, squadSize: 0 });
    expect(teamStanding(rows, 2, teamA, PURSE).squadSize).toBe(2);
  });
});

describe("MY PLAN — writes and their refusals", () => {
  it("adds a target with a max, leaves an 'added' revision, refuses the same player twice", async () => {
    const result = await addTarget(db, await context(teamA, ownerA), {
      registrationId: must(reg["kohli"], "kohli"),
      maxBid: 20_000_000,
      priority: 1,
      fallbackRegistrationId: null,
    });
    expect(result.ok).toBe(true);
    const targets = await targetsOf(db, auction.id, teamA);
    expect(targets.map((t) => [t.registrationId, t.maxBid, t.priority])).toEqual([
      [reg["kohli"], 20_000_000, 1],
    ]);
    const revisions = await revisionsOf(teamA);
    expect(revisions.map((r) => [r.kind, r.maxBid, r.atSeq, r.by])).toEqual([
      ["added", 20_000_000, 7, ownerA],
    ]);

    const again = await addTarget(db, await context(teamA, ownerA), {
      registrationId: must(reg["kohli"], "kohli"),
      maxBid: null,
      priority: 3,
      fallbackRegistrationId: null,
    });
    expect(again).toEqual({ ok: false, reason: "duplicate" });
  });

  it("refuses a player outside the auction, a bad max, a bad priority and a bad fallback", async () => {
    const ctx = await context(teamA, ownerA);
    const patel = must(reg["patel"], "patel");
    const base = {
      registrationId: patel,
      maxBid: null,
      priority: 3,
      fallbackRegistrationId: null,
    };
    expect(await addTarget(db, ctx, { ...base, registrationId: newId() })).toEqual({
      ok: false,
      reason: "not_in_auction",
    });
    expect(await addTarget(db, ctx, { ...base, maxBid: 0 })).toEqual({
      ok: false,
      reason: "invalid_max",
    });
    expect(await addTarget(db, ctx, { ...base, maxBid: 1_000_000.5 })).toEqual({
      ok: false,
      reason: "invalid_max",
    });
    expect(await addTarget(db, ctx, { ...base, maxBid: 999_999 })).toEqual({
      ok: false,
      reason: "below_base",
    });
    expect(await addTarget(db, ctx, { ...base, maxBid: PURSE + 1 })).toEqual({
      ok: false,
      reason: "above_purse",
    });
    expect(await addTarget(db, ctx, { ...base, priority: 0 })).toEqual({
      ok: false,
      reason: "bad_priority",
    });
    expect(await addTarget(db, ctx, { ...base, priority: 4 })).toEqual({
      ok: false,
      reason: "bad_priority",
    });
    expect(await addTarget(db, ctx, { ...base, fallbackRegistrationId: newId() })).toEqual({
      ok: false,
      reason: "bad_fallback",
    });
    expect(await addTarget(db, ctx, { ...base, fallbackRegistrationId: patel })).toEqual({
      ok: false,
      reason: "bad_fallback",
    });
    // Nothing above left a row or a revision behind.
    expect((await targetsOf(db, auction.id, teamA)).length).toBe(1);
    expect((await revisionsOf(teamA)).length).toBe(1);
  });

  it("accepts a fallback who is not a target, and refuses a fallback that closes a loop", async () => {
    const sharma = must(reg["sharma"], "sharma");
    const patel = must(reg["patel"], "patel");
    const first = await addTarget(db, await context(teamA, ownerA), {
      registrationId: sharma,
      maxBid: null,
      priority: 2,
      fallbackRegistrationId: patel,
    });
    expect(first.ok).toBe(true);
    const loop = await addTarget(db, await context(teamA, ownerA), {
      registrationId: patel,
      maxBid: null,
      priority: 3,
      fallbackRegistrationId: sharma,
    });
    expect(loop).toEqual({ ok: false, reason: "fallback_cycle" });
  });

  it("updates max, priority and fallback with an 'updated' revision; unknown ids are refused", async () => {
    const ctx = await context(teamA, ownerA);
    const kohli = must(
      ctx.existing.find((t) => t.registrationId === reg["kohli"]),
      "kohli target",
    );
    const updated = await updateTarget(db, ctx, kohli.id, {
      maxBid: 30_000_000,
      priority: 2,
      fallbackRegistrationId: must(reg["patel"], "patel"),
    });
    expect(updated.ok && updated.target.maxBid).toBe(30_000_000);
    expect(updated.ok && updated.target.priority).toBe(2);
    expect(updated.ok && updated.target.fallbackRegistrationId).toBe(reg["patel"]);
    expect((await revisionsOf(teamA)).map((r) => r.kind)).toEqual(["added", "added", "updated"]);

    expect(
      await updateTarget(db, ctx, newId(), {
        maxBid: null,
        priority: 3,
        fallbackRegistrationId: null,
      }),
    ).toEqual({ ok: false, reason: "unknown_target" });
    // The validation runs on an update too.
    expect(
      await updateTarget(db, ctx, kohli.id, {
        maxBid: 4_999_999,
        priority: 1,
        fallbackRegistrationId: null,
      }),
    ).toEqual({ ok: false, reason: "below_base" });
  });

  it("removes a target, leaving a 'removed' revision that records the state it had", async () => {
    const ctx = await context(teamA, ownerA);
    const sharma = must(
      ctx.existing.find((t) => t.registrationId === reg["sharma"]),
      "sharma target",
    );
    const removed = await removeTarget(db, ctx, sharma.id);
    expect(removed.ok).toBe(true);
    expect((await targetsOf(db, auction.id, teamA)).map((t) => t.registrationId)).toEqual([
      reg["kohli"],
    ]);
    const last = (await revisionsOf(teamA)).at(-1);
    expect(last?.kind).toBe("removed");
    expect(last?.targetId).toBe(sharma.id);
    expect(last?.fallbackRegistrationId).toBe(reg["patel"]);
    expect(await removeTarget(db, await context(teamA, ownerA), sharma.id)).toEqual({
      ok: false,
      reason: "unknown_target",
    });
  });
});

describe("MY PLAN — plans are per team", () => {
  it("another team's read never returns this team's rows, and both may target one player", async () => {
    expect(await targetsOf(db, auction.id, teamB)).toEqual([]);
    const result = await addTarget(db, await context(teamB, ownerB), {
      registrationId: must(reg["kohli"], "kohli"),
      maxBid: 6_000_000,
      priority: 1,
      fallbackRegistrationId: null,
    });
    expect(result.ok).toBe(true);
    const mine = await targetsOf(db, auction.id, teamA);
    const theirs = await targetsOf(db, auction.id, teamB);
    expect(mine.map((t) => t.maxBid)).toEqual([30_000_000]);
    expect(theirs.map((t) => t.maxBid)).toEqual([6_000_000]);
    expect((await revisionsOf(teamB)).length).toBe(1);
  });

  it("the team a request is for is always one the caller is in the room for", () => {
    expect(pickPlanTeam([teamA], null)).toBe(teamA);
    expect(pickPlanTeam([teamA], teamA)).toBe(teamA);
    expect(pickPlanTeam([teamA], teamB)).toBeNull();
    expect(pickPlanTeam([], null)).toBeNull();
    expect(pickPlanTeam([], teamA)).toBeNull();
    expect(pickPlanTeam([teamA, teamB], teamB)).toBe(teamB);
  });

  it("a write context for the wrong team cannot touch this team's rows", async () => {
    const mine = must((await targetsOf(db, auction.id, teamA))[0], "team A target");
    // B's context lists only B's rows, so A's id is unknown to it — and even a
    // forged id is bound by the team predicate on the UPDATE and DELETE.
    const ctxB = await context(teamB, ownerB);
    expect(await removeTarget(db, ctxB, mine.id)).toEqual({ ok: false, reason: "unknown_target" });
    expect(
      await updateTarget(db, { ...ctxB, existing: [...ctxB.existing, mine] }, mine.id, {
        maxBid: null,
        priority: 3,
        fallbackRegistrationId: null,
      }),
    ).toEqual({ ok: false, reason: "unknown_target" });
    expect((await targetsOf(db, auction.id, teamA)).map((t) => t.maxBid)).toEqual([30_000_000]);
  });
});

describe("MY PLAN — the fold runs from rows alone", () => {
  it("evaluates the stored plan against the purse without a socket", async () => {
    const rows = await planLots(db, auction.id);
    const rules = planRulesOf(rulesOf(auction.config));
    const standing = teamStanding(rows, 0, teamA, rules.pursePerTeam);
    const state = evaluatePlan({
      targets: await targetsOf(db, auction.id, teamA),
      lots: rows,
      myTeamId: teamA,
      purseRemaining: standing.purseRemaining,
      squadSize: standing.squadSize,
      rules,
      currentLot: null,
    });
    expect(state.budget.plannedExposure).toBe(30_000_000);
    expect(state.budget.headroom).toBe(PURSE - 30_000_000);
    expect(state.budget.fit).toBe("fits");
    expect(state.targets[0]?.outcome).toBe("open");
    expect(state.currentLot).toBeNull();
  });
});

describe("MY PLAN — the feature switch", () => {
  const scope = () => ({ orgId: org.id, auctionId: auction.id });

  it("is on by default, subtracts at the auction layer, and audits the flip", async () => {
    expect(await featureEnabled(db, "my_plan", scope())).toEqual({ enabled: true, deniedBy: null });
    await setAuctionFeature(db, {
      orgId: org.id,
      auctionId: auction.id,
      feature: "my_plan",
      enabled: false,
      actorId: organizer,
    });
    expect(await featureEnabled(db, "my_plan", scope())).toEqual({
      enabled: false,
      deniedBy: "auction",
    });
    const audits = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.action, "auction.feature_toggled"), eq(auditLog.subject, auction.id)))
      .orderBy(asc(auditLog.at));
    expect(audits.map((row) => row.meta)).toEqual([{ feature: "my_plan", enabled: false }]);
    // Flipping back upserts the same row rather than adding a second.
    await setAuctionFeature(db, {
      orgId: org.id,
      auctionId: auction.id,
      feature: "my_plan",
      enabled: true,
      actorId: organizer,
    });
    expect(await featureEnabled(db, "my_plan", scope())).toEqual({ enabled: true, deniedBy: null });
    const rows = await db
      .select()
      .from(featureSettings)
      .where(
        and(eq(featureSettings.scopeType, "auction"), eq(featureSettings.scopeId, auction.id)),
      );
    expect(rows.length).toBe(1);
  });

  it("a platform row overrides the default and no lower layer can undo it", async () => {
    await db.insert(featureSettings).values({
      id: newId(),
      orgId: null,
      scopeType: "platform",
      scopeId: FEATURE_PLATFORM_SCOPE_ID,
      feature: "my_plan",
      enabled: false,
      updatedBy: organizer,
    });
    try {
      expect(await featureEnabled(db, "my_plan", scope())).toEqual({
        enabled: false,
        deniedBy: "platform",
      });
    } finally {
      await db
        .delete(featureSettings)
        .where(
          and(eq(featureSettings.scopeType, "platform"), eq(featureSettings.updatedBy, organizer)),
        );
    }
    expect((await featureEnabled(db, "my_plan", scope())).enabled).toBe(true);
  });
});
