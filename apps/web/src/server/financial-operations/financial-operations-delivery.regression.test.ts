// PERMANENT FINANCIAL-OPERATIONS DELIVERY & EXPORTS REGRESSION SUITE (IP-6, M-IP6-3).
//
// Encodes the frozen contract of the delivery layer against LIVE Postgres:
// dispatch bodies and export payloads come EXCLUSIVELY from reproduced
// document bytes (unreproducible ⇒ never delivered, never exported); provider
// responses become immutable events or audited retry attempts; retries are
// deterministic; exhaustion is a terminal event; unknown provider behaviour
// dead-letters and is operator-recoverable; callbacks are idempotent and
// late/out-of-order arrivals bounce off the frozen machine; exports read-back
// verify, regenerate byte-identically, and heal corrupted or deleted
// artifacts; every projection rebuilds from its stream — and the boundary
// meters prove dispatch/export edited NEITHER settlement NOR documents.
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
  fiscalYearOf,
  istDateOf,
  previousDate,
  type DeliveryCallback,
  type DeliveryPort,
  type DeliveryRequest,
} from "@desiauction/financial-operations";
import {
  archiveSnapshot,
  cancelDispatch,
  confirmDispatchManually,
  declareProfile,
  dispatchQueueSnapshot,
  dispatchSnapshot,
  drainJobsOnce,
  followAllOrgs,
  enqueueDispatchSends,
  enqueueExportGenerations,
  finopsDeps,
  foldStream,
  ingestDeliveryCallback,
  issueInvoice,
  issueReceipt,
  openSeries,
  providerHealthSnapshot,
  recoverDispatch,
  recoverExport,
  recoverSeries,
  regenerateExportArtifact,
  reproduceDocument,
  requestDispatch,
  requestExport,
  requestExportSystem,
  requeueDeadJob,
  retryDispatch,
  retryExport,
  retrySnapshot,
  runDailyExport,
  runExportGenerate,
  runFollower,
  verifyExport,
  verifyOrgFinops,
  type FinopsActor,
  type FinopsDeps,
} from "@desiauction/financial-operations/server";
import { and, eq, inArray, like, sql } from "drizzle-orm";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
} from "../settlement/writer";
import { issueSettlementGrant, settlementActor } from "../settlement/authz";
import { settlementDeps } from "../settlement/deps";
import { finopsActor, issueFinopsGrant } from "./authz";
import { purgeOrg } from "../test-support/purge-org";

const handle: DbHandle = createDb(env.DATABASE_URL);
const db = handle.db;
const sender = new DevInboxSender(db);

const RUN = String(Date.now()).slice(-7);
const PHONE_OWNER = `+9186${RUN}1`;
const PHONE_OFFICER = `+9185${RUN}2`;
const PHONE_OUTSIDER = `+9184${RUN}3`;
const TEST_PHONES = [PHONE_OWNER, PHONE_OFFICER, PHONE_OUTSIDER];
const SEED_PHONE_PREFIX = `+91911${RUN}`;
const STORAGE_DIR = join(tmpdir(), `finops-delivery-${RUN}`);
const CALLBACK_SECRET = `secret-${RUN}`;

const SALE_A = 5_000_000;
const SALE_B = 2_500_000;
const TIGERS_DUE = SALE_A * 2;

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
let payment1 = "";
let fy = "";
let receiptSeries = "";
let invoiceSeries = "";
let receipt1 = "";

/** Boundary meters: heads recorded once the upstream truths stop moving. */
let settlementCountAtRest = 0;
let documentEventsAtRest = 0;

const tigers = (): string => teamIds[0] ?? "";
const lions = (): string => teamIds[1] ?? "";

// --- The FAKE provider: a hostile, scriptable WhatsApp channel -------------------------

type FakeMode = "ok" | "retryable" | "permanent" | "throw";
let fakeMode: FakeMode = "ok";
/** After N retryable failures, succeed (a recovering provider). */
let fakeRecoverAfter = Number.POSITIVE_INFINITY;
const fakeSendCounts = new Map<string, number>();

const fakeWhatsApp: DeliveryPort = {
  channel: "whatsapp",
  send(request: DeliveryRequest) {
    const attempts = (fakeSendCounts.get(request.dispatchId) ?? 0) + 1;
    fakeSendCounts.set(request.dispatchId, attempts);
    if (fakeMode === "throw") {
      throw new Error("provider_sdk_garbage");
    }
    if (fakeMode === "permanent") {
      return Promise.resolve({ ok: false as const, code: "recipient_opted_out", retryable: false });
    }
    if (fakeMode === "retryable" && attempts <= fakeRecoverAfter) {
      return Promise.resolve({ ok: false as const, code: "provider_5xx", retryable: true });
    }
    return Promise.resolve({ ok: true as const, providerRef: `wa:${request.dispatchId}` });
  },
  verifyCallback(raw: string): DeliveryCallback {
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      if (parsed["secret"] !== CALLBACK_SECRET) {
        return { ok: false, reason: "bad_signature" };
      }
      return {
        ok: true,
        dispatchId: String(parsed["dispatchId"]),
        providerEventRef: String(parsed["providerEventRef"]),
        kind: parsed["kind"] === "delivered" ? "delivered" : "failed",
        code: typeof parsed["code"] === "string" ? parsed["code"] : "provider_failure",
      };
    } catch {
      return { ok: false, reason: "unparseable" };
    }
  },
};

function callback(dispatchId: string, providerEventRef: string, kind: string): string {
  return JSON.stringify({ secret: CALLBACK_SECRET, dispatchId, providerEventRef, kind });
}

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

async function seriesEventCount(): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(finopsEvents)
    .where(and(eq(finopsEvents.orgId, org.id), eq(finopsEvents.streamType, "series")));
  return row?.n ?? 0;
}

async function drainAll(nowMs: number): Promise<void> {
  await enqueueDispatchSends(deps, nowMs);
  await enqueueExportGenerations(deps, nowMs);
  await drainJobsOnce(deps, nowMs, { limit: 50, orgId: org.id });
}

beforeAll(async () => {
  owner = await login(PHONE_OWNER);
  officer = await login(PHONE_OFFICER);
  outsider = await login(PHONE_OUTSIDER);

  org = await createOrg(db, owner, `Delivery ${RUN}`);
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

  const sdeps = settlementDeps(db, { checkpointCadence: 2 });
  const sgrant = await issueSettlementGrant(db, owner, org.id, officer, "settlement:controller");
  if (!sgrant.ok) {
    throw new Error("settlement grant");
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
    amount: TIGERS_DUE,
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
  settlementCountAtRest = await settlementEventCount();

  deps = finopsDeps(db, {
    storageDir: STORAGE_DIR,
    delivery: { whatsapp: fakeWhatsApp },
  });
  fy = fiscalYearOf(istDateOf(Date.now()));
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
        { legalName: `Delivery ${RUN} Trust`, posture: "none" },
        newId(),
      )
    ).ok
  ) {
    throw new Error("declareProfile");
  }
  await runFollower(deps, org.id);

  for (const [kind, prefix, assign] of [
    ["receipt", "RCT", (id: string) => (receiptSeries = id)],
    ["tax-invoice", "INV", (id: string) => (invoiceSeries = id)],
  ] as const) {
    const ack = await openSeries(deps, actor, { kind, fy, prefix }, newId());
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
  const invoiced = await issueInvoice(
    deps,
    actor,
    { seriesId: invoiceSeries, caseId, teamId: lions() },
    newId(),
  );
  if (!invoiced.ok) {
    throw new Error(`issueInvoice: ${invoiced.reason}`);
  }
  documentEventsAtRest = await seriesEventCount();
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

async function newDispatch(
  channel: "in-app" | "email" | "whatsapp",
  subject?: string,
): Promise<string> {
  const ack = await requestDispatch(
    deps,
    actor,
    {
      channel,
      recipientRef: `owner:${tigers()}`,
      templateId: "receipt-issued",
      templateVersion: "v1",
      subjectRef: subject ?? `doc:${receipt1}`,
    },
    newId(),
  );
  if (!ack.ok) {
    throw new Error(`requestDispatch: ${ack.reason}`);
  }
  return ack.streamId;
}

describe("M-IP6-3 · Delivery — reproduced bytes, immutable outcomes", () => {
  it("IN-APP: request → scan → send → confirm; the body IS the reproduced document", async () => {
    const dispatchId = await newDispatch("in-app");
    await drainAll(Date.now());

    const row = await deps.store.loadDispatch(dispatchId);
    expect(row?.status).toBe("confirmed");
    expect(row?.providerRef).toBe(`in-app:${dispatchId}`);
    const events = await deps.store.loadStream("dispatch", dispatchId);
    expect(events.map((event) => event.type)).toEqual([
      "DispatchRequested",
      "DispatchSent",
      "DispatchConfirmed",
    ]);
    // Every dispatch is audited: one row per event.
    const audits = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.scopeId, org.id), eq(auditLog.subject, dispatchId)));
    expect(audits.length).toBeGreaterThanOrEqual(3);

    // DUPLICATE DISPATCH attack: re-scan + re-drain moves nothing.
    await drainAll(Date.now());
    expect((await deps.store.loadStream("dispatch", dispatchId)).length).toBe(3);
  });

  it("EMAIL OUTBOX: the delivered file carries the reproduced document bytes + digest", async () => {
    const dispatchId = await newDispatch("email");
    await drainAll(Date.now());
    expect((await deps.store.loadDispatch(dispatchId))?.status).toBe("confirmed");

    const file = join(STORAGE_DIR, "outbox", org.id, `${dispatchId}.email.txt`);
    expect(existsSync(file)).toBe(true);
    const contents = readFileSync(file, "utf8");
    const reproduction = await reproduceDocument(deps, receipt1);
    expect(reproduction.ok && reproduction.matches).toBe(true);
    expect(contents).toContain(reproduction.payload ?? "∅");
    expect(contents).toContain(`body-digest: ${reproduction.pinnedDigest ?? "∅"}`);
  });

  it("RETRY STORM: deterministic backoff, audited attempts, EXACTLY one successful send", async () => {
    fakeMode = "retryable";
    fakeRecoverAfter = 2; // fail twice, then the provider recovers
    const dispatchId = await newDispatch("whatsapp");
    const t0 = Date.now();

    await drainAll(t0);
    let job = (await deps.store.loadJobs(org.id)).find(
      (row) => row.dedupeKey === `dispatch.send:${dispatchId}`,
    );
    expect(job?.state).toBe("queued");
    expect(job?.attempts).toBe(1);
    expect(job?.notBeforeMs).toBe(t0 + 5_000);

    await drainAll(t0 + 5_001);
    job = (await deps.store.loadJobs(org.id)).find(
      (row) => row.dedupeKey === `dispatch.send:${dispatchId}`,
    );
    expect(job?.attempts).toBe(2);
    expect(job?.notBeforeMs).toBe(t0 + 5_001 + 10_000);

    await drainAll(t0 + 5_001 + 10_001);
    expect((await deps.store.loadDispatch(dispatchId))?.status).toBe("sent");
    expect(fakeSendCounts.get(dispatchId)).toBe(3); // two failures + ONE success

    const attempts = await db
      .select()
      .from(auditLog)
      .where(
        and(
          eq(auditLog.scopeId, org.id),
          eq(auditLog.subject, dispatchId),
          eq(auditLog.action, "finops.DispatchAttemptFailed"),
        ),
      );
    expect(attempts).toHaveLength(2);

    // PROVIDER CALLBACK: delivered → confirmed; a REPLAYED callback returns
    // the original ack and appends nothing; a LATE contradictory callback
    // bounces off the terminal machine and is audited as evidence.
    const delivered = callback(dispatchId, `evt-${dispatchId}-1`, "delivered");
    expect((await ingestDeliveryCallback(deps, "whatsapp", delivered)).ok).toBe(true);
    expect((await deps.store.loadDispatch(dispatchId))?.status).toBe("confirmed");
    const replay = await ingestDeliveryCallback(deps, "whatsapp", delivered);
    expect(replay).toMatchObject({ ok: true, status: "duplicate" });
    expect((await deps.store.loadStream("dispatch", dispatchId)).length).toBe(3);

    const late = await ingestDeliveryCallback(
      deps,
      "whatsapp",
      callback(dispatchId, `evt-${dispatchId}-2`, "failed"),
    );
    expect(late.ok).toBe(false);
    const rejections = await db
      .select()
      .from(auditLog)
      .where(
        and(
          eq(auditLog.scopeId, org.id),
          eq(auditLog.action, "finops.DeliveryCallbackRejected"),
          eq(auditLog.subject, dispatchId),
        ),
      );
    expect(rejections).toHaveLength(1);

    // UNVERIFIED callbacks touch nothing.
    expect(
      (
        await ingestDeliveryCallback(
          deps,
          "whatsapp",
          JSON.stringify({ secret: "wrong", dispatchId, providerEventRef: "x", kind: "delivered" }),
        )
      ).ok,
    ).toBe(false);
    fakeMode = "ok";
    fakeRecoverAfter = Number.POSITIVE_INFINITY;
  });

  it("OUT-OF-ORDER ACK: a callback for a never-sent dispatch bounces; manual cancel closes it", async () => {
    const dispatchId = await newDispatch("whatsapp"); // requested; NOT drained
    const early = await ingestDeliveryCallback(
      deps,
      "whatsapp",
      callback(dispatchId, `evt-early-${RUN}`, "delivered"),
    );
    expect(early).toEqual({ ok: false, reason: "dispatch_not_sent" });

    const cancelled = await cancelDispatch(deps, actor, dispatchId, "operator stop", newId());
    expect(cancelled.ok).toBe(true);
    expect((await deps.store.loadDispatch(dispatchId))?.failureCode).toBe("cancelled");
    // The pending send job then observes the terminal state and does nothing.
    await drainAll(Date.now());
    expect(fakeSendCounts.get(dispatchId)).toBeUndefined();
  });

  it("PERMANENT REJECTION is a terminal event; RETRY is a NEW dispatch", async () => {
    fakeMode = "permanent";
    const dispatchId = await newDispatch("whatsapp");
    await drainAll(Date.now());
    const failed = await deps.store.loadDispatch(dispatchId);
    expect(failed?.status).toBe("failed");
    expect(failed?.failureCode).toBe("recipient_opted_out");

    fakeMode = "ok";
    const retried = await retryDispatch(deps, actor, dispatchId, newId());
    expect(retried.ok).toBe(true);
    const newId2 = retried.ok ? retried.streamId : "";
    await drainAll(Date.now());
    expect((await deps.store.loadDispatch(newId2))?.status).toBe("sent");
    // The failed original is UNTOUCHED — history, not state.
    expect((await deps.store.loadDispatch(dispatchId))?.status).toBe("failed");
  });

  it("RETRIES EXHAUSTED: a never-recovering provider ends in a terminal event, not a loop", async () => {
    fakeMode = "retryable"; // never recovers
    const dispatchId = await newDispatch("whatsapp");
    const t0 = Date.now();
    let at = t0;
    for (const delay of [0, 5_001, 10_001, 20_001, 40_001]) {
      at += delay;
      await drainAll(at);
    }
    const row = await deps.store.loadDispatch(dispatchId);
    expect(row?.status).toBe("failed");
    expect(row?.failureCode).toBe("retries_exhausted:provider_5xx");
    expect(fakeSendCounts.get(dispatchId)).toBe(5);
    fakeMode = "ok";
  });

  it("UNKNOWN PROVIDER BEHAVIOUR fails closed → DEAD LETTER → operator requeue recovers", async () => {
    fakeMode = "throw"; // SDK garbage — not a typed provider response
    const dispatchId = await newDispatch("whatsapp");
    const t0 = Date.now();
    let at = t0;
    for (const delay of [0, 5_001, 10_001, 20_001, 40_001]) {
      at += delay;
      await drainAll(at);
    }
    const dead = (await deps.store.loadDeadJobs(org.id)).find(
      (job) => job.dedupeKey === `dispatch.send:${dispatchId}`,
    );
    expect(dead?.state).toBe("dead");
    expect(dead?.lastError).toBe("provider_sdk_garbage");
    expect((await deps.store.loadDispatch(dispatchId))?.status).toBe("requested");

    const health = await providerHealthSnapshot(deps, org.id);
    expect(health.deadSendJobs).toBe(1);
    expect((await retrySnapshot(deps, org.id)).dead.length).toBeGreaterThanOrEqual(1);

    // The fix lands; the operator requeues; delivery completes.
    fakeMode = "ok";
    const outsiderActor = await finopsActor(db, outsider, org.id);
    expect(await requeueDeadJob(deps, outsiderActor, dead?.jobId ?? "")).toEqual({
      ok: false,
      reason: "not_authorized",
    });
    expect(await requeueDeadJob(deps, actor, dead?.jobId ?? "")).toEqual({ ok: true });
    await drainJobsOnce(deps, Date.now(), { limit: 50, orgId: org.id });
    expect((await deps.store.loadDispatch(dispatchId))?.status).toBe("sent");
  });

  it("MANUAL COMPLETION attests out-of-band delivery without masquerading as provider truth", async () => {
    fakeMode = "ok";
    const dispatchId = await newDispatch("whatsapp");
    await drainAll(Date.now());
    expect((await deps.store.loadDispatch(dispatchId))?.status).toBe("sent");

    const commandId = newId();
    const confirmed = await confirmDispatchManually(
      deps,
      actor,
      dispatchId,
      "owner confirmed on call",
      commandId,
    );
    expect(confirmed.ok).toBe(true);
    const row = await deps.store.loadDispatch(dispatchId);
    expect(row?.status).toBe("confirmed");
    expect(row?.providerEventRef).toBe(`manual:${commandId}`);
    expect(
      await confirmDispatchManually(deps, actor, dispatchId, "again", commandId),
    ).toMatchObject({ ok: true, status: "duplicate" });
  });

  it("AN UNREPRODUCIBLE DOCUMENT IS NEVER DELIVERED — fail closed before any provider sees it", async () => {
    const seriesEvents = await deps.store.loadStream("series", receiptSeries);
    const forgedDocId = newId();
    const { orgWatermark } = await import("@desiauction/financial-operations/server");
    await db.insert(finopsEvents).values({
      id: newId(),
      orgId: org.id,
      streamType: "series",
      streamId: receiptSeries,
      seq: seriesEvents.length + 1,
      type: "DocumentIssued",
      atMs: Date.now(),
      actor: officer,
      correlationId: newId(),
      commandId: newId(),
      payload: {
        docId: forgedDocId,
        number: seriesEvents.filter((event) => event.type === "DocumentIssued").length + 1,
        party: { type: "team", id: tigers(), label: "Tigers" },
        lines: [
          { description: "x", amount: 999, provenance: { stream: `payment:${payment1}`, seq: 2 } },
        ],
        amount: 999,
        sourceRef: `payment:${newId()}:2`,
        profileSeq: 1,
        watermark: await orgWatermark(deps, org.id),
        contentDigest: "forged",
      },
    });
    await recoverSeries(deps, org.id, receiptSeries);

    const dispatchId = await newDispatch("whatsapp", `doc:${forgedDocId}`);
    await drainAll(Date.now());
    const row = await deps.store.loadDispatch(dispatchId);
    expect(row?.status).toBe("failed");
    expect(row?.failureCode).toBe("document_not_reproducible");
    expect(fakeSendCounts.get(dispatchId)).toBeUndefined(); // no provider ever saw it
    expect((await dispatchSnapshot(deps, dispatchId))?.subjectReproducible).toBe(false);

    // PITR-shaped restore of the forged prefix, then heal.
    await db
      .delete(finopsEvents)
      .where(
        and(
          eq(finopsEvents.streamType, "series"),
          eq(finopsEvents.streamId, receiptSeries),
          sql`${finopsEvents.seq} > ${seriesEvents.length}`,
        ),
      );
    expect((await recoverSeries(deps, org.id, receiptSeries)).ok).toBe(true);
    documentEventsAtRest = await seriesEventCount();
  });
});

describe("M-IP6-3 · Exports — serialized reproduced payloads, verified artifacts", () => {
  let exportId = "";

  it("request → generate → READ-BACK VERIFY → complete; verification and reproduction agree", async () => {
    const requested = await requestExport(
      deps,
      actor,
      { kind: "journal-csv", params: { fy } },
      newId(),
    );
    expect(requested.ok).toBe(true);
    exportId = requested.ok ? requested.streamId : "";
    await drainAll(Date.now());

    const run = await deps.store.loadExport(exportId);
    expect(run?.status).toBe("completed");
    expect(run?.rowCount).toBe(2); // receipt1 + Lions invoice
    const verification = await verifyExport(deps, exportId);
    expect(verification?.verified).toBe(true);
    expect(verification?.artifactMatchesDigest).toBe(true);
    expect(verification?.regeneratedMatchesDigest).toBe(true);
    const snapshot = await dispatchQueueSnapshot(deps, org.id);
    expect(snapshot.requested).toBe(0);
  });

  it("EXPORT/ARCHIVE CORRUPTION: a tampered or deleted artifact is detected and HEALED from sources", async () => {
    const run = await deps.store.loadExport(exportId);
    const file = join(STORAGE_DIR, "artifacts", run?.artifactRef ?? "");
    writeFileSync(file, "CORRUPTED BYTES", "utf8");
    let verification = await verifyExport(deps, exportId);
    expect(verification?.artifactMatchesDigest).toBe(false);
    expect(verification?.regeneratedMatchesDigest).toBe(true); // sources still prove it
    expect(verification?.verified).toBe(false);
    expect(
      (await archiveSnapshot(deps, org.id)).exports.find((row) => row.exportId === exportId)
        ?.verified,
    ).toBe(false);

    expect(await regenerateExportArtifact(deps, exportId)).toEqual({ ok: true });
    verification = await verifyExport(deps, exportId);
    expect(verification?.verified).toBe(true);

    rmSync(file);
    expect((await verifyExport(deps, exportId))?.artifactPresent).toBe(false);
    expect(await regenerateExportArtifact(deps, exportId)).toEqual({ ok: true });
    expect((await verifyExport(deps, exportId))?.verified).toBe(true);
  });

  it("STORE FAULTS retry deterministically; the run completes idempotently once IO heals", async () => {
    const requested = await requestExport(
      deps,
      actor,
      { kind: "audit-bundle", params: { fy } },
      newId(),
    );
    expect(requested.ok).toBe(true);
    const bundleId = requested.ok ? requested.streamId : "";
    const badDeps: FinopsDeps = {
      ...deps,
      artifacts: {
        put: () => Promise.reject(new Error("disk_full")),
        get: () => Promise.resolve(null),
      },
    };
    const job = {
      jobId: newId(),
      orgId: org.id,
      kind: "export.generate" as const,
      dedupeKey: `export.generate:${bundleId}`,
      state: "leased" as const,
      attempts: 0,
      maxAttempts: 5,
      notBeforeMs: Date.now(),
      leasedUntilMs: null,
      lastError: null,
      payload: { exportId: bundleId },
    };
    await expect(runExportGenerate(badDeps, job)).rejects.toThrow("disk_full");
    expect((await deps.store.loadExport(bundleId))?.status).toBe("requested");
    await runExportGenerate(deps, job);
    expect((await deps.store.loadExport(bundleId))?.status).toBe("completed");
    await runExportGenerate(deps, job); // idempotent by observation
    expect((await verifyExport(deps, bundleId))?.verified).toBe(true);
  });

  it("AN UNREPRODUCIBLE DOCUMENT POISONS NO ARCHIVE: the run fails terminally; retry is a new run", async () => {
    const seriesEvents = await deps.store.loadStream("series", invoiceSeries);
    const forgedDocId = newId();
    const { orgWatermark } = await import("@desiauction/financial-operations/server");
    await db.insert(finopsEvents).values({
      id: newId(),
      orgId: org.id,
      streamType: "series",
      streamId: invoiceSeries,
      seq: seriesEvents.length + 1,
      type: "DocumentIssued",
      atMs: Date.now(),
      actor: officer,
      correlationId: newId(),
      commandId: newId(),
      payload: {
        docId: forgedDocId,
        number: 2,
        party: { type: "team", id: lions(), label: "Lions" },
        lines: [
          { description: "x", amount: 777, provenance: { stream: `case:${caseId}`, seq: 3 } },
        ],
        amount: 777,
        sourceRef: `case:${newId()}:3:${lions()}`,
        profileSeq: 1,
        watermark: await orgWatermark(deps, org.id),
        contentDigest: "forged",
      },
    });
    await recoverSeries(deps, org.id, invoiceSeries);

    const requested = await requestExport(
      deps,
      actor,
      { kind: "archive-bundle", params: {} },
      newId(),
    );
    const poisonedId = requested.ok ? requested.streamId : "";
    await drainAll(Date.now());
    const run = await deps.store.loadExport(poisonedId);
    expect(run?.status).toBe("failed");
    expect(run?.failureCode).toBe(`document_not_reproducible:${forgedDocId}`);

    // Restore the forged prefix, heal, RETRY as a new run — it completes.
    await db
      .delete(finopsEvents)
      .where(
        and(
          eq(finopsEvents.streamType, "series"),
          eq(finopsEvents.streamId, invoiceSeries),
          sql`${finopsEvents.seq} > ${seriesEvents.length}`,
        ),
      );
    expect((await recoverSeries(deps, org.id, invoiceSeries)).ok).toBe(true);
    documentEventsAtRest = await seriesEventCount();

    const retried = await retryExport(deps, actor, poisonedId, newId());
    expect(retried.ok).toBe(true);
    await drainAll(Date.now());
    const healed = await deps.store.loadExport(retried.ok ? retried.streamId : "");
    expect(healed?.status).toBe("completed");
    expect(healed?.params["retryOf"]).toBe(poisonedId);
  });

  it("DAILY EXPORT: one register per org per day, idempotent, crash-resumable", async () => {
    const date = istDateOf(Date.now());
    const job = {
      jobId: newId(),
      orgId: org.id,
      kind: "export.daily" as const,
      dedupeKey: `export.daily:${org.id}:${date}`,
      state: "leased" as const,
      attempts: 0,
      maxAttempts: 5,
      notBeforeMs: Date.now(),
      leasedUntilMs: null,
      lastError: null,
      payload: { date },
    };
    await runDailyExport(deps, job);
    const daily = (await deps.store.loadExportsByOrg(org.id)).filter(
      (run) => run.params["dailyKey"] === date,
    );
    expect(daily).toHaveLength(1);
    expect(daily[0]?.status).toBe("completed");
    await runDailyExport(deps, job); // same occasion → no second run
    expect(
      (await deps.store.loadExportsByOrg(org.id)).filter((run) => run.params["dailyKey"] === date),
    ).toHaveLength(1);

    // CRASH-RESUME: a run that crashed after ExportRequested (a stranded
    // `requested` run with its dailyKey) is completed by the retried job —
    // never duplicated.
    const yesterday = previousDate(date);
    const stranded = await requestExportSystem(
      deps,
      org.id,
      { kind: "journal-csv", params: { fy, dailyKey: yesterday } },
      `export.daily:${org.id}:${yesterday}`,
    );
    expect(stranded.ok).toBe(true);
    await runDailyExport(deps, {
      ...job,
      dedupeKey: `export.daily:${org.id}:${yesterday}`,
      payload: { date: yesterday },
    });
    const resumed = (await deps.store.loadExportsByOrg(org.id)).filter(
      (run) => run.params["dailyKey"] === yesterday,
    );
    expect(resumed).toHaveLength(1);
    expect(resumed[0]?.status).toBe("completed");
  });
});

describe("M-IP6-3 · Rebuilds, replay & the boundary", () => {
  it("REBUILD AFTER DELETE: dispatch and export rows heal byte-identical from their streams", async () => {
    const dispatchId = (await deps.store.loadDispatchesByStatus(org.id, "confirmed"))[0]
      ?.dispatchId;
    const exportRow = (await deps.store.loadExportsByOrg(org.id)).find(
      (run) => run.status === "completed",
    );
    expect(dispatchId).toBeDefined();
    expect(exportRow).toBeDefined();

    const dispatchBefore = JSON.stringify(await deps.store.loadDispatch(dispatchId ?? ""));
    await db.delete(finopsDispatches).where(eq(finopsDispatches.id, dispatchId ?? ""));
    expect((await recoverDispatch(deps, org.id, dispatchId ?? "")).ok).toBe(true);
    expect(JSON.stringify(await deps.store.loadDispatch(dispatchId ?? ""))).toBe(dispatchBefore);

    const exportBefore = JSON.stringify(await deps.store.loadExport(exportRow?.exportId ?? ""));
    await db.delete(finopsExports).where(eq(finopsExports.id, exportRow?.exportId ?? ""));
    expect((await recoverExport(deps, org.id, exportRow?.exportId ?? "")).ok).toBe(true);
    expect(JSON.stringify(await deps.store.loadExport(exportRow?.exportId ?? ""))).toBe(
      exportBefore,
    );
  });

  it("REPLAY DETERMINISM: every dispatch and export stream folds twice to identical bytes", async () => {
    for (const streamType of ["dispatch", "export"] as const) {
      for (const streamId of await deps.store.listStreamIds(org.id, streamType)) {
        const first = await foldStream(deps, streamType, streamId);
        const second = await foldStream(deps, streamType, streamId);
        expect(first?.ok).toBe(true);
        expect(JSON.stringify(first)).toBe(JSON.stringify(second));
      }
    }
    expect(await verifyOrgFinops(deps, org.id)).toEqual([]);
  });

  it("THE BOUNDARY HELD: delivery edited NEITHER settlement NOR documents", async () => {
    // Settlement: bit-identical since the collections concluded.
    expect(await settlementEventCount()).toBe(settlementCountAtRest);
    // Documents: the series streams saw ONLY the forged-drill events, which
    // were restored to their exact prefixes — every dispatch and export in
    // this suite appended ZERO document events.
    expect(await seriesEventCount()).toBe(documentEventsAtRest);
    // And the daily register still reproduces from sources — nothing drifted.
    const daily = (await deps.store.loadExportsByOrg(org.id)).find(
      (run) => run.params["dailyKey"] !== undefined,
    );
    expect((await verifyExport(deps, daily?.exportId ?? ""))?.verified).toBe(true);
  });

  /*
   * The enqueue pass used to answer "what work is waiting?" by enumerating
   * every organization and querying each one — a cost that grew with the
   * number of TENANTS rather than the amount of WORK. A dev database that had
   * accumulated ~1,500 orgs from past runs made a five-call helper issue
   * thousands of sequential round-trips and time out; in production the same
   * shape charges a query per tick for every org that has never sent anything.
   *
   * The discovery reads are indexed on `status` now. This pins the property
   * that made it wrong, not the timing that revealed it: discovery must not
   * enumerate tenants. Counting the sweep is what keeps it honest — a future
   * `listOrgIds()` loop reintroducing the N+1 fails here immediately.
   */
  it("DISCOVERY IS BY WORK, NOT BY TENANT: enqueueing never enumerates orgs", async () => {
    fakeMode = "ok";
    const dispatchId = await newDispatch("in-app");

    let orgSweeps = 0;
    const counted: FinopsDeps = {
      ...deps,
      orgs: {
        listOrgIds: async () => {
          orgSweeps += 1;
          return deps.orgs.listOrgIds();
        },
      },
    };

    const enqueued = await enqueueDispatchSends(counted, Date.now());
    await enqueueExportGenerations(counted, Date.now());

    // The work was found...
    expect(enqueued).toBeGreaterThanOrEqual(1);
    const queued = (await deps.store.loadJobs(org.id)).map((job) => job.dedupeKey);
    expect(queued).toContain(`dispatch.send:${dispatchId}`);
    // ...without asking the directory who the tenants are, even once.
    expect(orgSweeps).toBe(0);
  });
});

describe("JOB LEASE — the fence and the reclaim count (PA-1 §16)", () => {
  const jobId = "01M1LEASEFENCE00000000JOB1";

  async function seedJob(attempts: number, maxAttempts: number): Promise<void> {
    await db.delete(finopsJobs).where(eq(finopsJobs.id, jobId));
    await db.insert(finopsJobs).values({
      id: jobId,
      orgId: org.id,
      kind: "dispatch.send",
      dedupeKey: `lease-fence-${String(Date.now())}`,
      state: "queued",
      attempts,
      maxAttempts,
      notBeforeMs: 0,
      payload: {},
      updatedAtMs: 0,
    });
  }

  afterAll(async () => {
    await db.delete(finopsJobs).where(eq(finopsJobs.id, jobId));
  });

  it("a worker whose lease was reclaimed cannot write the job's outcome", async () => {
    await seedJob(0, 5);
    const now = Date.now();

    // Worker A claims it, and remembers the lease it claimed with. The suite
    // leaves other jobs queued for this org, so pick ours out of the batch
    // rather than assuming it sorts first.
    const batchA = await deps.store.claimJobs(now, 1_000, 50, org.id);
    const claimedByA = batchA.find((job) => job.jobId === jobId);
    if (claimedByA === undefined) {
      throw new Error("worker A did not claim the seeded job");
    }
    const fenceA = claimedByA.leasedUntilMs;

    // Time passes: A is still working when its lease lapses, and worker B
    // reclaims the job. This is the case the 60s lease makes ordinary — a long
    // export or day attestation outliving a batch claimed under one lease.
    const batchB = await deps.store.claimJobs(now + 2_000, 60_000, 50, org.id);
    const claimedByB = batchB.find((job) => job.jobId === jobId);
    if (claimedByB === undefined) {
      throw new Error("worker B could not reclaim the expired lease");
    }

    // A now finishes and tries to record `done`. It must not land: B owns this.
    const aWon = await deps.store.transact((tx) =>
      tx.updateJob({ ...claimedByA, state: "done", leasedUntilMs: null, lastError: null }, fenceA),
    );
    expect(aWon, "the reclaimed worker's write landed and overwrote the owner's").toBe(false);

    // ...and B's does.
    const bWon = await deps.store.transact((tx) =>
      tx.updateJob(
        { ...claimedByB, state: "done", leasedUntilMs: null, lastError: null },
        claimedByB.leasedUntilMs,
      ),
    );
    expect(bWon).toBe(true);
  });

  it("a reclaim counts as an attempt, so a job that kills its worker dies", async () => {
    // The crash-loop: the process dies before the drain's catch can run, so
    // `attempts` never moved and the job was re-leased for ever at 0.
    await seedJob(2, 3);
    const now = Date.now();

    const first = (await deps.store.claimJobs(now, 1_000, 50, org.id)).find(
      (job) => job.jobId === jobId,
    );
    expect(first?.attempts, "claiming a queued job must not spend an attempt").toBe(2);

    // The worker vanishes; the lease lapses; the job comes back round.
    const reclaimed = await deps.store.claimJobs(now + 2_000, 1_000, 50, org.id);
    expect(
      reclaimed.some((job) => job.jobId === jobId),
      "an exhausted job was handed out again instead of being retired",
    ).toBe(false);

    const [row] = await db
      .select({ state: finopsJobs.state, attempts: finopsJobs.attempts })
      .from(finopsJobs)
      .where(eq(finopsJobs.id, jobId));
    expect(row?.attempts).toBe(3);
    expect(row?.state, "a crash-looping job never dead-lettered").toBe("dead");
  });
});

describe("FOLLOWER ISOLATION — one bad org does not starve the rest (PA-1 §16)", () => {
  it("keeps serving the orgs after the one that throws, and reports it", async () => {
    /**
     * `runFollower` throwing aborted the whole loop, so every org AFTER the
     * failing one was skipped for the tick — and because the org list is stably
     * ordered, the same orgs were skipped every time. One contended stream
     * could stop receipts for everyone sorted below it, indefinitely, while the
     * runner logged a healthy tick.
     */
    const failing = "01M1FOLLOWERISOLATION0BAD1";
    const served: string[] = [];

    const counted = {
      ...deps,
      orgs: { listOrgIds: () => Promise.resolve([failing, org.id]) },
      // `runFollower` opens with `source.listOrgStreamHeads`, so that is where a
      // contended org realistically blows up — and it is the first thing the
      // loop does per org, which is what made the old abort so total.
      source: {
        ...deps.source,
        listOrgStreamHeads: async (orgId: string) => {
          if (orgId === failing) {
            throw new Error("contended stream");
          }
          served.push(orgId);
          return deps.source.listOrgStreamHeads(orgId);
        },
      },
    } as unknown as typeof deps;

    const result = await followAllOrgs(counted);

    expect(
      result.failures.map((failure) => failure.orgId),
      "the failing org was not reported — it would be invisible",
    ).toEqual([failing]);
    expect(
      served,
      "the org after the failing one was never served — one bad org starved the tick",
    ).toContain(org.id);
  });
});

describe("JOB RETENTION — finished jobs age out, dead ones never do (PA-1 §14)", () => {
  it("removes done jobs past the cutoff and keeps dead ones", async () => {
    /**
     * `finops_jobs` had no retention: a `done` row stayed for ever, so the
     * table grew without bound and the claim query's index carried more dead
     * weight every day. `dead` rows are deliberately kept — they are the
     * operator's queue of things that need a human, and the daily checklist
     * reads them, so a sweep that took them would be deleting the alert.
     */
    const oldDone = "01M1RETENTION000000OLDDONE";
    const newDone = "01M1RETENTION000000NEWDONE";
    const oldDead = "01M1RETENTION000000OLDDEAD";
    const now = Date.now();
    const week = 7 * 24 * 60 * 60_000;

    for (const [id, state, updatedAtMs] of [
      [oldDone, "done", now - week - 1000],
      [newDone, "done", now - 1000],
      [oldDead, "dead", now - week - 1000],
    ] as const) {
      await db.delete(finopsJobs).where(eq(finopsJobs.id, id));
      await db.insert(finopsJobs).values({
        id,
        orgId: org.id,
        kind: "dispatch.send",
        dedupeKey: `retention-${id}`,
        state,
        attempts: 0,
        maxAttempts: 5,
        notBeforeMs: 0,
        payload: {},
        updatedAtMs,
      });
    }

    const purged = await deps.store.transact((tx) => tx.purgeFinishedJobs(now - week));
    expect(purged).toBeGreaterThanOrEqual(1);

    const surviving = await db
      .select({ id: finopsJobs.id })
      .from(finopsJobs)
      .where(inArray(finopsJobs.id, [oldDone, newDone, oldDead]));
    const ids = surviving.map((row) => row.id.trim());
    expect(ids, "an aged-out done job survived the sweep").not.toContain(oldDone);
    expect(ids, "a recent done job was swept too early").toContain(newDone);
    expect(ids, "a DEAD job was swept — that is the operator's alert queue").toContain(oldDead);

    await db.delete(finopsJobs).where(inArray(finopsJobs.id, [newDone, oldDead]));
  });
});
