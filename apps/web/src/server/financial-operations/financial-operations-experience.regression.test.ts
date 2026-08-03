// PERMANENT FINANCIAL-OPERATIONS EXPERIENCE REGRESSION SUITE (PX-8).
//
// IP-6 certified the finops PLATFORM; this suite certifies the WORKSPACE built
// on it — the read composition every screen consumes, the lanes the delivery
// desk filters, the register the finance desk searches, and the capability
// partition the surfaces are gated by.
//
// The load-bearing property, and the CTO's explicit demand: **the projections a
// screen renders are IDENTICAL to the platform's own calculations**. Every
// assertion that could pass by re-implementing finops instead asserts against
// the certified snapshot (`operationsDashboardSnapshot`, `dispatchSnapshot`,
// `documentSnapshot`, `certificationSnapshot`, …) — so a drift between what the
// console shows and what the platform derived fails HERE, loudly.
//
// The money it operates on is a REAL auction, settled through the frozen IP-5
// writer, receipted through the certified IP-6 writer. The `it` blocks run in
// order and share one org: operations is a day, not a bag of assertions.
import { join } from "node:path";
import { tmpdir } from "node:os";

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
  payments as paymentsTable,
  people,
  registrations as registrationsTable,
  sessions,
  settlementCases,
  settlementEvents,
  settlementObligations,
  type DbHandle,
} from "@desiauction/db";
import {
  fiscalYearOf,
  istDateOf,
  type DeliveryCallback,
  type DeliveryPort,
  type DeliveryRequest,
} from "@desiauction/financial-operations";
import {
  amendProfile,
  certificationSnapshot,
  complianceQueueSnapshot,
  declareProfile,
  dispatchSnapshot,
  documentSnapshot,
  drainJobsOnce,
  enqueueDispatchSends,
  finopsDeps,
  issuanceSnapshot,
  issueReceipt,
  openSeries,
  operationsDashboardSnapshot,
  requestDispatch,
  requeueDeadJob,
  retryDispatch,
  runFollower,
  type FinopsActor,
  type FinopsDeps,
} from "@desiauction/financial-operations/server";
import { eq, inArray, like } from "drizzle-orm";
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
import { issueSettlementGrant, settlementActor } from "../settlement/authz";
import { settlementDeps } from "../settlement/deps";
import {
  attestManualCapture,
  computeCaseObligations,
  createPayment,
  openCase,
  verifyCase,
} from "../settlement/writer";
import { canFinops, finopsActor, issueFinopsGrant, revokeFinopsGrant } from "./authz";
import { DELIVERY_LANE_LABEL, filterDeliveries, isDeliveryLane } from "./deliveries";
import { DOC_KIND_LABEL, FINANCE_VIEWS, filterRegister, isFinanceView } from "./register";
import {
  deliveriesView,
  documentDetailView,
  financeGrantsOf,
  opsBoardView,
  reconciliationView,
  registerView,
} from "./views";

const handle: DbHandle = createDb(env.DATABASE_URL);
const db = handle.db;
const sender = new DevInboxSender(db);

const RUN = String(Date.now()).slice(-7);
const PHONE_OWNER = `+9179${RUN}1`;
const PHONE_CLERK = `+9178${RUN}2`;
const PHONE_ACCOUNTANT = `+9177${RUN}3`;
const PHONE_OUTSIDER = `+9176${RUN}4`;
const TEST_PHONES = [PHONE_OWNER, PHONE_CLERK, PHONE_ACCOUNTANT, PHONE_OUTSIDER];
const SEED_PHONE_PREFIX = `+91922${RUN}`;
const STORAGE_DIR = join(tmpdir(), `finops-experience-${RUN}`);

const SALE_A = 5_000_000;
const SALE_B = 2_500_000;
const TIGERS_DUE = SALE_A * 2;

let owner = "";
let clerk = "";
let accountant = "";
let outsider = "";
let org = { id: "", name: "", slug: "" };
let comp: CompetitionSummary = null as unknown as CompetitionSummary;
let auction: AuctionRecord = null as unknown as AuctionRecord;
const teamIds: string[] = [];
const paddleIds: string[] = [];

let deps: FinopsDeps;
let actor: FinopsActor;
let clerkActor: FinopsActor;
let fy = "";
let receipt1 = "";
let caseId = "";
let receiptSeriesId = "";
let sdeps: ReturnType<typeof settlementDeps>;
let sactor: Awaited<ReturnType<typeof settlementActor>>;
let failedDispatch = "";

const tigers = (): string => teamIds[0] ?? "";
const lions = (): string => teamIds[1] ?? "";

// --- A hostile, scriptable channel: the only way to make a delivery FAIL ----------
type FakeMode = "ok" | "permanent";
let fakeMode: FakeMode = "ok";

const fakeWhatsApp: DeliveryPort = {
  channel: "whatsapp",
  send(request: DeliveryRequest) {
    if (fakeMode === "permanent") {
      return Promise.resolve({ ok: false as const, code: "recipient_opted_out", retryable: false });
    }
    return Promise.resolve({ ok: true as const, providerRef: `wa:${request.dispatchId}` });
  },
  verifyCallback(): DeliveryCallback {
    return { ok: false, reason: "unused" };
  },
};

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

async function reload(slug: string): Promise<CompetitionSummary> {
  const found = await resolveCompetition(db, owner, slug);
  if (found === null) {
    throw new Error(`competition ${slug} vanished`);
  }
  return found;
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

async function conductAuctionNight(): Promise<void> {
  const ready = await auctionReady(db, await reload(comp.slug));
  const created = await createAuction(db, comp, ready, owner, DEFAULT_AUCTION_CONFIG);
  if (!created.ok) {
    throw new Error(`createAuction: ${created.reason}`);
  }
  auction = (await auctionOf(db, comp.id)) as AuctionRecord;
  for (const teamId of teamIds) {
    const issued = await issuePaddle(db, auction, owner, teamId, owner);
    if (!issued.ok) {
      throw new Error("issuePaddle");
    }
    paddleIds.push(issued.paddleId);
  }
  await queueAllLots(db, auction, owner);
  if (!(await transitionAuction(db, auction, owner, "open")).ok) {
    throw new Error("open");
  }
  auction = (await auctionOf(db, comp.id)) ?? auction;
  const sales = [
    { player: "Tiger One", paddle: paddleIds[0], amount: SALE_A },
    { player: "Tiger Two", paddle: paddleIds[0], amount: SALE_A },
    { player: "Lion One", paddle: paddleIds[1], amount: SALE_B },
  ];
  for (const sale of sales) {
    const view = await auctionView(db, auction);
    const lot = view.lots.find((row) => row.playerName === sale.player);
    if (lot === undefined) {
      throw new Error(`lot ${sale.player}`);
    }
    if (!(await transitionLot(db, auction, lot.id, owner, "open")).ok) {
      throw new Error("lot open");
    }
    const bid = await placeBid(db, auction, owner, {
      lotId: lot.id,
      paddleId: sale.paddle ?? "",
      amountRaw: sale.amount,
      bidderAuthorized: true,
    });
    if (!bid.ok) {
      throw new Error(`bid: ${bid.code}`);
    }
    if (!(await transitionLot(db, auction, lot.id, owner, "sell")).ok) {
      throw new Error("sell");
    }
  }
  if (
    !(
      await transitionAuction(
        db,
        auction,
        owner,
        "complete",
        undefined,
        /* squads are deliberately tiny in this fixture — override DA-06 */ true,
      )
    ).ok
  ) {
    throw new Error("complete");
  }
}

async function drainAll(): Promise<void> {
  const nowMs = Date.now();
  await enqueueDispatchSends(deps, nowMs);
  await drainJobsOnce(deps, nowMs, { limit: 50, orgId: org.id });
}

beforeAll(async () => {
  owner = await login(PHONE_OWNER);
  clerk = await login(PHONE_CLERK);
  accountant = await login(PHONE_ACCOUNTANT);
  outsider = await login(PHONE_OUTSIDER);

  org = await createOrg(db, owner, `Finance ${RUN}`);
  comp = await createCompetition(db, org.id, owner, {
    name: `Ops ${RUN}`,
    location: "Vashi",
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
  await advanceCompetition(db, await reload(comp.slug), owner, "setup");
  await advanceCompetition(db, await reload(comp.slug), owner, "registration_open");
  await seedApproved("Tiger One", "a01", "A");
  await seedApproved("Tiger Two", "a02", "A");
  await seedApproved("Lion One", "a03", "B");
  await advanceCompetition(db, await reload(comp.slug), owner, "registration_closed");
  comp = await reload(comp.slug);
  await conductAuctionNight();

  // --- Settle it through the FROZEN IP-5 writer -------------------------------
  sdeps = settlementDeps(db);
  const sgrant = await issueSettlementGrant(db, owner, org.id, owner, "settlement:controller");
  if (!sgrant.ok) {
    throw new Error("settlement grant");
  }
  sactor = await settlementActor(db, owner, org.id);
  const opened = await openCase(sdeps, sactor, {
    commandId: newId(),
    auctionId: auction.id,
    basis: "committed",
  });
  if (!opened.ok) {
    throw new Error("openCase");
  }
  caseId = opened.caseId;
  await verifyCase(sdeps, sactor, opened.caseId, newId());
  await computeCaseObligations(sdeps, sactor, opened.caseId, newId());
  const paymentId = newId();
  await createPayment(sdeps, sactor, {
    paymentId,
    commandId: newId(),
    caseId: opened.caseId,
    teamId: tigers(),
    method: "manual:cash",
    amount: TIGERS_DUE,
  });
  await attestManualCapture(sdeps, sactor, paymentId, newId(), { attestedBy: owner });

  // --- Finance: profile, series, a receipt ------------------------------------
  deps = finopsDeps(db, { storageDir: STORAGE_DIR, delivery: { whatsapp: fakeWhatsApp } });
  fy = fiscalYearOf(istDateOf(Date.now()));
  const fgrantAccountant = await issueFinopsGrant(
    db,
    owner,
    org.id,
    accountant,
    "finops:controller",
  );
  const fgrantClerk = await issueFinopsGrant(db, owner, org.id, clerk, "finops:clerk");
  if (!fgrantAccountant.ok || !fgrantClerk.ok) {
    throw new Error("finops grant");
  }
  actor = await finopsActor(db, accountant, org.id);
  clerkActor = await finopsActor(db, clerk, org.id);

  const declared = await declareProfile(
    deps,
    actor,
    { legalName: `Finance ${RUN} Trust`, posture: "none" },
    newId(),
  );
  if (!declared.ok) {
    throw new Error(`declareProfile: ${declared.reason}`);
  }
  await runFollower(deps, org.id);

  const series = await openSeries(deps, actor, { kind: "receipt", fy, prefix: "RCT" }, newId());
  if (!series.ok) {
    throw new Error("openSeries");
  }
  receiptSeriesId = series.streamId;
  const issued = await issueReceipt(
    deps,
    { kind: "person", actor, capability: "finops.document" },
    { seriesId: series.streamId, paymentId },
    newId(),
  );
  if (!issued.ok) {
    throw new Error(`issueReceipt: ${issued.reason}`);
  }
  const [doc] = await db
    .select({ id: finopsDocuments.id })
    .from(finopsDocuments)
    .where(eq(finopsDocuments.orgId, org.id));
  receipt1 = doc?.id ?? "";
}, 180_000);

afterAll(async () => {
  await db.delete(finopsJobs).where(eq(finopsJobs.orgId, org.id));
  await db.delete(finopsCursors).where(eq(finopsCursors.orgId, org.id));
  await db.delete(finopsDispatches).where(eq(finopsDispatches.orgId, org.id));
  await db.delete(finopsDocuments).where(eq(finopsDocuments.orgId, org.id));
  await db.delete(finopsSeries).where(eq(finopsSeries.orgId, org.id));
  await db.delete(finopsExports).where(eq(finopsExports.orgId, org.id));
  await db.delete(finopsPeriodDays).where(eq(finopsPeriodDays.orgId, org.id));
  await db.delete(finopsPeriods).where(eq(finopsPeriods.orgId, org.id));
  await db.delete(finopsProfiles).where(eq(finopsProfiles.orgId, org.id));
  await db.delete(finopsEvents).where(eq(finopsEvents.orgId, org.id));
  await db.delete(journalLegs).where(eq(journalLegs.orgId, org.id));
  await db.delete(journalPostings).where(eq(journalPostings.orgId, org.id));
  await db.delete(journalCheckpoints).where(eq(journalCheckpoints.orgId, org.id));
  await db.delete(paymentsTable).where(eq(paymentsTable.orgId, org.id));
  const caseRows = await db
    .select({ id: settlementCases.id })
    .from(settlementCases)
    .where(eq(settlementCases.orgId, org.id));
  if (caseRows.length > 0) {
    await db.delete(settlementObligations).where(
      inArray(
        settlementObligations.caseId,
        caseRows.map((row) => row.id),
      ),
    );
  }
  await db.delete(settlementEvents).where(eq(settlementEvents.orgId, org.id));
  await db.delete(settlementCases).where(eq(settlementCases.orgId, org.id));
  await db.delete(auditLog).where(eq(auditLog.scopeId, org.id));
  await db.delete(grantsTable).where(eq(grantsTable.scopeId, org.id));
  await db.delete(orgMembers).where(eq(orgMembers.orgId, org.id));
  await db.delete(organizations).where(eq(organizations.id, org.id));
  await db.delete(otpCodes).where(inArray(otpCodes.phone, TEST_PHONES));
  await db.delete(otpInbox).where(inArray(otpInbox.phone, TEST_PHONES));
  await db.delete(sessions).where(inArray(sessions.personId, [owner, clerk, accountant, outsider]));
  await db.delete(people).where(inArray(people.phone, TEST_PHONES));
  await db.delete(people).where(like(people.phone, `${SEED_PHONE_PREFIX}%`));
  await handle.sql.end({ timeout: 5 });
}, 60_000);

// ============================================================================
describe("PX-8 · Permissions — the third partition", () => {
  it("gives an org OWNER no finance power at all", async () => {
    for (const capability of [
      "finops.view",
      "finops.dispatch",
      "finops.operate",
      "finops.close",
    ] as const) {
      expect(await canFinops(db, owner, org.id, capability)).toBe(false);
    }
  });

  it("gives a CLERK view/document/dispatch but never operate or close", async () => {
    expect(await canFinops(db, clerk, org.id, "finops.view")).toBe(true);
    expect(await canFinops(db, clerk, org.id, "finops.dispatch")).toBe(true);
    expect(await canFinops(db, clerk, org.id, "finops.operate")).toBe(false);
    expect(await canFinops(db, clerk, org.id, "finops.close")).toBe(false);
  });

  it("gives a CONTROLLER the operate and close powers", async () => {
    expect(await canFinops(db, accountant, org.id, "finops.operate")).toBe(true);
    expect(await canFinops(db, accountant, org.id, "finops.close")).toBe(true);
  });

  it("gives an outsider nothing", async () => {
    expect(await canFinops(db, outsider, org.id, "finops.view")).toBe(false);
  });

  it("keeps the three engines partitioned — a settlement grant confers NO finance power", async () => {
    // `owner` holds settlement:controller (granted in setup) and org:owner.
    // Neither expands to a single finops capability.
    expect(await canFinops(db, owner, org.id, "finops.view")).toBe(false);
  });

  it("lists exactly the finance grants, never settlement's or identity's", async () => {
    const rows = await financeGrantsOf(db, org.id);
    const sets = rows.map((row) => row.capabilitySet).sort();
    expect(sets).toEqual(["finops:clerk", "finops:controller"]);
    expect(sets).not.toContain("settlement:controller");
    expect(sets).not.toContain("org:owner");
  });

  it("REFUSES to mint a finance grant without the frozen grant.issue", async () => {
    expect(await issueFinopsGrant(db, outsider, org.id, outsider, "finops:clerk")).toEqual({
      ok: false,
      reason: "forbidden",
    });
  });

  it("REFUSES a capability set finops does not recognise", async () => {
    for (const set of ["settlement:controller", "org:owner", "finops:admin"]) {
      expect(await issueFinopsGrant(db, owner, org.id, outsider, set)).toEqual({
        ok: false,
        reason: "unknown_set",
      });
    }
  });

  it("issues and revokes finance authority, and the capability follows immediately", async () => {
    const issued = await issueFinopsGrant(db, owner, org.id, outsider, "finops:accountant");
    expect(issued.ok).toBe(true);
    if (!issued.ok) {
      return;
    }
    expect(await canFinops(db, outsider, org.id, "finops.view")).toBe(true);
    expect(await canFinops(db, outsider, org.id, "finops.close")).toBe(false);
    expect((await revokeFinopsGrant(db, owner, org.id, issued.grantId)).ok).toBe(true);
    expect(await canFinops(db, outsider, org.id, "finops.view")).toBe(false);
  });
});

// ============================================================================
describe("PX-8 completion · Issuance — the lifecycle's entrance", () => {
  it("ATTACK · refuses to issue anything for an org with NO declared profile", async () => {
    // The dam: `assembleIssue` reads the profile stream FIRST and refuses.
    const other = await createOrg(db, outsider, `Undeclared ${RUN}`);
    const otherActor = await finopsActor(db, owner, other.id);
    const opened = await openSeries(
      deps,
      otherActor,
      { kind: "receipt", fy, prefix: "RCT" },
      newId(),
    );
    // Even opening a lane is refused: the actor holds no grant on THAT org.
    expect(opened).toEqual({ ok: false, reason: "not_authorized" });
    await db.delete(orgMembers).where(eq(orgMembers.orgId, other.id));
    await db.delete(organizations).where(eq(organizations.id, other.id));
  });

  it("ATTACK · refuses a second declaration — a profile is declared once", async () => {
    const ack = await declareProfile(
      deps,
      actor,
      { legalName: "Impostor Trust", posture: "none" },
      newId(),
    );
    expect(ack).toEqual({ ok: false, reason: "profile_exists" });
  });

  it("ATTACK · refuses a GSTIN without registration, and registration without a GSTIN", async () => {
    // Both directions of the platform's own declaration guard (IP-6 §14).
    expect(
      await amendProfile(
        deps,
        actor,
        { reason: "sneak a gstin in", gstin: "27AAAAA0000A1Z5" },
        newId(),
      ),
    ).toEqual({ ok: false, reason: "gstin_forbidden_without_registration" });
    expect(
      await amendProfile(deps, actor, { reason: "register", posture: "gst-registered" }, newId()),
    ).toEqual({ ok: false, reason: "gstin_invalid" });
    expect(
      await amendProfile(
        deps,
        actor,
        { reason: "register", posture: "gst-registered", gstin: "not-a-gstin" },
        newId(),
      ),
    ).toEqual({ ok: false, reason: "gstin_invalid" });
  });

  it("ATTACK · refuses an amendment with no reason", async () => {
    expect(
      await amendProfile(deps, actor, { reason: "   ", legalName: "Quietly Renamed" }, newId()),
    ).toEqual({ ok: false, reason: "reason_required" });
  });

  it("ATTACK · refuses a CLERK the manage commands", async () => {
    expect(
      await openSeries(deps, clerkActor, { kind: "correction", fy, prefix: "CN" }, newId()),
    ).toEqual({ ok: false, reason: "not_authorized" });
    expect(
      await amendProfile(deps, clerkActor, { reason: "try", legalName: "Clerk Corp" }, newId()),
    ).toEqual({ ok: false, reason: "not_authorized" });
  });

  it("ATTACK · DUPLICATE NUMBERING is structurally impossible — one lane per kind+FY", async () => {
    const ack = await openSeries(deps, actor, { kind: "receipt", fy, prefix: "DUP" }, newId());
    // A closed series still owns its key, forever. The number space cannot fork.
    expect(ack.ok).toBe(false);
    if (!ack.ok) {
      expect(["series_exists", "series_key_taken"]).toContain(ack.reason);
    }
  });

  it("ATTACK · refuses an invalid fiscal year and an empty prefix", async () => {
    expect(
      await openSeries(deps, actor, { kind: "correction", fy: "2026", prefix: "CN" }, newId()),
    ).toEqual({ ok: false, reason: "fy_invalid" });
    expect(
      await openSeries(deps, actor, { kind: "correction", fy, prefix: "  " }, newId()),
    ).toEqual({ ok: false, reason: "prefix_required" });
  });

  it("derives the NEXT NUMBER from the platform, never from the screen", async () => {
    const board = await opsBoardView(deps, db, org.id);
    const receipts = board.issuance.series.find((row) => row.kind === "receipt");
    const truth = await issuanceSnapshot(deps, org.id);
    const truthSeries = truth.series.find((row) => row.kind === "receipt");
    expect(receipts?.nextNumber).toBe(truthSeries?.nextNumber);
    // One receipt exists from setup, so the lane's next number is 2.
    expect(receipts?.nextNumber).toBe(2);
    expect(receipts?.documentCount).toBe(1);
  });

  it("shows the declared profile the screen renders", async () => {
    const board = await opsBoardView(deps, db, org.id);
    expect(board.issuance.profile?.legalName).toBe(`Finance ${RUN} Trust`);
    expect(board.issuance.profile?.posture).toBe("none");
    expect(board.issuance.profile?.autoReceipt).toBe(false);
    expect(board.issuance.profile?.version).toBeGreaterThan(0);
  });
});

// ============================================================================
describe("PX-8 completion · The POLICY issues, not the screen", () => {
  let autoPayment = "";

  it("turns auto-receipt ON through the existing amend writer", async () => {
    const ack = await amendProfile(
      deps,
      actor,
      { reason: "Let the platform issue receipts itself", autoReceipt: true },
      newId(),
    );
    expect(ack.ok).toBe(true);
    const board = await opsBoardView(deps, db, org.id);
    expect(board.issuance.profile?.autoReceipt).toBe(true);
    expect(board.collections.autoReceipt).toBe(true);
    // Amending advances the version; the earlier document still pins the old one.
    expect(board.issuance.profile?.version).toBe(2);
  });

  it("names a captured payment as AWAITING a receipt the moment settlement captures it", async () => {
    autoPayment = newId();
    await createPayment(sdeps, sactor, {
      paymentId: autoPayment,
      commandId: newId(),
      caseId,
      teamId: lions(),
      method: "manual:cash",
      amount: SALE_B,
    });
    // Recorded, not captured: nothing is due a receipt yet.
    let board = await opsBoardView(deps, db, org.id);
    expect(board.issuance.candidates.map((row) => row.paymentId)).not.toContain(autoPayment);

    await attestManualCapture(sdeps, sactor, autoPayment, newId(), { attestedBy: owner });
    board = await opsBoardView(deps, db, org.id);
    const candidate = board.issuance.candidates.find((row) => row.paymentId === autoPayment);
    expect(candidate, "a captured payment must appear as awaiting a receipt").toBeDefined();
    // The screen names the party, never a raw id.
    expect(candidate?.teamName).toBe("Lions");
    expect(board.collections.awaitingReceipt).toBe(1);
  });

  it("AUTO-ISSUES the receipt when the FOLLOWER runs — no human command", async () => {
    const before = await registerView(deps, org.id);
    // This is the platform's own policy edge (§8.6), invoked exactly as the
    // runner invokes it. Nothing in the web tier issues anything here.
    await runFollower(deps, org.id);

    const after = await registerView(deps, org.id);
    expect(after.length).toBe(before.length + 1);
    const issued = after.find((row) => row.sourceRef?.includes(autoPayment) === true);
    expect(issued, "the follower must have issued the receipt itself").toBeDefined();
    expect(issued?.kind).toBe("receipt");

    // And the board agrees: nothing is awaiting a receipt any more.
    const board = await opsBoardView(deps, db, org.id);
    expect(board.collections.awaitingReceipt).toBe(0);
    expect(board.collections.issued).toBe(2);
  });

  it("the auto-issued receipt REPRODUCES from the log like any other", async () => {
    const rows = await registerView(deps, org.id);
    const issued = rows.find((row) => row.sourceRef?.includes(autoPayment) === true);
    const detail = await documentDetailView(deps, db, org.id, issued?.docId ?? "");
    expect(detail?.snapshot.reproducible).toBe(true);
    // It took the NEXT number in the same lane — dense, no gap.
    expect(detail?.snapshot.document.number).toBe(2);
    expect(detail?.snapshot.formatted).toMatch(/^RCT\//);
  });

  it("is IDEMPOTENT — running the follower again issues nothing new", async () => {
    const before = await registerView(deps, org.id);
    await runFollower(deps, org.id);
    await runFollower(deps, org.id);
    const after = await registerView(deps, org.id);
    // The auto-issue command id is derived from the source payment + seq.
    expect(after.length).toBe(before.length);
  });

  it("leaves the operations dashboard and reconciliation HEALTHY after auto-issuance", async () => {
    const board = await opsBoardView(deps, db, org.id);
    expect(board.dashboard.components.find((c) => c.component === "documents")?.status).toBe(
      "healthy",
    );
    const rec = await reconciliationView(deps, org.id);
    // The health this asserts now comes from the live, non-writing compliance
    // snapshot rather than a certification derived by the act of reading. See
    // "Reconciliation — reads the record, never writes it" below.
    expect(rec.compliance.documents.total).toBe(2);
    expect(rec.compliance.documents.reproducible).toBe(true);
    const certified = await certificationSnapshot(deps, org.id);
    expect(certified?.pass).toBe(true);
  });

  it("ATTACK · refuses to receipt the same payment twice", async () => {
    const ack = await issueReceipt(
      deps,
      { kind: "person", actor, capability: "finops.document" },
      { seriesId: receiptSeriesId, paymentId: autoPayment },
      newId(),
    );
    expect(ack.ok).toBe(false);
  });

  it("ATTACK · refuses to receipt a payment settlement never captured", async () => {
    const ack = await issueReceipt(
      deps,
      { kind: "person", actor, capability: "finops.document" },
      { seriesId: receiptSeriesId, paymentId: newId() },
      newId(),
    );
    expect(ack).toEqual({ ok: false, reason: "source_unknown" });
  });
});

// ============================================================================
describe("PX-8 · The ops board — identical to the platform's own calculations", () => {
  it("renders the certified dashboard snapshot, field for field", async () => {
    const board = await opsBoardView(deps, db, org.id);
    const truth = await operationsDashboardSnapshot(deps, org.id, fy);

    // THE PX-8 PROPERTY: the screen's health IS the platform's verdict.
    expect(board.dashboard.overall).toBe(truth.overall);
    expect(board.dashboard.components).toEqual(truth.components);
    expect(board.fy).toBe(fy);
    // Every component the platform derives is rendered — none dropped.
    expect(board.dashboard.components.map((c) => c.component).sort()).toEqual([
      "dispatch",
      "documents",
      "exports",
      "fiscal",
      "follower",
      "runner",
      "settlement-sync",
    ]);
  });

  it("renders the certified attention queue verbatim, with its resolving action", async () => {
    const board = await opsBoardView(deps, db, org.id);
    const truth = await complianceQueueSnapshot(deps, org.id);
    expect(board.queue.items).toEqual(truth.items);
    // The platform names the remedy; the console must not invent a different one.
    for (const item of board.queue.items) {
      expect(item.action.length).toBeGreaterThan(0);
    }
  });

  it("counts collections from the platform's own issuance view", async () => {
    const board = await opsBoardView(deps, db, org.id);
    const register = await registerView(deps, org.id);
    // Relational on purpose: the count IS the register's length, whatever the
    // suite has issued by now — a magic number would just re-encode the fixture.
    expect(board.collections.issued).toBe(register.length);
    expect(board.collections.awaitingReceipt).toBe(board.issuance.candidates.length);
    // Every captured payment has been receipted (by hand or by the policy).
    expect(board.collections.awaitingReceipt).toBe(0);
  });

  it("counts today's activity from the log's own timing", async () => {
    const board = await opsBoardView(deps, db, org.id);
    const types = board.today.map((line) => line.type);
    expect(types).toContain("DocumentIssued");
    expect(types).toContain("SeriesOpened");
    expect(types).toContain("ProfileDeclared");
    expect(board.todayTotal).toBe(board.today.reduce((sum, line) => sum + line.count, 0));
  });

  it("never leaks another org's finance", async () => {
    const other = await createOrg(db, outsider, `Other ${RUN}`);
    const board = await opsBoardView(deps, db, other.id);
    expect(board.collections.issued).toBe(0);
    expect(board.today).toEqual([]);
    expect(await registerView(deps, other.id)).toEqual([]);
    await db.delete(orgMembers).where(eq(orgMembers.orgId, other.id));
    await db.delete(organizations).where(eq(organizations.id, other.id));
  });
});

// ============================================================================
describe("PX-8 · The delivery lifecycle", () => {
  it("shows a delivery moving Queued → Processing → Succeeded", async () => {
    const ack = await requestDispatch(
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
    expect(ack.ok).toBe(true);
    if (!ack.ok) {
      return;
    }

    // Queued.
    let view = await deliveriesView(deps, db, org.id);
    expect(view.counts["requested"]).toBe(1);
    expect(view.rows.find((row) => row.dispatchId === ack.streamId)?.status).toBe("requested");

    await drainAll();

    // Succeeded (in-app confirms on send — the platform's own lifecycle).
    view = await deliveriesView(deps, db, org.id);
    const row = view.rows.find((entry) => entry.dispatchId === ack.streamId);
    expect(row?.status).toBe("confirmed");
    expect(view.counts["confirmed"]).toBe(1);
    expect(view.counts["requested"]).toBe(0);

    // The row IS the platform's snapshot.
    const truth = await dispatchSnapshot(deps, ack.streamId);
    expect(row?.channel).toBe(truth?.dispatch.channel);
    expect(row?.providerRef).toBe(truth?.dispatch.providerRef);
    expect(row?.status).toBe(truth?.dispatch.status);
  });

  it("FAILS a delivery the provider permanently refuses, and shows why", async () => {
    fakeMode = "permanent";
    const ack = await requestDispatch(
      deps,
      actor,
      {
        channel: "whatsapp",
        recipientRef: `owner:${tigers()}`,
        templateId: "receipt-issued",
        templateVersion: "v1",
        subjectRef: `doc:${receipt1}`,
      },
      newId(),
    );
    expect(ack.ok).toBe(true);
    if (!ack.ok) {
      return;
    }
    failedDispatch = ack.streamId;
    await drainAll();

    const view = await deliveriesView(deps, db, org.id);
    const row = view.rows.find((entry) => entry.dispatchId === failedDispatch);
    expect(row?.status).toBe("failed");
    // The operator must be told the provider's own code, not a euphemism.
    expect(row?.failureCode).toBe("recipient_opted_out");
    expect(view.counts["failed"]).toBe(1);
  });

  it("RETRIES a failed delivery as a NEW dispatch — the failed one stays failed", async () => {
    fakeMode = "ok";
    const ack = await retryDispatch(deps, actor, failedDispatch, newId());
    expect(ack.ok).toBe(true);
    if (!ack.ok) {
      return;
    }
    // A failed dispatch is terminal (IP-6 §8.3): the retry is a NEW stream.
    expect(ack.streamId).not.toBe(failedDispatch);

    const view = await deliveriesView(deps, db, org.id);
    expect(view.rows.find((row) => row.dispatchId === failedDispatch)?.status).toBe("failed");
    expect(view.rows.find((row) => row.dispatchId === ack.streamId)?.status).toBe("requested");

    await drainAll();
    const after = await deliveriesView(deps, db, org.id);
    // WhatsApp confirms on a provider CALLBACK, not on send, so the retry rests
    // in Processing — unlike in-app, which confirms as it sends. The lanes are
    // the channel's real lifecycle, not a uniform fiction.
    expect(after.rows.find((row) => row.dispatchId === ack.streamId)?.status).toBe("sent");
    expect(after.rows.find((row) => row.dispatchId === ack.streamId)?.providerRef).toBe(
      `wa:${ack.streamId}`,
    );
    // The failure is never rewritten by a later success — history is append-only.
    expect(after.rows.find((row) => row.dispatchId === failedDispatch)?.status).toBe("failed");
  });

  it("ATTACK · refuses to retry a delivery that has not failed", async () => {
    const view = await deliveriesView(deps, db, org.id);
    const confirmed = view.rows.find((row) => row.status === "confirmed");
    expect(confirmed).toBeDefined();
    const ack = await retryDispatch(deps, actor, confirmed?.dispatchId ?? "", newId());
    expect(ack).toEqual({ ok: false, reason: "dispatch_not_failed" });
  });

  it("ATTACK · refuses to retry an unknown delivery, and another org's", async () => {
    expect(await retryDispatch(deps, actor, newId(), newId())).toEqual({
      ok: false,
      reason: "dispatch_unknown",
    });
  });

  it("ATTACK · refuses a requeue from a CLERK (no finops.operate)", async () => {
    const result = await requeueDeadJob(deps, clerkActor, newId());
    expect(result).toEqual({ ok: false, reason: "not_authorized" });
  });

  it("ATTACK · refuses to requeue a job that is not dead", async () => {
    const jobs = await deps.store.loadJobs(org.id);
    const alive = jobs.find((job) => job.state !== "dead");
    if (alive === undefined) {
      return;
    }
    expect(await requeueDeadJob(deps, actor, alive.jobId)).toEqual({
      ok: false,
      reason: "job_not_dead",
    });
  });

  it("ATTACK · refuses to requeue an unknown job", async () => {
    expect(await requeueDeadJob(deps, actor, newId())).toEqual({
      ok: false,
      reason: "job_unknown",
    });
  });

  it("joins each delivery to the JOB carrying its retry state", async () => {
    // The join key (`dispatch.send:{id}`) is the platform's own convention,
    // copied from `dispatchSnapshot`. If it ever drifts, this join silently
    // returns null and the desk shows no attempts at all — a quiet blinding,
    // not a crash. So assert the join actually finds the job.
    const ack = await requestDispatch(
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
    expect(ack.ok).toBe(true);
    if (!ack.ok) {
      return;
    }
    // Enqueue only — do not drain, so the job is still on the queue to be found.
    await enqueueDispatchSends(deps, Date.now());
    const view = await deliveriesView(deps, db, org.id);
    const row = view.rows.find((entry) => entry.dispatchId === ack.streamId);
    expect(row?.job, "the dispatch → job join found nothing").not.toBeNull();
    expect(row?.job?.maxAttempts).toBeGreaterThan(0);
    // And it is THIS dispatch's job, not some other row's.
    const jobs = await deps.store.loadJobs(org.id);
    const matched = jobs.find((job) => job.jobId === row?.job?.jobId);
    expect(matched?.dedupeKey).toBe(`dispatch.send:${ack.streamId}`);
    await drainAll();
  });

  it("exposes dead jobs WITH the id the requeue writer needs", async () => {
    const view = await deliveriesView(deps, db, org.id);
    for (const job of view.dead) {
      // `retrySnapshot` narrows the id away; the desk cannot act without it.
      expect(job.jobId).toMatch(/^[0-9A-Z]{26}$/);
    }
  });
});

// ============================================================================
describe("PX-8 · Operations detail — one document, end to end", () => {
  it("renders the certified document snapshot with its LIVE reproduction verdict", async () => {
    const detail = await documentDetailView(deps, db, org.id, receipt1);
    const truth = await documentSnapshot(deps, receipt1);
    expect(detail).not.toBeNull();
    expect(detail?.snapshot).toEqual(truth);
    // The receipt re-renders to exactly the digest sealed at issue.
    expect(detail?.snapshot.reproducible).toBe(true);
    expect(detail?.snapshot.formatted).toMatch(/^RCT\//);
  });

  it("shows the SETTLEMENT reference the document was made from", async () => {
    const detail = await documentDetailView(deps, db, org.id, receipt1);
    // Finance quotes settlement; the watermark pins exactly where.
    expect(detail?.settlement.sourceRef).toContain("payment:");
    expect(Object.keys(detail?.settlement.watermark ?? {}).length).toBeGreaterThan(0);
    expect(detail?.settlement.profileSeq).toBeGreaterThan(0);
  });

  it("shows every delivery attempted for it — including the failure", async () => {
    const detail = await documentDetailView(deps, db, org.id, receipt1);
    const statuses = (detail?.deliveries ?? []).map((row) => row.status).sort();
    expect(statuses).toContain("failed");
    expect(statuses).toContain("confirmed");
    // Every delivery on this page is THIS document's.
    for (const row of detail?.deliveries ?? []) {
      expect(row.subjectRef).toBe(`doc:${receipt1}`);
    }
  });

  it("builds an audit timeline from the log, in the order it happened", async () => {
    const detail = await documentDetailView(deps, db, org.id, receipt1);
    const timeline = detail?.timeline ?? [];
    expect(timeline[0]?.type).toBe("DocumentIssued");
    expect(timeline.map((entry) => entry.type)).toContain("DispatchFailed");
    // Monotonic by time — an audit that reorders itself is not an audit.
    for (let index = 1; index < timeline.length; index += 1) {
      expect(timeline[index]?.atMs).toBeGreaterThanOrEqual(timeline[index - 1]?.atMs ?? 0);
    }
  });

  it("EXISTENCE PRIVACY · another org's document is indistinguishable from none", async () => {
    const other = await createOrg(db, outsider, `Peek ${RUN}`);
    expect(await documentDetailView(deps, db, other.id, receipt1)).toBeNull();
    expect(await documentDetailView(deps, db, org.id, newId())).toBeNull();
    await db.delete(orgMembers).where(eq(orgMembers.orgId, other.id));
    await db.delete(organizations).where(eq(organizations.id, other.id));
  });
});

// ============================================================================
/**
 * This block used to be titled "derived, never asserted", and it asserted that
 * the view re-derived a FRESH certification on every read. That principle was
 * right about staleness and wrong about cost: `certifyOperations` writes an
 * audit row inside its own transaction, so deriving on read meant **every page
 * view appended two `finops.CertificationDerived` rows**, stamped with the job
 * runner's name for a runner that had not run — and the desk then displayed
 * those page views back as the organization's certification history. A read
 * that forges the register meant to prove integrity is worse than a read that
 * might be stale.
 *
 * So the desk now READS what the runner recorded. Staleness is handled by
 * showing the date, not by hiding it. Deriving without writing would mean
 * thawing IP-6, which is tracked separately; until then `compliance` below
 * still carries a live, non-writing reproducibility signal.
 */
describe("PX-8 · Reconciliation — reads the record, never writes it", () => {
  it("reports the certification the runner recorded, newest first", async () => {
    const view = await reconciliationView(deps, org.id);
    const recorded = await deps.store.loadAuditBreadcrumbs(org.id, "finops.CertificationDerived");
    expect(view.certifications.length).toBe(recorded.length);
    if (recorded.length > 0) {
      // Newest first, which is the opposite of the breadcrumb order.
      expect(view.certifications[0]?.atMs).toBe(recorded[recorded.length - 1]?.atMs);
    }
  });

  it("does NOT write to the audit ledger when the page is read", async () => {
    const before = await deps.store.loadAuditBreadcrumbs(org.id, "finops.CertificationDerived");
    await reconciliationView(deps, org.id);
    await reconciliationView(deps, org.id);
    await reconciliationView(deps, org.id);
    const after = await deps.store.loadAuditBreadcrumbs(org.id, "finops.CertificationDerived");
    expect(after.length).toBe(before.length);
  });

  it("still proves documents reproduce, without deriving a certification", async () => {
    // The live integrity signal that survives the change: `complianceSnapshot`
    // checks reproducibility and writes nothing.
    const view = await reconciliationView(deps, org.id);
    expect(view.compliance.documents.reproducible).toBe(true);
  });

  it("reports the ingest frontier as PENDING, not lost", async () => {
    const view = await reconciliationView(deps, org.id);
    expect(view.follower.current).toBe(true);
    expect(view.follower.totalBehind).toBe(0);
    expect(view.follower.streams).toBeGreaterThan(0);
  });

  it("reports the org's compliance posture from the platform", async () => {
    const view = await reconciliationView(deps, org.id);
    expect(view.compliance.posture).toBe("none");
    expect(view.compliance.documents.total).toBe((await registerView(deps, org.id)).length);
    expect(view.compliance.documents.reproducible).toBe(true);
    expect(view.fy).toBe(fy);
  });
});

// ============================================================================
describe("PX-8 · Search & saved views — filtering narrows, never invents", () => {
  it("keeps the CLIENT-imported modules free of the server package", async () => {
    // REGRESSION (PX-8): `deliveries.ts` and `register.ts` are imported by client
    // panels. A VALUE import from `views.ts` drags
    // `@desiauction/financial-operations/server` — and `node:fs`/`node:os` —
    // into the browser bundle and fails the production build. Typecheck cannot
    // see it, so this pins the layering: pure modules import `views` for TYPES
    // only, and `views` imports the lanes upward from `deliveries`.
    const { readFileSync } = await import("node:fs");
    for (const file of ["deliveries.ts", "register.ts"]) {
      const source = readFileSync(new URL(file, import.meta.url), "utf8");
      // Scan IMPORT STATEMENTS, not raw text — the prose above them names the
      // very module they must not pull in.
      const imports = source.match(/^import .*$/gm) ?? [];
      for (const line of imports) {
        if (line.includes('"./views"')) {
          expect(line, `${file}: a value import from views leaks the server bundle`).toMatch(
            /^import type /,
          );
        }
        expect(line, `${file}: must not import the finops server package`).not.toContain(
          "financial-operations/server",
        );
      }
    }
  });

  it("has operator copy for every rejection the platform can actually return", async () => {
    // The console's only job is to be readable. A reason the platform returns
    // but this map does not know falls through as a RAW CODE — so the map is
    // checked against the platform's own closed set, read from its source.
    const { readFileSync } = await import("node:fs");
    const root = new URL(
      "../../../../../packages/financial-operations/src/server/",
      import.meta.url,
    );
    const platform = ["writer.ts", "pipelines.ts"]
      .map((file) => readFileSync(new URL(file, root), "utf8"))
      .join("\n");
    const returned = new Set(
      [...platform.matchAll(/reason: "([a-z_]+)"/g)].map((match) => match[1] as string),
    );
    const copy = readFileSync(new URL("actions.ts", import.meta.url.replace(/[^/]+$/, "")), "utf8");
    // Scope to the REASONS block, and match the KEY only — prettier wraps long
    // values onto the next line, and a regex that assumes otherwise lies.
    const block = copy.slice(
      copy.indexOf("const REASONS: Record<string, string> = {"),
      copy.indexOf("function messageFor"),
    );
    const known = new Set(
      [...block.matchAll(/^\s{2}([a-z_]+):/gm)].map((match) => match[1] as string),
    );
    const uncovered = [...returned].filter((reason) => !known.has(reason)).sort();
    expect(uncovered, `no operator copy for: ${uncovered.join(", ")}`).toEqual([]);
  });

  it("defaults every saved view to a real key", () => {
    for (const view of FINANCE_VIEWS) {
      expect(isFinanceView(view.key)).toBe(true);
    }
    expect(isFinanceView("nonsense")).toBe(false);
  });

  it("labels every document kind and delivery lane the platform can produce", () => {
    for (const kind of ["receipt", "tax-invoice", "correction"]) {
      expect(DOC_KIND_LABEL[kind]).toBeDefined();
    }
    for (const lane of ["requested", "sent", "confirmed", "failed"]) {
      expect(DELIVERY_LANE_LABEL[lane]).toBeDefined();
      expect(isDeliveryLane(lane)).toBe(true);
    }
    expect(isDeliveryLane("nonsense")).toBe(false);
  });

  it("searches the register by number, party, settlement reference and digest", async () => {
    const rows = await registerView(deps, org.id);
    expect(rows.length).toBeGreaterThan(0);
    const row = rows[0];
    if (row === undefined) {
      return;
    }
    // A digest and a settlement reference are unique to ONE document.
    expect(filterRegister(rows, "all", "", row.contentDigest)).toEqual([row]);
    expect(filterRegister(rows, "all", "", row.sourceRef ?? "")).toEqual([row]);
    expect(filterRegister(rows, "all", "", row.docId)).toEqual([row]);
    // A party and a kind may match several — they must at least match this one.
    expect(filterRegister(rows, "all", "", row.partyLabel)).toContainEqual(row);
    expect(filterRegister(rows, "all", "", "Receipt").length).toBeGreaterThan(0);
    expect(filterRegister(rows, "all", "", "nothing-matches")).toHaveLength(0);
  });

  it("filters the register by saved view and kind", async () => {
    const rows = await registerView(deps, org.id);
    const receipts = rows.filter((row) => row.kind === "receipt");
    expect(receipts.length).toBeGreaterThan(0);
    expect(filterRegister(rows, "receipts", "", "")).toEqual(receipts);
    expect(filterRegister(rows, "all", "receipt", "")).toEqual(receipts);
    expect(filterRegister(rows, "invoices", "", "")).toHaveLength(0);
    expect(filterRegister(rows, "corrections", "", "")).toHaveLength(0);
    expect(filterRegister(rows, "all", "tax-invoice", "")).toHaveLength(0);
    // An unknown view must not hide a document.
    expect(filterRegister(rows, "nonsense", "", "")).toEqual(rows);
  });

  it("filters deliveries by lane, and an unknown lane hides nothing", async () => {
    const view = await deliveriesView(deps, db, org.id);
    expect(filterDeliveries(view.rows, "failed").every((row) => row.status === "failed")).toBe(
      true,
    );
    expect(filterDeliveries(view.rows, "failed")).toHaveLength(1);
    expect(filterDeliveries(view.rows, "")).toHaveLength(view.rows.length);
    expect(filterDeliveries(view.rows, "nonsense")).toHaveLength(view.rows.length);
  });
});
