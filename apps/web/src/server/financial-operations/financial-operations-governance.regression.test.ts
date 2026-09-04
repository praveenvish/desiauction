// PERMANENT FINANCIAL-OPERATIONS GOVERNANCE REGRESSION SUITE (IP-6, M-IP6-4).
//
// Encodes the frozen contract of the governance layer against LIVE Postgres:
// health DERIVED from folds and observation (false health is impossible — a
// pretty row cannot fake a broken fold; an unobservable component is never
// healthy), the FULL daily checklist, fiscal close with the year-scale
// evidence package (pinned, byte-reproducible, verifiable across reopens
// forever), certification derived from double replay (duplicates are
// harmless because deterministic; forged claims are exposed by
// re-derivation), reconciliation SUPERVISION of settlement through frozen
// read-only folds — and the boundary meters: governance edited NOTHING it
// governs.
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
  paddleGrants as paddleGrantsTable,
  paddles as paddlesTable,
  people,
  registrations as registrationsTable,
  sessions,
  settlementCases,
  settlementEvents,
  settlementObligations,
  type DbHandle,
} from "@desiauction/db";
import {
  endedFiscalYearFor,
  fiscalYearBounds,
  previousDate,
} from "@desiauction/financial-operations";
import {
  attestDay,
  certificationRegisterSnapshot,
  certificationSnapshot,
  certifyOperations,
  closePeriod,
  complianceQueueSnapshot,
  complianceSnapshot,
  declareProfile,
  drainJobsOnce,
  enqueueDispatchSends,
  enqueueExportGenerations,
  ensureSchedules,
  evidenceRegisterSnapshot,
  evidenceSnapshot,
  finopsDeps,
  fiscalCloseSnapshot,
  fiscalTimelineSnapshot,
  issueInvoice,
  issueReceipt,
  openPeriod,
  openSeries,
  operationalChecklistSnapshot,
  operationsDashboardSnapshot,
  recoverPeriod,
  recoverSeries,
  regenerateExportArtifact,
  reopenPeriod,
  requestDispatch,
  requestExport,
  rewindFollower,
  runDailyOps,
  runFollower,
  runYearEnd,
  superviseOperations,
  verifyYearEnd,
  type FinopsActor,
  type FinopsDeps,
} from "@desiauction/financial-operations/server";
import { and, eq, inArray, like, sql } from "drizzle-orm";
import { rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
  computeCaseObligations,
  createPayment,
  openCase,
  verifyCase,
  waiveObligation,
} from "../settlement/writer";
import { issueSettlementGrant, settlementActor } from "../settlement/authz";
import { settlementDeps, type SettlementDeps } from "../settlement/deps";
import type { SettlementActor as SActor } from "../settlement/writer";
import { finopsActor, issueFinopsGrant } from "./authz";
import { purgeOrg } from "../test-support/purge-org";

const handle: DbHandle = createDb(env.DATABASE_URL);
const db = handle.db;
const sender = new DevInboxSender(db);

const RUN = String(Date.now()).slice(-7);
const PHONE_OWNER = `+9183${RUN}1`;
const PHONE_OFFICER = `+9182${RUN}2`;
const PHONE_OUTSIDER = `+9181${RUN}3`;
const TEST_PHONES = [PHONE_OWNER, PHONE_OFFICER, PHONE_OUTSIDER];
const SEED_PHONE_PREFIX = `+91900${RUN}`;
const STORAGE_DIR = join(tmpdir(), `finops-governance-${RUN}`);

const SALE_A = 5_000_000;
const SALE_B = 2_500_000;
const TIGERS_DUE = SALE_A * 2;
const LIONS_DUE = SALE_B;
const PARTIAL = 4_000_000;
const REMAINDER = TIGERS_DUE - PARTIAL;

let owner = "";
let officer = "";
let outsider = "";
let org = { id: "", name: "", slug: "" };
let comp: CompetitionSummary = null as unknown as CompetitionSummary;
let auction: AuctionRecord = null as unknown as AuctionRecord;
const teamIds: string[] = [];
const paddleIds: string[] = [];

let sdeps: SettlementDeps;
let sactor: SActor;
let deps: FinopsDeps;
let actor: FinopsActor;
let caseId = "";
let payment1 = "";
let payment2 = "";
/** The ended FY the governance period seals; documents live in the current FY. */
let periodFy = "";
let currentFy = "";
let periodId = "";
let receiptSeries = "";
let invoiceSeries = "";
let receipt1 = "";
let exportId = "";
let firstCloseSeq = 0;

let settlementCountAtRest = 0;

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
  const completed = await transitionAuction(
    db,
    auction,
    owner,
    "complete",
    undefined,
    /* squads are deliberately tiny in this fixture — override DA-06 */ true,
  );
  if (!completed.ok) {
    throw new Error("complete");
  }
}

async function settlementEventCount(): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(settlementEvents)
    .where(eq(settlementEvents.orgId, org.id));
  return row?.n ?? 0;
}

async function drainAll(nowMs: number): Promise<void> {
  await enqueueDispatchSends(deps, nowMs);
  await enqueueExportGenerations(deps, nowMs);
  await drainJobsOnce(deps, nowMs, { limit: 50, orgId: org.id });
}

async function overall(): Promise<string> {
  return (await superviseOperations(deps, org.id)).overall;
}

beforeAll(async () => {
  owner = await login(PHONE_OWNER);
  officer = await login(PHONE_OFFICER);
  outsider = await login(PHONE_OUTSIDER);

  org = await createOrg(db, owner, `Governance ${RUN}`);
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

  sdeps = settlementDeps(db, { checkpointCadence: 2 });
  const sgrant = await issueSettlementGrant(db, owner, org.id, officer, "settlement:controller");
  if (!sgrant.ok) {
    throw new Error("settlement grant");
  }
  sactor = await settlementActor(db, officer, org.id);
  const opened = await openCase(sdeps, sactor, {
    commandId: newId(),
    auctionId: auction.id,
    basis: "committed",
  });
  if (!opened.ok) {
    throw new Error(`openCase: ${opened.reason}`);
  }
  caseId = opened.caseId;
  if (!(await verifyCase(sdeps, sactor, caseId, newId())).ok) {
    throw new Error("verifyCase");
  }
  if (!(await computeCaseObligations(sdeps, sactor, caseId, newId())).ok) {
    throw new Error("compute");
  }
  payment1 = newId();
  const created = await createPayment(sdeps, sactor, {
    paymentId: payment1,
    commandId: newId(),
    caseId,
    teamId: tigers(),
    method: "manual:cash",
    amount: PARTIAL,
  });
  if (!created.ok) {
    throw new Error("createPayment");
  }
  if (
    !(
      await attestManualCapture(sdeps, sactor, payment1, newId(), {
        attestedBy: officer,
        evidenceRef: "cash-book",
      })
    ).ok
  ) {
    throw new Error("attest");
  }
  const waived = await waiveObligation(sdeps, sactor, caseId, newId(), {
    teamId: lions(),
    amount: LIONS_DUE,
    reason: "sponsor covered",
  });
  if (!waived.ok) {
    throw new Error("waive");
  }

  deps = finopsDeps(db, { storageDir: STORAGE_DIR });
  periodFy = endedFiscalYearFor(Date.now());
  const fgrant = await issueFinopsGrant(db, owner, org.id, officer, "finops:controller");
  if (!fgrant.ok) {
    throw new Error("finops grant");
  }
  actor = await finopsActor(db, officer, org.id);
  if (
    !(
      await declareProfile(
        deps,
        actor,
        { legalName: `Governance ${RUN} Trust`, posture: "none" },
        newId(),
      )
    ).ok
  ) {
    throw new Error("declareProfile");
  }
  await runFollower(deps, org.id);
  await ensureSchedules(deps, Date.now());

  const { fiscalYearOf, istDateOf } = await import("@desiauction/financial-operations");
  currentFy = fiscalYearOf(istDateOf(Date.now()));
  for (const [kind, prefix, assign] of [
    ["receipt", "RCT", (id: string) => (receiptSeries = id)],
    ["tax-invoice", "INV", (id: string) => (invoiceSeries = id)],
  ] as const) {
    const ack = await openSeries(deps, actor, { kind, fy: currentFy, prefix }, newId());
    if (!ack.ok) {
      throw new Error(`openSeries ${kind}`);
    }
    assign(ack.streamId);
  }
  const receipted = await issueReceipt(
    deps,
    { kind: "person", actor, capability: "finops.document" },
    { seriesId: receiptSeries, paymentId: payment1 },
    newId(),
  );
  if (!receipted.ok) {
    throw new Error(`issueReceipt: ${receipted.reason}`);
  }
  receipt1 = (await deps.store.loadDocuments(receiptSeries))[0]?.docId ?? "";
  if (
    !(
      await issueInvoice(deps, actor, { seriesId: invoiceSeries, caseId, teamId: lions() }, newId())
    ).ok
  ) {
    throw new Error("issueInvoice");
  }

  // One confirmed dispatch + one completed export: real delivery-layer state
  // for the supervisor to observe.
  const dispatched = await requestDispatch(
    deps,
    actor,
    {
      channel: "in-app",
      recipientRef: `owner:${tigers()}`,
      templateId: "receipt-issued",
      templateVersion: "v1",
      subjectRef: `doc:${receipt1}`,
    },
    newId(),
  );
  if (!dispatched.ok) {
    throw new Error("requestDispatch");
  }
  const exported = await requestExport(
    deps,
    actor,
    { kind: "journal-csv", params: { fy: currentFy } },
    newId(),
  );
  if (!exported.ok) {
    throw new Error("requestExport");
  }
  exportId = exported.streamId;
  await drainAll(Date.now());
}, 180_000);

afterAll(async () => {
  // PA-1R Phase 3: the spine this teardown never deleted (see purge-org.ts).
  await purgeOrg(db, org.id);
  rmSync(STORAGE_DIR, { recursive: true, force: true });
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
  // THE AUCTION SIDE, BEFORE THE PEOPLE WHO OWN IT (migration 0040).
  // `paddles`, `paddle_grants` and `registrations` now hold a RESTRICT foreign
  // key to `people`. Deleting the people first is therefore REFUSED, instead of
  // silently leaving rows pointing at nobody — which is what this teardown used
  // to do, and precisely the orphaning the constraint exists to prevent.
  await db.delete(paddleGrantsTable).where(eq(paddleGrantsTable.orgId, org.id));
  await db.delete(paddlesTable).where(eq(paddlesTable.orgId, org.id));
  await db.delete(registrationsTable).where(eq(registrationsTable.orgId, org.id));
  await db.delete(organizations).where(eq(organizations.id, org.id));
  await db.delete(otpCodes).where(inArray(otpCodes.phone, TEST_PHONES));
  await db.delete(otpInbox).where(inArray(otpInbox.phone, TEST_PHONES));
  await db.delete(sessions).where(inArray(sessions.personId, [owner, officer, outsider]));
  await db.delete(people).where(inArray(people.phone, TEST_PHONES));
  await db.delete(people).where(like(people.phone, `${SEED_PHONE_PREFIX}%`));
  await handle.sql.end({ timeout: 5 });
}, 60_000);

describe("M-IP6-4 · The Supervisor — health is derived, false health is impossible", () => {
  it("a settled, current, verified system derives HEALTHY on all seven components", async () => {
    const verdict = await superviseOperations(deps, org.id);
    expect(verdict.components).toHaveLength(7);
    expect(verdict.components.filter((c) => c.status !== "healthy")).toEqual([]);
    expect(verdict.overall).toBe("healthy");
    const checklist = await operationalChecklistSnapshot(deps, org.id);
    expect(checklist.green).toBe(true);
    expect(checklist.checks).toHaveLength(8);
  });

  it("FALSE HEALTH attack: a prettied-up row cannot fake a broken fold", async () => {
    await db.update(finopsDocuments).set({ amount: 1 }).where(eq(finopsDocuments.id, receipt1));
    const verdict = await superviseOperations(deps, org.id);
    expect(verdict.overall).toBe("failed");
    expect(verdict.components.find((c) => c.component === "documents")?.status).toBe("failed");
    const queue = await complianceQueueSnapshot(deps, org.id);
    expect(queue.items.some((item) => item.kind.startsWith("health:documents"))).toBe(true);

    expect((await recoverSeries(deps, org.id, receiptSeries)).ok).toBe(true);
    expect(await overall()).toBe("healthy");
  });

  it("WATERMARK CORRUPTION: a cursor claiming unconsumed history FAILS the follower", async () => {
    const [cursor] = await deps.store.loadCursors(org.id);
    await db
      .update(finopsCursors)
      .set({ lastSeq: (cursor?.lastSeq ?? 0) + 10 })
      .where(
        and(
          eq(finopsCursors.orgId, org.id),
          eq(finopsCursors.streamType, cursor?.streamType ?? ""),
          eq(finopsCursors.streamId, cursor?.streamId ?? ""),
        ),
      );
    const verdict = await superviseOperations(deps, org.id);
    expect(verdict.components.find((c) => c.component === "follower")?.status).toBe("failed");

    await rewindFollower(deps, org.id);
    await runFollower(deps, org.id);
    expect(await overall()).toBe("healthy");
  });

  it("MISSING EXPORT ARTIFACT: detected by verification, healed from sources — never trusted", async () => {
    const run = await deps.store.loadExport(exportId);
    const file = join(STORAGE_DIR, "artifacts", run?.artifactRef ?? "");
    writeFileSync(file, "GARBAGE", "utf8");
    const verdict = await superviseOperations(deps, org.id);
    expect(verdict.components.find((c) => c.component === "exports")?.status).toBe("failed");

    expect(await regenerateExportArtifact(deps, exportId)).toEqual({ ok: true });
    expect(await overall()).toBe("healthy");
  });

  it("RECONCILIATION SUPERVISION: a stale open payment flags the missing settlement sweep", async () => {
    payment2 = newId();
    const created = await createPayment(sdeps, sactor, {
      paymentId: payment2,
      commandId: newId(),
      caseId,
      teamId: tigers(),
      method: "manual:cash",
      amount: REMAINDER,
    });
    expect(created.ok).toBe(true);
    await runFollower(deps, org.id);

    const later = Date.now() + 25 * 60 * 60 * 1000;
    const verdict = await superviseOperations(deps, org.id, later);
    const sync = verdict.components.find((c) => c.component === "settlement-sync");
    expect(sync?.status).toBe("degraded");
    expect(sync?.detail).toContain("expiry sweep");

    // The human resolves it the settlement way (capture); supervision clears.
    expect(
      (
        await attestManualCapture(sdeps, sactor, payment2, newId(), {
          attestedBy: officer,
          evidenceRef: "cash-book-2",
        })
      ).ok,
    ).toBe(true);
    await runFollower(deps, org.id);
    settlementCountAtRest = await settlementEventCount();
    // The sweep signal clears at the same future instant (the drill's subject);
    // overall health is judged at the real clock (the synthetic +25h would
    // lawfully flag the schedules as overdue — a different, correct verdict).
    const after = await superviseOperations(deps, org.id, later);
    expect(after.components.find((c) => c.component === "settlement-sync")?.status).toBe("healthy");
    expect(await overall()).toBe("healthy");
  });
});

describe("M-IP6-4 · Fiscal close — the year sealed with reproducible evidence", () => {
  const bounds = () => fiscalYearBounds(periodFy);

  it("opens the ended year; the FULL checklist attests its days", async () => {
    const openedPeriod = await openPeriod(deps, actor, { fy: periodFy }, newId());
    expect(openedPeriod.ok).toBe(true);
    periodId = openedPeriod.ok ? openedPeriod.streamId : "";

    await runDailyOps(deps, {
      jobId: newId(),
      orgId: org.id,
      kind: "ops.attest-day",
      dedupeKey: `ops.attest-day:${org.id}:${bounds().end}`,
      state: "leased",
      attempts: 0,
      maxAttempts: 5,
      notBeforeMs: Date.now(),
      leasedUntilMs: null,
      lastError: null,
      payload: { date: bounds().end },
    });
    const days = await deps.store.loadPeriodDays(periodId);
    expect(days).toHaveLength(1);
    expect(days[0]?.attestorKind).toBe("system");
    expect(days[0]?.checks).toHaveLength(8); // the COMPLETED checklist
    expect(days[0]?.failures).toBe(0);

    const closeView = await fiscalCloseSnapshot(deps, periodId);
    expect(closeView?.fiscalYearEnded).toBe(true);
    // A period opened AFTER its year ended has zero mandatory coverage days
    // (the mid-year-adoption rule) — it is sealable once exceptions are clear.
    expect(closeView?.ready).toBe(true);
  });

  it("a RED day notes a mapped exception; a human answers it", async () => {
    const redDate = previousDate(bounds().end);
    await db.update(finopsDocuments).set({ amount: 7 }).where(eq(finopsDocuments.id, receipt1));
    await runDailyOps(deps, {
      jobId: newId(),
      orgId: org.id,
      kind: "ops.attest-day",
      dedupeKey: `ops.attest-day:${org.id}:${redDate}`,
      state: "leased",
      attempts: 0,
      maxAttempts: 5,
      notBeforeMs: Date.now(),
      leasedUntilMs: null,
      lastError: null,
      payload: { date: redDate },
    });
    expect((await deps.store.loadPeriod(periodId))?.openExceptions).toBeGreaterThanOrEqual(1);
    expect((await recoverSeries(deps, org.id, receiptSeries)).ok).toBe(true);

    const human = await attestDay(
      deps,
      { kind: "person", actor, capability: "finops.operate" },
      periodId,
      {
        date: redDate,
        checks: [{ name: "finops-aggregates-healthy", outcome: "fail", detail: "drill — healed" }],
      },
      newId(),
    );
    expect(human.ok).toBe(true);
    expect((await deps.store.loadPeriod(periodId))?.openExceptions).toBe(0);
  });

  it("SEAL THE YEAR: evidence v2 pins registers; reproduction is byte-exact", async () => {
    const sealed = await closePeriod(deps, actor, periodId, newId());
    expect(sealed.ok).toBe(true);
    firstCloseSeq = sealed.ok ? sealed.seq : 0;

    const snapshot = await evidenceSnapshot(deps, periodId);
    expect(snapshot?.evidence?.["evidenceVersion"]).toBe(2);
    const documents = snapshot?.evidence?.["documents"] as { total: number };
    expect(documents.total).toBe(2); // receipt1 + Lions invoice
    expect(snapshot?.reproduction?.matches).toBe(true);
    expect(snapshot?.reproduction?.checks?.every((check) => check.matches)).toBe(true);

    const timeline = await fiscalTimelineSnapshot(deps, periodId);
    expect(timeline?.entries.map((entry) => entry.type)).toContain("PeriodClosed");
  });

  it("FISCAL REOPEN attack: the old seal verifies FOREVER — even after new documents and a re-close", async () => {
    const reopened = await reopenPeriod(deps, actor, periodId, "late correction drill", newId());
    expect(reopened.ok).toBe(true);

    // New history AFTER the seal: another receipt (payment2's).
    const issued = await issueReceipt(
      deps,
      { kind: "person", actor, capability: "finops.document" },
      { seriesId: receiptSeries, paymentId: payment2 },
      newId(),
    );
    expect(issued.ok).toBe(true);

    // The FIRST seal still reproduces from its PINNED prefixes.
    const oldSeal = await evidenceSnapshot(deps, periodId, firstCloseSeq);
    expect(oldSeal?.reproduction?.matches).toBe(true);

    const resealed = await closePeriod(deps, actor, periodId, newId());
    expect(resealed.ok).toBe(true);
    const register = await evidenceRegisterSnapshot(deps, org.id);
    expect(register.seals).toHaveLength(2);
    expect(register.seals.every((seal) => seal.verified)).toBe(true);
    const newSeal = await evidenceSnapshot(deps, periodId);
    expect((newSeal?.evidence?.["documents"] as { total: number }).total).toBe(3);
  });

  it("FORGED EVIDENCE: a tampered evidence ROW halts commands; the log's seal stays true", async () => {
    await db
      .update(finopsPeriods)
      .set({ evidence: { forged: true } })
      .where(eq(finopsPeriods.id, periodId));
    const halted = await reopenPeriod(deps, actor, periodId, "should halt", newId());
    expect(halted.ok).toBe(false);
    if (!halted.ok) {
      expect(halted.reason).toBe("finops_halted");
    }
    // The seal itself — sealed in the EVENT — still reproduces.
    expect((await evidenceSnapshot(deps, periodId))?.reproduction?.matches).toBe(true);
    expect((await recoverPeriod(deps, org.id, periodId)).ok).toBe(true);
    expect(await overall()).toBe("healthy");
  });

  it("YEAR-END verification records readiness and appends NOTHING; replay is idempotent", async () => {
    const before = (await deps.store.loadStream("period", periodId)).length;
    const job = {
      jobId: newId(),
      orgId: org.id,
      kind: "ops.year-end" as const,
      dedupeKey: `ops.year-end:${org.id}:${periodFy}`,
      state: "leased" as const,
      attempts: 0,
      maxAttempts: 5,
      notBeforeMs: Date.now(),
      leasedUntilMs: null,
      lastError: null,
      payload: { fy: periodFy },
    };
    await runYearEnd(deps, job);
    await runYearEnd(deps, job); // replayed — still appends nothing
    expect((await deps.store.loadStream("period", periodId)).length).toBe(before);
    const verification = await verifyYearEnd(deps, org.id, periodFy);
    expect(verification.periodExists).toBe(true);
    expect(verification.status).toBe("closed");
    expect(verification.awaitingClose).toBe(false);
  });
});

describe("M-IP6-4 · Certification — derived from replay, forgery-proof", () => {
  it("DUPLICATE CERTIFICATION is harmless: two runs derive identical digests", async () => {
    const first = await certifyOperations(deps, org.id);
    const second = await certifyOperations(deps, org.id);
    expect(first.ok && second.ok).toBe(true);
    expect(first.digest).toBe(second.digest);
    expect(first.report?.pass).toBe(true);
    expect(first.report?.checks.every((check) => check.pass)).toBe(true);

    const snapshot = await certificationSnapshot(deps, org.id);
    expect(snapshot?.pass).toBe(true);
    expect(snapshot?.digest).toBe(first.digest);

    const register = await certificationRegisterSnapshot(deps, org.id);
    expect(register.history.length).toBeGreaterThanOrEqual(2);
    expect(register.latestClaimMatchesRederivation).toBe(true);
  });

  it("FORGED CERTIFICATION: a claimed digest that replay contradicts is exposed", async () => {
    await db.insert(auditLog).values({
      id: newId(),
      actor: officer,
      action: "finops.CertificationDerived",
      scopeType: "org",
      scopeId: org.id,
      subject: org.id,
      meta: { source: "runner", correlationId: newId(), eventSeq: "0", reason: "PASS · deadbeef" },
    });
    const register = await certificationRegisterSnapshot(deps, org.id);
    expect(register.latestClaimMatchesRederivation).toBe(false);
  });

  it("THE DASHBOARD and COMPLIANCE views assemble from the same derivations", async () => {
    const dashboard = await operationsDashboardSnapshot(deps, org.id, periodFy);
    expect(dashboard.overall).toBe("healthy");
    expect(dashboard.fiscal.status).toBe("closed");
    expect(dashboard.archive.completed).toBeGreaterThanOrEqual(1);

    const compliance = await complianceSnapshot(deps, org.id, periodFy);
    expect(compliance.documents.reproducible).toBe(true);
    expect(compliance.exports.verified).toBe(true);
    expect(compliance.evidenceVerified).toBe(true);
  });

  it("THE BOUNDARY HELD: governance appended ZERO settlement events", async () => {
    expect(settlementCountAtRest).toBeGreaterThan(0);
    expect(await settlementEventCount()).toBe(settlementCountAtRest);
  });
});
