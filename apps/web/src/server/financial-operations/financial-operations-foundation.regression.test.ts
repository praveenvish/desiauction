// PERMANENT FINANCIAL-OPERATIONS FOUNDATION REGRESSION SUITE (IP-6, M-IP6-1).
//
// Encodes the frozen contract of the Foundation against LIVE Postgres: the
// five aggregates behind ONE writer, the closed 23-type catalog failing closed,
// duplicate commands returning original acks, the follower consuming a REAL
// frozen settlement history (cursor replay, rewind, byte-identical rebuild),
// the runner's schedules/retries/leases/dead letters, watermark correctness,
// projection tamper → halt → heal, the three-way capability partition, RLS
// read+write proofs on all ten org-scoped tables — and the constitutional
// boundary: ZERO settlement writes across the entire suite.
//
// The settlement history it follows is REAL: a night conducted through the
// FROZEN IP-4 aggregate, settled through the FROZEN IP-5 writer — not a
// fixture. If financial operations could not consume the real thing, this
// suite would not go green.
import { DEFAULT_AUCTION_CONFIG, registrationNumber } from "@desiauction/core";
import {
  auctionOf,
  auctionView,
  createAuction,
  issuePaddle,
  placeBid,
  queueAllLots,
  transitionAuction,
  transitionLot,
  type AuctionRecord,
} from "@desiauction/auction";
import {
  auditLog,
  createDb,
  finopsCursors,
  finopsDispatches,
  finopsDocuments,
  finopsEvents,
  finopsExports,
  finopsJobs,
  finopsPeriodDays,
  finopsPeriods,
  finopsProfiles,
  finopsSeries,
  grants as grantsTable,
  journalCheckpoints,
  journalLegs,
  journalPostings,
  newId,
  organizations,
  orgMembers,
  otpCodes,
  otpInbox,
  payments,
  people,
  registrations as registrationsTable,
  sessions,
  settlementCases,
  settlementEvents,
  settlementObligations,
  type DbHandle,
} from "@desiauction/db";
import { SETTLEMENT_EVENT_TYPES } from "@desiauction/settlement";
import {
  FINOPS_EVENT_TYPES,
  dailyOpsJobKey,
  endedFiscalYearFor,
  fiscalYearBounds,
  nextDailyDueMs,
  previousDate,
  type JobRow,
} from "@desiauction/financial-operations";
import {
  amendProfile,
  attestDay,
  closePeriod,
  closeSeries,
  completeExport,
  declareProfile,
  drainJobsOnce,
  ensureSchedules,
  finopsDeps,
  foldStream,
  followerHealthSnapshot,
  markDispatchConfirmed,
  markDispatchFailed,
  markDispatchSent,
  openPeriod,
  openSeries,
  operationalSnapshot,
  orgWatermark,
  recoverProfile,
  recoverSeries,
  reopenPeriod,
  requestDispatch,
  requestExport,
  rewindFollower,
  runDailyOps,
  runFollower,
  runnerHealthSnapshot,
  runSchedulesOnce,
  verifyOrgFinops,
  watermarkSnapshot,
  type FinopsActor,
  type FinopsDeps,
} from "@desiauction/financial-operations/server";
import { and, eq, inArray, like, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { env } from "../../env";
import { auctionReady } from "../auction/auction-ready";
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
import {
  attestManualCapture,
  closeCase,
  computeCaseObligations,
  createPayment,
  openCase,
  settleCase,
  verifyCase,
  waiveObligation,
} from "../settlement/writer";
import { issueSettlementGrant, settlementActor } from "../settlement/authz";
import { settlementDeps } from "../settlement/deps";
import { canFinops, finopsActor, issueFinopsGrant, revokeFinopsGrant } from "./authz";

const handle: DbHandle = createDb(env.DATABASE_URL);
const db = handle.db;
const sender = new DevInboxSender(db);

const RUN = String(Date.now()).slice(-7);
const PHONE_OWNER = `+9192${RUN}1`;
const PHONE_OFFICER = `+9191${RUN}2`;
const PHONE_OUTSIDER = `+9190${RUN}3`;
const TEST_PHONES = [PHONE_OWNER, PHONE_OFFICER, PHONE_OUTSIDER];
const SEED_PHONE_PREFIX = `+91933${RUN}`;

const SALE_A = 5_000_000;
const SALE_B = 2_500_000;
const TIGERS_DUE = SALE_A * 2;
const LIONS_DUE = SALE_B;

let owner = "";
let officer = "";
let outsider = "";
let org = { id: "", name: "", slug: "" };
let comp: CompetitionSummary = null as unknown as CompetitionSummary;
let auction: AuctionRecord = null as unknown as AuctionRecord;
const teamIds: string[] = [];
const paddleIds: string[] = [];

let deps: FinopsDeps;
let actor: FinopsActor;
let caseId = "";
/** Settlement's event count at the end of the frozen flow — the boundary meter. */
let settlementEventCountAtStart = 0;

// The most recently ENDED fiscal year (IST) — the period this suite seals.
// Its FY has fully elapsed, so a period opened TODAY has zero mandatory
// coverage days and the close guard is exercised through exceptions instead.
let fy = "";
let periodId = "";
let seriesId = "";

const tigers = (): string => teamIds[0] ?? "";
const lions = (): string => teamIds[1] ?? "";

async function login(phone: string): Promise<string> {
  await requestOtp(db, sender, phone);
  const [row] = await db
    .select({ code: otpInbox.code })
    .from(otpInbox)
    .where(eq(otpInbox.phone, phone))
    .orderBy(otpInbox.createdAt);
  const result = await verifyOtp(db, phone, row?.code ?? "");
  if (!result.ok) {
    throw new Error("login failed");
  }
  return result.personId;
}

async function seedApproved(name: string, suffix: string, band: string): Promise<void> {
  const personId = newId();
  await db.insert(people).values({ id: personId, phone: `${SEED_PHONE_PREFIX}${suffix}`, name });
  const id = newId();
  await db.insert(registrationsTable).values({
    id,
    orgId: org.id,
    competitionId: comp.id,
    personId,
    role: "batter",
    status: "approved",
    registrationNumber: registrationNumber(id),
    basePriceBand: band,
  });
}

async function lotByPlayer(playerName: string): Promise<{ id: string }> {
  const view = await auctionView(db, auction);
  const lot = view.lots.find((row) => row.playerName === playerName);
  if (lot === undefined) {
    throw new Error(`lot for ${playerName}`);
  }
  return { id: lot.id };
}

/** Conduct a REAL auction night through the FROZEN IP-4 aggregate. */
async function conductAuctionNight(): Promise<void> {
  const current = await resolveCompetition(db, owner, comp.slug);
  if (current === null) {
    throw new Error("competition");
  }
  const ready = await auctionReady(db, current);
  const created = await createAuction(db, comp, ready, owner, DEFAULT_AUCTION_CONFIG);
  if (!created.ok) {
    throw new Error(`createAuction: ${created.reason}`);
  }
  const record = await auctionOf(db, comp.id);
  if (record === null) {
    throw new Error("no auction");
  }
  auction = record;

  for (const teamId of teamIds) {
    const issued = await issuePaddle(db, auction, owner, teamId, owner);
    if (!issued.ok) {
      throw new Error(`issuePaddle: ${issued.reason}`);
    }
    paddleIds.push(issued.paddleId);
  }
  await queueAllLots(db, auction, owner);
  const opened = await transitionAuction(db, auction, owner, "open");
  if (!opened.ok) {
    throw new Error("open");
  }
  auction = (await auctionOf(db, comp.id)) ?? auction;

  const sales = [
    { player: "Tiger One", paddle: paddleIds[0], amount: SALE_A },
    { player: "Tiger Two", paddle: paddleIds[0], amount: SALE_A },
    { player: "Lion One", paddle: paddleIds[1], amount: SALE_B },
  ];
  for (const sale of sales) {
    const lot = await lotByPlayer(sale.player);
    const open = await transitionLot(db, auction, lot.id, owner, "open");
    if (!open.ok) {
      throw new Error(`lot open: ${sale.player}`);
    }
    const bid = await placeBid(db, auction, owner, {
      lotId: lot.id,
      paddleId: sale.paddle ?? "",
      amountRaw: sale.amount,
      bidderAuthorized: true,
    });
    if (!bid.ok) {
      throw new Error(`bid ${sale.player}: ${bid.code}`);
    }
    const sold = await transitionLot(db, auction, lot.id, owner, "sell");
    if (!sold.ok) {
      throw new Error(`sell ${sale.player}`);
    }
  }
  const completed = await transitionAuction(db, auction, owner, "complete");
  if (!completed.ok) {
    throw new Error("complete");
  }
}

/** Settle the night through the FROZEN IP-5 writer: collect, waive, close. */
async function settleTheNight(): Promise<void> {
  const sdeps = settlementDeps(db, { checkpointCadence: 2 });
  const granted = await issueSettlementGrant(db, owner, org.id, officer, "settlement:controller");
  if (!granted.ok) {
    throw new Error(`settlement grant: ${granted.reason}`);
  }
  const sactor = await settlementActor(db, officer, org.id);

  const opened = await openCase(sdeps, sactor, {
    commandId: newId(),
    auctionId: auction.id,
    basis: "committed",
  });
  if (!opened.ok) {
    throw new Error(`openCase: ${opened.reason}`);
  }
  caseId = opened.caseId;
  const verified = await verifyCase(sdeps, sactor, caseId, newId());
  if (!verified.ok) {
    throw new Error(`verifyCase: ${verified.reason}`);
  }
  const computed = await computeCaseObligations(sdeps, sactor, caseId, newId());
  if (!computed.ok) {
    throw new Error(`compute: ${computed.reason}`);
  }

  // Tigers pay in full (manual cash, attested); Lions are waived (override).
  const paymentId = newId();
  const created = await createPayment(sdeps, sactor, {
    paymentId,
    commandId: newId(),
    caseId,
    teamId: tigers(),
    method: "manual:cash",
    amount: TIGERS_DUE,
  });
  if (!created.ok) {
    throw new Error(`createPayment: ${created.reason}`);
  }
  const captured = await attestManualCapture(sdeps, sactor, paymentId, newId(), {
    attestedBy: officer,
    evidenceRef: "cash-book-17",
  });
  if (!captured.ok) {
    throw new Error(`attest: ${captured.reason}`);
  }
  const waived = await waiveObligation(sdeps, sactor, caseId, newId(), {
    teamId: lions(),
    amount: LIONS_DUE,
    reason: "sponsor covered the Lions",
  });
  if (!waived.ok) {
    throw new Error(`waive: ${waived.reason}`);
  }
  const settled = await settleCase(sdeps, sactor, caseId, newId());
  if (!settled.ok) {
    throw new Error(`settle: ${settled.reason}`);
  }
  const closed = await closeCase(sdeps, sactor, caseId, newId());
  if (!closed.ok) {
    throw new Error(`close: ${closed.reason}`);
  }
}

async function settlementEventCount(): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(settlementEvents)
    .where(eq(settlementEvents.orgId, org.id));
  return row?.n ?? 0;
}

beforeAll(async () => {
  owner = await login(PHONE_OWNER);
  officer = await login(PHONE_OFFICER);
  outsider = await login(PHONE_OUTSIDER);

  org = await createOrg(db, owner, `FinOps ${RUN}`);
  comp = await createCompetition(db, org.id, owner, {
    name: `Season ${RUN}`,
    location: "Malad",
    startsOn: "2026-08-01",
    endsOn: "2026-09-15",
  });
  for (const name of ["Tigers", "Lions"]) {
    const team = await createTeam(db, org.id, comp.id, owner, name);
    if (!team.ok) {
      throw new Error("team");
    }
    teamIds.push(team.team.id);
  }
  let current = await resolveCompetition(db, owner, comp.slug);
  if (current === null) {
    throw new Error("competition");
  }
  await advanceCompetition(db, current, owner, "setup");
  current = await resolveCompetition(db, owner, comp.slug);
  if (current === null) {
    throw new Error("competition");
  }
  await advanceCompetition(db, current, owner, "registration_open");
  await seedApproved("Tiger One", "a01", "A");
  await seedApproved("Tiger Two", "a02", "A");
  await seedApproved("Lion One", "a03", "B");
  current = await resolveCompetition(db, owner, comp.slug);
  if (current === null) {
    throw new Error("competition");
  }
  await advanceCompetition(db, current, owner, "registration_closed");
  comp = (await resolveCompetition(db, owner, comp.slug)) ?? comp;

  await conductAuctionNight();
  await settleTheNight();
  settlementEventCountAtStart = await settlementEventCount();

  deps = finopsDeps(db);
  fy = endedFiscalYearFor(Date.now());

  // Money-mouth authority is granted EXPLICITLY (the third partition) — which
  // the authorization suite below proves.
  const granted = await issueFinopsGrant(db, owner, org.id, officer, "finops:controller");
  if (!granted.ok) {
    throw new Error(`finops grant: ${granted.reason}`);
  }
  actor = await finopsActor(db, officer, org.id);
}, 180_000);

afterAll(async () => {
  await db.delete(finopsCursors).where(eq(finopsCursors.orgId, org.id));
  await db.delete(finopsJobs).where(eq(finopsJobs.orgId, org.id));
  await db.delete(finopsPeriodDays).where(eq(finopsPeriodDays.orgId, org.id));
  await db.delete(finopsPeriods).where(eq(finopsPeriods.orgId, org.id));
  await db.delete(finopsExports).where(eq(finopsExports.orgId, org.id));
  await db.delete(finopsDispatches).where(eq(finopsDispatches.orgId, org.id));
  await db.delete(finopsDocuments).where(eq(finopsDocuments.orgId, org.id));
  await db.delete(finopsSeries).where(eq(finopsSeries.orgId, org.id));
  await db.delete(finopsProfiles).where(eq(finopsProfiles.orgId, org.id));
  await db.delete(finopsEvents).where(eq(finopsEvents.orgId, org.id));

  const caseRows = await db
    .select({ id: settlementCases.id })
    .from(settlementCases)
    .where(eq(settlementCases.orgId, org.id));
  const caseIds = caseRows.map((row) => row.id);
  await db.delete(payments).where(eq(payments.orgId, org.id));
  await db.delete(journalLegs).where(eq(journalLegs.orgId, org.id));
  await db.delete(journalPostings).where(eq(journalPostings.orgId, org.id));
  await db.delete(journalCheckpoints).where(eq(journalCheckpoints.orgId, org.id));
  if (caseIds.length > 0) {
    await db.delete(settlementObligations).where(inArray(settlementObligations.caseId, caseIds));
  }
  await db.delete(settlementEvents).where(eq(settlementEvents.orgId, org.id));
  await db.delete(settlementCases).where(eq(settlementCases.orgId, org.id));
  await db.delete(auditLog).where(eq(auditLog.scopeId, org.id));
  await db.delete(grantsTable).where(eq(grantsTable.scopeId, org.id));
  await db.delete(orgMembers).where(eq(orgMembers.orgId, org.id));
  await db.delete(organizations).where(eq(organizations.id, org.id));
  await db.delete(otpCodes).where(inArray(otpCodes.phone, TEST_PHONES));
  await db.delete(otpInbox).where(inArray(otpInbox.phone, TEST_PHONES));
  await db.delete(sessions).where(inArray(sessions.personId, [owner, officer, outsider]));
  await db.delete(people).where(inArray(people.phone, TEST_PHONES));
  await db.delete(people).where(like(people.phone, `${SEED_PHONE_PREFIX}%`));
  await handle.sql.end({ timeout: 5 });
}, 60_000);

describe("M-IP6-1 · The boundary — the catalogs are disjoint by construction", () => {
  it("no finops event type is a settlement type; no settlement type is finops", () => {
    const settlement = new Set<string>(SETTLEMENT_EVENT_TYPES);
    for (const type of FINOPS_EVENT_TYPES) {
      expect(settlement.has(type)).toBe(false);
    }
    expect(FINOPS_EVENT_TYPES).toHaveLength(23);
    expect(SETTLEMENT_EVENT_TYPES).toHaveLength(24);
  });
});

describe("M-IP6-1 · The Follower — a real settlement history, consumed read-only", () => {
  it("consumes every settlement stream densely and reports current", async () => {
    const run = await runFollower(deps, org.id);
    expect(run.waiting).toEqual([]);
    expect(run.consumed).toBe(settlementEventCountAtStart);
    expect(run.streams).toBeGreaterThanOrEqual(3); // case + journal + payment

    const health = await followerHealthSnapshot(deps, org.id);
    expect(health.current).toBe(true);
    expect(health.totalBehind).toBe(0);

    const marks = await watermarkSnapshot(deps, org.id);
    expect(marks.watermark[`case:${caseId}`]).toBeGreaterThanOrEqual(7);
    expect(marks.watermark[`journal:${org.id}`]).toBeGreaterThanOrEqual(3);
    expect(marks.totalBehind).toBe(0);
  });

  it("is idempotent: a second run consumes nothing and changes nothing", async () => {
    const before = await watermarkSnapshot(deps, org.id);
    const run = await runFollower(deps, org.id);
    expect(run.consumed).toBe(0);
    const after = await watermarkSnapshot(deps, org.id);
    expect(JSON.stringify(after)).toBe(JSON.stringify(before));
  });

  it("CURSOR REPLAY: rewind to zero and rebuild — byte-identical watermarks", async () => {
    const before = await watermarkSnapshot(deps, org.id);
    await rewindFollower(deps, org.id);
    expect((await watermarkSnapshot(deps, org.id)).totalBehind).toBe(settlementEventCountAtStart);
    const rerun = await runFollower(deps, org.id);
    expect(rerun.consumed).toBe(settlementEventCountAtStart);
    const after = await watermarkSnapshot(deps, org.id);
    expect(JSON.stringify(after)).toBe(JSON.stringify(before));
  });

  it("NEW UPSTREAM TRUTH flows through: a fresh settlement fact advances the watermark", async () => {
    // A lawful settlement append (a fresh payment on the closed case is not
    // lawful; a new payment attempt on a reopened case would be heavy — the
    // cheapest REAL new settlement event is a recovery marker).
    const sdeps = settlementDeps(db, { checkpointCadence: 2 });
    const sactor = await settlementActor(db, officer, org.id);
    const { recoverCase } = await import("../settlement/recovery");
    const recovered = await recoverCase(sdeps, sactor, caseId);
    expect(recovered.ok).toBe(true);

    const before = (await watermarkSnapshot(deps, org.id)).watermark[`case:${caseId}`] ?? 0;
    const run = await runFollower(deps, org.id);
    expect(run.consumed).toBeGreaterThanOrEqual(1);
    const after = (await watermarkSnapshot(deps, org.id)).watermark[`case:${caseId}`] ?? 0;
    expect(after).toBe(before + 1);
    settlementEventCountAtStart += 1;
  });
});

describe("M-IP6-1 · TaxProfile through the ONE writer", () => {
  it("declares the profile: event + audit + projection in one transaction", async () => {
    const ack = await declareProfile(
      deps,
      actor,
      { legalName: `FinOps ${RUN} Trust`, posture: "none" },
      newId(),
    );
    expect(ack).toMatchObject({ ok: true, status: "accepted", seq: 1 });

    const profile = await deps.store.loadProfile(org.id);
    expect(profile?.legalName).toBe(`FinOps ${RUN} Trust`);
    expect(profile?.version).toBe(1);
    expect(await verifyOrgFinops(deps, org.id)).toEqual([]);

    const audits = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.scopeId, org.id), eq(auditLog.action, "finops.ProfileDeclared")));
    expect(audits).toHaveLength(1);
  });

  it("DUPLICATE COMMAND: the original ack returns; nothing appends", async () => {
    const commandId = newId();
    const first = await amendProfile(
      deps,
      actor,
      { reason: "brand update", legalName: `FinOps ${RUN} Trust (Regd.)` },
      commandId,
    );
    expect(first).toMatchObject({ ok: true, status: "accepted", seq: 2 });
    const second = await amendProfile(
      deps,
      actor,
      { reason: "brand update", legalName: `FinOps ${RUN} Trust (Regd.)` },
      commandId,
    );
    expect(second).toMatchObject({ ok: true, status: "duplicate", seq: 2 });
    const events = await deps.store.loadStream("profile", org.id);
    expect(events).toHaveLength(2);
  });

  it("rejections are deterministic and append NOTHING", async () => {
    const before = (await deps.store.loadStream("profile", org.id)).length;
    expect(
      await amendProfile(deps, actor, { reason: "x", posture: "gst-registered" }, newId()),
    ).toEqual({ ok: false, reason: "gstin_invalid" });
    expect(
      await declareProfile(deps, actor, { legalName: "again", posture: "none" }, newId()),
    ).toEqual({ ok: false, reason: "profile_exists" });
    expect((await deps.store.loadStream("profile", org.id)).length).toBe(before);
  });

  it("TAMPER → HALT → HEAL: a mutated projection row halts commands; recovery heals byte-identical", async () => {
    const before = await deps.store.loadProfile(org.id);
    await db
      .update(finopsProfiles)
      .set({ legalName: "HACKED LLP" })
      .where(eq(finopsProfiles.orgId, org.id));

    const halted = await amendProfile(deps, actor, { reason: "noop" }, newId());
    expect(halted.ok).toBe(false);
    if (!halted.ok) {
      expect(halted.reason).toBe("finops_halted");
    }

    const recovered = await recoverProfile(deps, org.id);
    expect(recovered).toMatchObject({ ok: true, divergences: 1 });
    const after = await deps.store.loadProfile(org.id);
    expect(JSON.stringify(after)).toBe(JSON.stringify(before));

    const works = await amendProfile(deps, actor, { reason: "post-recovery" }, newId());
    expect(works.ok).toBe(true);
  });

  it("UNKNOWN EVENT fails the fold closed; a forged log is UNHEALABLE by recovery", async () => {
    const events = await deps.store.loadStream("profile", org.id);
    const forgedId = newId();
    await db.insert(finopsEvents).values({
      id: forgedId,
      orgId: org.id,
      streamType: "profile",
      streamId: org.id,
      seq: events.length + 1,
      type: "ProfileSuperseded", // not in the closed 23-type catalog
      atMs: Date.now(),
      actor: officer,
      correlationId: newId(),
      commandId: newId(),
      payload: {},
    });

    const fold = await foldStream(deps, "profile", org.id);
    expect(fold).toMatchObject({ ok: false, reason: "unknown_event_type" });
    const halted = await amendProfile(deps, actor, { reason: "x" }, newId());
    expect(halted.ok).toBe(false);
    if (!halted.ok) {
      expect(halted.reason).toBe("finops_unfoldable");
    }
    // Recovery refuses to heal a log the reducer refuses — restore territory.
    const refused = await recoverProfile(deps, org.id);
    expect(refused.ok).toBe(false);

    // The drill's "restore": remove the forged append; the aggregate resumes.
    await db.delete(finopsEvents).where(eq(finopsEvents.id, forgedId));
    expect((await recoverProfile(deps, org.id)).ok).toBe(true);
  });
});

describe("M-IP6-1 · DocumentSeries lifecycle (issuance arrives with M-IP6-2)", () => {
  it("opens ONE numbering lane per org·kind·fy; the key is taken forever", async () => {
    seriesId = newId();
    const ack = await openSeries(
      deps,
      actor,
      { kind: "receipt", fy, prefix: "RCT", seriesId },
      newId(),
    );
    expect(ack).toMatchObject({ ok: true, seq: 1 });
    const second = await openSeries(deps, actor, { kind: "receipt", fy, prefix: "R2" }, newId());
    expect(second).toEqual({ ok: false, reason: "series_key_taken" });
  });

  it("TAMPER → HALT → HEAL on the series register", async () => {
    await db.update(finopsSeries).set({ documentCount: 7 }).where(eq(finopsSeries.id, seriesId));
    const halted = await closeSeries(deps, actor, seriesId, newId());
    expect(halted.ok).toBe(false);
    if (!halted.ok) {
      expect(halted.reason).toBe("finops_halted");
    }
    expect((await recoverSeries(deps, org.id, seriesId)).ok).toBe(true);
    expect((await deps.store.loadSeries(seriesId))?.documentCount).toBe(0);
  });

  it("closes with a sealed register digest (empty lane: count 0)", async () => {
    const ack = await closeSeries(deps, actor, seriesId, newId());
    expect(ack.ok).toBe(true);
    const series = await deps.store.loadSeries(seriesId);
    expect(series?.status).toBe("closed");
    expect(series?.registerDigest).toBeTruthy();
  });
});

describe("M-IP6-1 · Dispatch — the queue's aggregate (providers arrive with M-IP6-3)", () => {
  let dispatchId = "";

  it("requested → sent → confirmed, with idempotent system transitions", async () => {
    const ack = await requestDispatch(
      deps,
      actor,
      {
        channel: "in-app",
        recipientRef: `owner:${tigers()}`,
        templateId: "receipt-ready",
        templateVersion: "v1",
        subjectRef: "notice:foundation",
      },
      newId(),
    );
    expect(ack.ok).toBe(true);
    dispatchId = ack.ok ? ack.streamId : "";

    const sendCommand = newId();
    expect((await markDispatchSent(deps, org.id, dispatchId, "prov_1", sendCommand)).ok).toBe(true);
    // A replayed transition returns the ORIGINAL ack and appends nothing.
    const replay = await markDispatchSent(deps, org.id, dispatchId, "prov_1", sendCommand);
    expect(replay).toMatchObject({ ok: true, status: "duplicate" });
    expect((await deps.store.loadStream("dispatch", dispatchId)).length).toBe(2);

    expect((await markDispatchConfirmed(deps, org.id, dispatchId, "evt_1", newId())).ok).toBe(true);
    expect((await deps.store.loadDispatch(dispatchId))?.status).toBe("confirmed");
  });

  it("terminal is terminal: no transition escapes confirmed/failed", async () => {
    expect(await markDispatchFailed(deps, org.id, dispatchId, "late", newId())).toEqual({
      ok: false,
      reason: "dispatch_terminal",
    });
    const second = await requestDispatch(
      deps,
      actor,
      {
        channel: "email",
        recipientRef: "billing@example.test",
        templateId: "statement",
        templateVersion: "v1",
        subjectRef: "notice:foundation-2",
      },
      newId(),
    );
    expect(second.ok).toBe(true);
    const failedId = second.ok ? second.streamId : "";
    expect((await markDispatchFailed(deps, org.id, failedId, "provider_5xx", newId())).ok).toBe(
      true,
    );
    expect((await markDispatchSent(deps, org.id, failedId, "again", newId())).ok).toBe(false);
    expect((await deps.store.loadDispatch(failedId))?.status).toBe("failed");
  });
});

describe("M-IP6-1 · ExportRun — audited acts with pinned provenance", () => {
  it("requested → completed pins digest, row count and the org watermark", async () => {
    const request = await requestExport(
      deps,
      actor,
      { kind: "journal-csv", params: { fy } },
      newId(),
    );
    expect(request.ok).toBe(true);
    const exportId = request.ok ? request.streamId : "";

    // Since M-IP6-4, the daily checklist VERIFIES completed exports against
    // their sealed digests — so the drill stores real bytes (as the M-IP6-3
    // generation pipeline does), not a fictional digest.
    const bytes = "register\nrow-1\n";
    const key = `${org.id}/${exportId}.csv`;
    await deps.artifacts.put(key, bytes);
    const completed = await completeExport(
      deps,
      org.id,
      exportId,
      { artifactRef: key, artifactDigest: deps.digest(bytes), rowCount: 1 },
      newId(),
    );
    expect(completed.ok).toBe(true);
    const row = await deps.store.loadExport(exportId);
    expect(row?.status).toBe("completed");
    expect(row?.artifactDigest).toBe(deps.digest(bytes));
    expect(JSON.stringify(row?.watermark)).toBe(JSON.stringify(await orgWatermark(deps, org.id)));
  });
});

describe("M-IP6-1 · FiscalPeriod + the daily reconciliation trigger", () => {
  const bounds = () => fiscalYearBounds(fy);

  it("opens the period for the most recently ENDED fiscal year", async () => {
    const ack = await openPeriod(deps, actor, { fy }, newId());
    expect(ack.ok).toBe(true);
    periodId = ack.ok ? ack.streamId : "";
    expect(await openPeriod(deps, actor, { fy }, newId())).toEqual({
      ok: false,
      reason: "period_exists_for_fy",
    });
  });

  it("A GREEN DAY self-attests: the runner's daily-ops job records the sentinel's verdict", async () => {
    const job: JobRow = {
      jobId: newId(),
      orgId: org.id,
      kind: "ops.attest-day",
      dedupeKey: dailyOpsJobKey(org.id, bounds().end),
      state: "leased",
      attempts: 0,
      maxAttempts: 5,
      notBeforeMs: Date.now(),
      leasedUntilMs: null,
      lastError: null,
      payload: { date: bounds().end },
    };
    await runDailyOps(deps, job);

    const days = await deps.store.loadPeriodDays(periodId);
    expect(days).toHaveLength(1);
    expect(days[0]?.date).toBe(bounds().end);
    expect(days[0]?.attestorKind).toBe("system");
    expect(days[0]?.failures).toBe(0);
    // Re-running the SAME job is a no-op (derived command ids).
    await runDailyOps(deps, job);
    expect((await deps.store.loadPeriodDays(periodId)).length).toBe(1);
  });

  it("A RED DAY refuses the sentinel and notes an exception a HUMAN must answer", async () => {
    const redDate = previousDate(bounds().end);
    // Break something real: tamper the profile row → verification-failure.
    const before = await deps.store.loadProfile(org.id);
    await db.update(finopsProfiles).set({ version: 99 }).where(eq(finopsProfiles.orgId, org.id));

    await runDailyOps(deps, {
      jobId: newId(),
      orgId: org.id,
      kind: "ops.attest-day",
      dedupeKey: dailyOpsJobKey(org.id, redDate),
      state: "leased",
      attempts: 0,
      maxAttempts: 5,
      notBeforeMs: Date.now(),
      leasedUntilMs: null,
      lastError: null,
      payload: { date: redDate },
    });

    const period = await deps.store.loadPeriod(periodId);
    expect(period?.openExceptions).toBe(1);
    expect((await deps.store.loadPeriodDays(periodId)).length).toBe(1); // no attestation landed

    // Heal the aggregate, then the HUMAN attests the red day — the acknowledgment.
    expect((await recoverProfile(deps, org.id)).ok).toBe(true);
    expect(JSON.stringify(await deps.store.loadProfile(org.id))).toBe(JSON.stringify(before));

    // Close is still barred while the exception stands.
    expect(await closePeriod(deps, actor, periodId, newId())).toEqual({
      ok: false,
      reason: "exceptions_open",
    });

    const human = await attestDay(
      deps,
      { kind: "person", actor, capability: "finops.operate" },
      periodId,
      {
        date: redDate,
        checks: [
          {
            name: "finops-aggregates-healthy",
            outcome: "fail",
            detail: "tamper drill — investigated and healed",
          },
        ],
      },
      newId(),
    );
    expect(human.ok).toBe(true);
    expect((await deps.store.loadPeriod(periodId))?.openExceptions).toBe(0);
  });

  it("CLOSE seals reproducible evidence; REOPEN compensates; RE-CLOSE seals fresh", async () => {
    const closed = await closePeriod(deps, actor, periodId, newId());
    expect(closed.ok).toBe(true);
    const sealed = await deps.store.loadPeriod(periodId);
    expect(sealed?.status).toBe("closed");
    expect(sealed?.evidence?.["attestationDigest"]).toBeTruthy();
    expect(sealed?.evidence?.["daysAttested"]).toBe(2);

    const reopened = await reopenPeriod(deps, actor, periodId, "late correction demo", newId());
    expect(reopened.ok).toBe(true);
    expect((await deps.store.loadPeriod(periodId))?.status).toBe("open");
    expect((await deps.store.loadPeriod(periodId))?.evidence).toBeNull();

    const reclosed = await closePeriod(deps, actor, periodId, newId());
    expect(reclosed.ok).toBe(true);
    // The FIRST seal still lives in the log — history is never rewritten.
    const events = await deps.store.loadStream("period", periodId);
    expect(events.filter((event) => event.type === "PeriodClosed")).toHaveLength(2);
    expect(events.filter((event) => event.type === "PeriodReopened")).toHaveLength(1);
  });

  it("PROJECTION REBUILD: destroy the period rows; recovery reproduces them from events", async () => {
    const periodBefore = await deps.store.loadPeriod(periodId);
    const daysBefore = await deps.store.loadPeriodDays(periodId);
    await db.delete(finopsPeriodDays).where(eq(finopsPeriodDays.periodId, periodId));
    await db.delete(finopsPeriods).where(eq(finopsPeriods.id, periodId));

    const { recoverPeriod } = await import("@desiauction/financial-operations/server");
    const recovered = await recoverPeriod(deps, org.id, periodId);
    expect(recovered.ok).toBe(true);

    // Byte-identical on every column the platform reads (ids re-minted on day
    // rows are storage detail; the ROW SHAPES compare exactly).
    expect(JSON.stringify(await deps.store.loadPeriodDays(periodId))).toBe(
      JSON.stringify(daysBefore),
    );
    expect(JSON.stringify(await deps.store.loadPeriod(periodId))).toBe(
      JSON.stringify(periodBefore),
    );
  });
});

describe("M-IP6-1 · The Runner — schedules, retries, leases, dead letters", () => {
  it("derives idempotent schedule jobs; a re-fired slot enqueues nothing new", async () => {
    const nowMs = Date.now();
    await ensureSchedules(deps, nowMs);
    // Force the slot due (robust across repeated suite runs against one DB).
    const due = nextDailyDueMs(nowMs) + 1;
    await deps.store.transact(async (tx) => {
      await tx.putSchedule({ slot: "daily-ops", nextDueMs: due - 1, lastFiredMs: null });
    });
    const first = await runSchedulesOnce(deps, due);
    expect(first.fired).toContain("daily-ops");
    const mine = (await deps.store.loadJobs(org.id)).filter((job) => job.kind === "ops.attest-day");
    expect(mine).toHaveLength(1);

    const again = await runSchedulesOnce(deps, due);
    expect(again.fired).toEqual([]); // the slot advanced past `due`
    // Force-fire the slot once more at the SAME occasion: same derived key, no new job.
    await deps.store.transact(async (tx) => {
      await tx.putSchedule({ slot: "daily-ops", nextDueMs: due - 1, lastFiredMs: null });
    });
    await runSchedulesOnce(deps, due);
    expect(
      (await deps.store.loadJobs(org.id)).filter((job) => job.kind === "ops.attest-day"),
    ).toHaveLength(1);

    // Test hygiene on the SHARED dev DB: this test's forced slot-fire enqueued
    // one attest-day job for EVERY org (residue of many suite runs included).
    // Purge that queue so the drills below drain THEIR job deterministically
    // and no cross-org daily-ops runs fire side effects mid-suite. (CI runs on
    // a fresh DB; this line is for the long-lived local one.)
    await db
      .delete(finopsJobs)
      .where(and(eq(finopsJobs.kind, "ops.attest-day"), eq(finopsJobs.state, "queued")));
  });

  it("RETRY → DEAD LETTER: deterministic backoff, then a red check on the day", async () => {
    const nowMs = Date.now();
    const dedupeKey = `drill:${RUN}`;
    await deps.store.transact(async (tx) => {
      await tx.enqueueJob({
        jobId: newId(),
        orgId: org.id,
        kind: "ops.year-end",
        dedupeKey,
        state: "queued",
        attempts: 0,
        maxAttempts: 2,
        notBeforeMs: nowMs,
        leasedUntilMs: null,
        lastError: null,
        payload: {}, // malformed on purpose: the handler throws
      });
    });

    const first = await drainJobsOnce(deps, nowMs, { limit: 50, orgId: org.id });
    expect(first.retried).toBeGreaterThanOrEqual(1);
    const retryRow = (await deps.store.loadJobs(org.id)).find((job) => job.dedupeKey === dedupeKey);
    expect(retryRow?.state).toBe("queued");
    expect(retryRow?.attempts).toBe(1);
    expect(retryRow?.notBeforeMs).toBe(nowMs + 5_000);
    expect(retryRow?.lastError).toBe("malformed_job_payload");

    // Not due yet → THIS job is not claimed (scoped: residue from other runs
    // on the shared dev DB may lawfully be claimed by the same drain).
    await drainJobsOnce(deps, nowMs + 4_999, { limit: 50, orgId: org.id });
    const stillWaiting = (await deps.store.loadJobs(org.id)).find(
      (job) => job.dedupeKey === dedupeKey,
    );
    expect(stillWaiting?.state).toBe("queued");
    expect(stillWaiting?.attempts).toBe(1);

    const second = await drainJobsOnce(deps, nowMs + 5_001, { limit: 50, orgId: org.id });
    expect(second.dead).toBeGreaterThanOrEqual(1);
    const deadRow = (await deps.store.loadDeadJobs(org.id)).find(
      (job) => job.dedupeKey === dedupeKey,
    );
    expect(deadRow?.state).toBe("dead");
    expect((await runnerHealthSnapshot(deps)).healthy).toBe(false);

    // Ops board truth, then clean the drill so later checks run green.
    const snapshot = await operationalSnapshot(deps, org.id, fy);
    expect(snapshot.deadJobs).toBe(1);
    await db.delete(finopsJobs).where(eq(finopsJobs.dedupeKey, dedupeKey));
  });

  it("CRASH RECOVERY IS A TIMEOUT: a leased job is untouchable until its lease lapses", async () => {
    const nowMs = Date.now();
    const dedupeKey = `crash:${RUN}`;
    await deps.store.transact(async (tx) => {
      await tx.enqueueJob({
        jobId: newId(),
        orgId: org.id,
        kind: "follower.run",
        dedupeKey,
        state: "queued",
        attempts: 0,
        maxAttempts: 5,
        notBeforeMs: nowMs,
        leasedUntilMs: null,
        lastError: null,
        payload: {},
      });
    });

    // "Crash": claim the job (lease it) and never finish it.
    const claimed = await deps.store.claimJobs(nowMs, 60_000, 50, org.id);
    expect(claimed.some((job) => job.dedupeKey === dedupeKey)).toBe(true);
    // While the lease holds, nobody re-claims it.
    const held = await deps.store.claimJobs(nowMs + 59_999, 60_000, 50, org.id);
    expect(held.some((job) => job.dedupeKey === dedupeKey)).toBe(false);
    // After the lease lapses, the work is recovered and completes idempotently.
    const recovered = await drainJobsOnce(deps, nowMs + 60_001, { limit: 50, orgId: org.id });
    expect(recovered.done).toBeGreaterThanOrEqual(1);
    const row = (await deps.store.loadJobs(org.id)).find((job) => job.dedupeKey === dedupeKey);
    expect(row?.state).toBe("done");
    await db.delete(finopsJobs).where(eq(finopsJobs.dedupeKey, dedupeKey));
  });
});

describe("M-IP6-1 · Authorization — the third partition, live", () => {
  it("org:owner and settlement:controller confer ZERO finops power; grants are explicit", async () => {
    expect(await canFinops(db, owner, org.id, "finops.view")).toBe(false);
    expect(await canFinops(db, officer, org.id, "finops.close")).toBe(true);
    expect(await canFinops(db, outsider, org.id, "finops.view")).toBe(false);

    const outsiderActor = await finopsActor(db, outsider, org.id);
    const refused = await declareProfile(
      deps,
      outsiderActor,
      { legalName: "X", posture: "none" },
      newId(),
    );
    expect(refused).toEqual({ ok: false, reason: "not_authorized" });
  });

  it("issuance is gated by the FROZEN grant.issue and refuses unknown sets", async () => {
    expect(await issueFinopsGrant(db, outsider, org.id, outsider, "finops:controller")).toEqual({
      ok: false,
      reason: "forbidden",
    });
    expect(await issueFinopsGrant(db, owner, org.id, outsider, "finops:superuser")).toEqual({
      ok: false,
      reason: "unknown_set",
    });
    const issued = await issueFinopsGrant(db, owner, org.id, outsider, "finops:clerk");
    expect(issued.ok).toBe(true);
    expect(await canFinops(db, outsider, org.id, "finops.view")).toBe(true);
    expect(await canFinops(db, outsider, org.id, "finops.close")).toBe(false);
    if (issued.ok) {
      expect((await revokeFinopsGrant(db, owner, org.id, issued.grantId)).ok).toBe(true);
      expect(await canFinops(db, outsider, org.id, "finops.view")).toBe(false);
    }
  });

  it("RLS PROOF: cross-tenant reads fold to zero and cross-tenant writes are REJECTED (all ten tables)", async () => {
    const role = `rls_finops_${RUN}`;
    const tables =
      "finops_events, finops_profiles, finops_series, finops_documents, finops_dispatches, finops_exports, finops_periods, finops_period_days, finops_cursors, finops_jobs";
    await handle.sql.unsafe(`drop role if exists ${role}`);
    await handle.sql.unsafe(`create role ${role} login password 'probe' nosuperuser nobypassrls`);
    await handle.sql.unsafe(`grant select, insert, update, delete on ${tables} to ${role}`);

    const url = new URL(env.DATABASE_URL);
    const probeHandle = createDb(
      `postgres://${role}:probe@${url.hostname}:${url.port}${url.pathname}`,
    );
    const probe = probeHandle.sql;
    const otherOrg = newId();
    const tableNames = tables.split(", ");
    try {
      // 1 · No tenant context → fail CLOSED on every table (zero rows, no error).
      for (const table of tableNames) {
        const blind = await probe.unsafe(`select count(*)::int as n from ${table}`);
        expect(Number(blind[0]?.["n"])).toBe(0);
      }
      // 2 · A FOREIGN context → this org's rows are invisible on every table.
      const foreign = await probe.begin(async (tx) => {
        await tx`select set_config('app.org_id', ${otherOrg}, true)`;
        const counts: number[] = [];
        for (const table of tableNames) {
          const rows = await tx.unsafe(`select count(*)::int as n from ${table}`);
          counts.push(Number(rows[0]?.["n"]));
        }
        return counts;
      });
      expect(foreign).toEqual(tableNames.map(() => 0));
      // 3 · Its OWN context → its rows are there.
      const own = await probe.begin(async (tx) => {
        await tx`select set_config('app.org_id', ${org.id}, true)`;
        const rows = await tx.unsafe(`select count(*)::int as n from finops_events`);
        return Number(rows[0]?.["n"]);
      });
      expect(own).toBeGreaterThan(0);
      // 4 · WRITE side: a row scoped to ANOTHER org is rejected by WITH CHECK
      //     even while holding a legitimate context.
      await expect(
        probe.begin(async (tx) => {
          await tx`select set_config('app.org_id', ${org.id}, true)`;
          await tx`insert into finops_cursors (id, org_id, stream_type, stream_id, last_seq, updated_at_ms)
                   values (${newId()}, ${otherOrg}, 'case', ${newId()}, 1, 1)`;
        }),
      ).rejects.toThrow(/row-level security/i);
      // 5 · …and a row scoped to the ACTIVE org is allowed.
      const allowed = await probe.begin(async (tx) => {
        await tx`select set_config('app.org_id', ${org.id}, true)`;
        const id = newId();
        await tx`insert into finops_cursors (id, org_id, stream_type, stream_id, last_seq, updated_at_ms)
                 values (${id}, ${org.id}, 'probe', ${newId()}, 1, 1)`;
        await tx`delete from finops_cursors where id = ${id}`;
        return true;
      });
      expect(allowed).toBe(true);
    } finally {
      await probeHandle.sql.end({ timeout: 5 });
      await handle.sql.unsafe(`revoke all on ${tables} from ${role}`);
      await handle.sql.unsafe(`drop role if exists ${role}`);
    }
  }, 60_000);
});

describe("M-IP6-1 · Audit & the constitutional boundary", () => {
  it("every finops event carries one audit row with its evidence seq", async () => {
    const streams: { type: "profile" | "series" | "dispatch" | "export" | "period"; id: string }[] =
      [
        { type: "profile", id: org.id },
        { type: "series", id: seriesId },
        { type: "period", id: periodId },
      ];
    for (const stream of streams) {
      const events = await deps.store.loadStream(stream.type, stream.id);
      expect(events.length).toBeGreaterThan(0);
      const rows = await db
        .select()
        .from(auditLog)
        .where(and(eq(auditLog.scopeId, org.id), eq(auditLog.subject, stream.id)));
      for (const event of events) {
        expect(
          rows.some(
            (row) =>
              row.action === `finops.${event.type}` &&
              (row.meta as { eventSeq?: string }).eventSeq === String(event.seq),
          ),
        ).toBe(true);
      }
    }
    // Overrides carry their WHY.
    const reopens = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.scopeId, org.id), eq(auditLog.action, "finops.PeriodReopened")));
    expect(reopens.length).toBeGreaterThan(0);
    expect((reopens[0]?.meta as { reason?: string }).reason).toBeTruthy();
  });

  it("REPLAY DETERMINISM: every finops stream folds twice to identical bytes", async () => {
    for (const streamType of ["profile", "series", "dispatch", "export", "period"] as const) {
      for (const streamId of await deps.store.listStreamIds(org.id, streamType)) {
        const first = await foldStream(deps, streamType, streamId);
        const second = await foldStream(deps, streamType, streamId);
        expect(first).not.toBeNull();
        expect(first?.ok).toBe(true);
        expect(JSON.stringify(first)).toBe(JSON.stringify(second));
      }
    }
    expect(await verifyOrgFinops(deps, org.id)).toEqual([]);
  });

  it("THE BOUNDARY HELD: financial operations appended ZERO settlement events", async () => {
    // Everything this suite did — following, declaring, issuing, dispatching,
    // exporting, attesting, closing, tampering, recovering, scheduling —
    // added NOTHING to the settlement log. Settlement remains the only
    // authority on money, untouched.
    expect(await settlementEventCount()).toBe(settlementEventCountAtStart);
  });
});
