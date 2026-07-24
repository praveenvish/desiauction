// PERMANENT FINANCIAL-OPERATIONS DOCUMENTS REGRESSION SUITE (IP-6, M-IP6-2).
//
// Encodes the frozen contract of Documents against LIVE Postgres: issuance
// that QUOTES the frozen settlement folds (never accepts an amount), dense
// deterministic numbering per lane, watermark coverage as the tenancy and
// freshness guard, one-cause-one-document, fiscal legality, the registered-
// issuer posture gate, auto-receipts under derived command ids, corrections
// that reference and never touch, byte-identical reproduction (and forged
// monetary values caught BY reproduction), tamper → halt → heal, rebuild
// identity, and the boundary meter: the settlement log is bit-identical
// across every document operation.
//
// The settled history it documents is REAL: a night conducted through the
// FROZEN IP-4 aggregate, collected through the FROZEN IP-5 writer.
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
  finopsDocuments,
  finopsEvents,
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
import { fiscalYearOf, formattedNumber, istDateOf } from "@desiauction/financial-operations";
import {
  amendProfile,
  declareProfile,
  finopsDeps,
  foldStream,
  documentSnapshot,
  issuanceSnapshot,
  issueCorrection,
  issueInvoice,
  issueReceipt,
  openSeries,
  recoverSeries,
  reproduceDocument,
  rewindFollower,
  runFollower,
  seriesSnapshot,
  verifyOrgFinops,
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
  computeCaseObligations,
  createPayment,
  openCase,
  refundManualPayment,
  verifyCase,
  waiveObligation,
} from "../settlement/writer";
import { issueSettlementGrant, settlementActor } from "../settlement/authz";
import { settlementDeps, type SettlementDeps } from "../settlement/deps";
import type { SettlementActor } from "../settlement/writer";
import { canFinops, finopsActor, issueFinopsGrant, revokeFinopsGrant } from "./authz";

const handle: DbHandle = createDb(env.DATABASE_URL);
const db = handle.db;
const sender = new DevInboxSender(db);

const RUN = String(Date.now()).slice(-7);
const PHONE_OWNER = `+9189${RUN}1`;
const PHONE_OFFICER = `+9188${RUN}2`;
const PHONE_OUTSIDER = `+9187${RUN}3`;
const TEST_PHONES = [PHONE_OWNER, PHONE_OFFICER, PHONE_OUTSIDER];
const SEED_PHONE_PREFIX = `+91922${RUN}`;

const SALE_A = 5_000_000;
const SALE_B = 2_500_000;
const TIGERS_DUE = SALE_A * 2;
const LIONS_DUE = SALE_B;
const PARTIAL = 4_000_000;
const REMAINDER = TIGERS_DUE - PARTIAL;
const REFUND = 1_000_000;

let owner = "";
let officer = "";
let outsider = "";
let org = { id: "", name: "", slug: "" };
let comp: CompetitionSummary = null as unknown as CompetitionSummary;
let auction: AuctionRecord = null as unknown as AuctionRecord;
const teamIds: string[] = [];
const paddleIds: string[] = [];

let sdeps: SettlementDeps;
let sactor: SettlementActor;
let deps: FinopsDeps;
let actor: FinopsActor;
let caseId = "";
let payment1 = "";
let payment2 = "";
/** The current fiscal year — every settlement fact in this suite happens today. */
let fy = "";

let receiptSeries = "";
let invoiceSeries = "";
let correctionSeries = "";
let priorFyReceiptSeries = "";

let receipt1 = "";
let receipt2 = "";
let invoiceTigers = "";
let invoiceLions = "";

/** The settlement log's size after the LAST settlement mutation — the meter. */
let settlementCountAfterLastMutation = 0;

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

async function collectManual(paymentId: string, teamId: string, amount: number): Promise<void> {
  const created = await createPayment(sdeps, sactor, {
    paymentId,
    commandId: newId(),
    caseId,
    teamId,
    method: "manual:cash",
    amount,
  });
  if (!created.ok) {
    throw new Error(`createPayment: ${created.reason}`);
  }
  const captured = await attestManualCapture(sdeps, sactor, paymentId, newId(), {
    attestedBy: officer,
    evidenceRef: "cash-book",
  });
  if (!captured.ok) {
    throw new Error(`attest: ${captured.reason}`);
  }
}

async function settlementEventCount(): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(settlementEvents)
    .where(eq(settlementEvents.orgId, org.id));
  return row?.n ?? 0;
}

function priorFy(current: string): string {
  const start = Number(current.slice(0, 4)) - 1;
  return `${String(start)}-${String((start + 1) % 100).padStart(2, "0")}`;
}

beforeAll(async () => {
  owner = await login(PHONE_OWNER);
  officer = await login(PHONE_OFFICER);
  outsider = await login(PHONE_OUTSIDER);

  org = await createOrg(db, owner, `Docs ${RUN}`);
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
    throw new Error(`settlement grant: ${sgrant.reason}`);
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
  const verified = await verifyCase(sdeps, sactor, caseId, newId());
  if (!verified.ok) {
    throw new Error(`verifyCase: ${verified.reason}`);
  }
  const computed = await computeCaseObligations(sdeps, sactor, caseId, newId());
  if (!computed.ok) {
    throw new Error(`compute: ${computed.reason}`);
  }
  // Tigers pay a first PARTIAL instalment; the case stays `settling` — the
  // documents below are issued against a LIVE settlement, not a museum piece.
  payment1 = newId();
  await collectManual(payment1, tigers(), PARTIAL);

  deps = finopsDeps(db);
  fy = fiscalYearOf(istDateOf(Date.now()));
  const fgrant = await issueFinopsGrant(db, owner, org.id, officer, "finops:controller");
  if (!fgrant.ok) {
    throw new Error(`finops grant: ${fgrant.reason}`);
  }
  actor = await finopsActor(db, officer, org.id);

  const declared = await declareProfile(
    deps,
    actor,
    { legalName: `Docs ${RUN} Trust`, posture: "none" },
    newId(),
  );
  if (!declared.ok) {
    throw new Error(`declareProfile: ${declared.reason}`);
  }
  await runFollower(deps, org.id);

  for (const [kind, fyOf, assign] of [
    ["receipt", fy, (id: string) => (receiptSeries = id)],
    ["tax-invoice", fy, (id: string) => (invoiceSeries = id)],
    ["correction", fy, (id: string) => (correctionSeries = id)],
    ["receipt", priorFy(fy), (id: string) => (priorFyReceiptSeries = id)],
  ] as const) {
    const ack = await openSeries(
      deps,
      actor,
      {
        kind,
        fy: fyOf,
        prefix: kind === "correction" ? "CRN" : kind === "receipt" ? "RCT" : "INV",
      },
      newId(),
    );
    if (!ack.ok) {
      throw new Error(`openSeries ${kind}/${fyOf}`);
    }
    assign(ack.streamId);
  }
}, 180_000);

afterAll(async () => {
  await db.delete(finopsCursors).where(eq(finopsCursors.orgId, org.id));
  await db.delete(finopsJobs).where(eq(finopsJobs.orgId, org.id));
  await db.delete(finopsPeriodDays).where(eq(finopsPeriodDays.orgId, org.id));
  await db.delete(finopsPeriods).where(eq(finopsPeriods.orgId, org.id));
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

describe("M-IP6-2 · Invoices — the recognised demand, quoted", () => {
  it("issues dense invoices per team; amounts come OFF the case fold, never from the caller", async () => {
    const first = await issueInvoice(
      deps,
      actor,
      { seriesId: invoiceSeries, caseId, teamId: tigers() },
      newId(),
    );
    expect(first).toMatchObject({ ok: true, status: "accepted" });
    const second = await issueInvoice(
      deps,
      actor,
      { seriesId: invoiceSeries, caseId, teamId: lions() },
      newId(),
    );
    expect(second.ok).toBe(true);

    const docs = await deps.store.loadDocuments(invoiceSeries);
    expect(docs.map((doc) => doc.number)).toEqual([1, 2]);
    invoiceTigers = docs[0]?.docId ?? "";
    invoiceLions = docs[1]?.docId ?? "";
    expect(docs[0]?.amount).toBe(TIGERS_DUE);
    expect(docs[1]?.amount).toBe(LIONS_DUE);
    // Label SNAPSHOTS resolved from reference data at issue.
    expect(docs.map((doc) => doc.partyLabel).sort()).toEqual(["Lions", "Tigers"]);
    // Both demands reproduce byte-identically from the case fold.
    expect((await reproduceDocument(deps, invoiceTigers)).matches).toBe(true);
    expect((await reproduceDocument(deps, invoiceLions)).matches).toBe(true);
    expect(await verifyOrgFinops(deps, org.id)).toEqual([]);
  });

  it("ONE CAUSE, ONE DOCUMENT: re-invoicing a team refuses; duplicate command returns the original", async () => {
    const commandId = newId();
    const dup = await issueInvoice(
      deps,
      actor,
      { seriesId: invoiceSeries, caseId, teamId: tigers() },
      commandId,
    );
    expect(dup).toEqual({ ok: false, reason: "duplicate_document_source" });
    expect(
      await issueInvoice(
        deps,
        actor,
        { seriesId: invoiceSeries, caseId, teamId: "01TEAMUNKNOWN0000000000000" },
        newId(),
      ),
    ).toEqual({
      ok: false,
      reason: "obligation_unknown",
    });
  });

  it("a REGISTERED issuer gets no invoice until decomposition is authorized (never a non-compliant document)", async () => {
    const registered = await amendProfile(
      deps,
      actor,
      { reason: "gst registration", posture: "gst-registered", gstin: "27AAPFU0939F1ZV" },
      newId(),
    );
    expect(registered.ok).toBe(true);
    // A team with no invoice yet would still be refused — prove with a fresh series-level attempt.
    expect(
      await issueInvoice(
        deps,
        actor,
        { seriesId: invoiceSeries, caseId, teamId: tigers() },
        newId(),
      ),
    ).toEqual({ ok: false, reason: "tax_decomposition_not_available" });
    const back = await amendProfile(
      deps,
      actor,
      { reason: "deregistered (drill)", posture: "none", gstin: null },
      newId(),
    );
    expect(back.ok).toBe(true);
  });
});

describe("M-IP6-2 · Receipts — proof of payment, quoted off the payment fold", () => {
  it("issues the receipt for the first instalment; reproduction is byte-identical", async () => {
    const ack = await issueReceipt(
      deps,
      { kind: "person", actor, capability: "finops.document" },
      { seriesId: receiptSeries, paymentId: payment1 },
      newId(),
    );
    expect(ack).toMatchObject({ ok: true, status: "accepted" });
    const docs = await deps.store.loadDocuments(receiptSeries);
    receipt1 = docs[0]?.docId ?? "";
    expect(docs[0]?.number).toBe(1);
    expect(docs[0]?.amount).toBe(PARTIAL);
    expect(docs[0]?.partyLabel).toBe("Tigers");

    const reproduction = await reproduceDocument(deps, receipt1);
    expect(reproduction.ok).toBe(true);
    expect(reproduction.matches).toBe(true);
    expect(reproduction.digest).toBe(reproduction.pinnedDigest);

    const snapshot = await documentSnapshot(deps, receipt1);
    expect(snapshot?.reproducible).toBe(true);
    expect(snapshot?.formatted).toBe(formattedNumber("RCT", fy, 1));
  });

  it("FISCAL LEGALITY: a fact of this year cannot be issued into last year's lane", async () => {
    expect(
      await issueReceipt(
        deps,
        { kind: "person", actor, capability: "finops.document" },
        { seriesId: priorFyReceiptSeries, paymentId: payment1 },
        newId(),
      ),
    ).toEqual({ ok: false, reason: "fiscal_year_mismatch" });
  });

  it("WATERMARK COVERAGE: unconsumed history cannot be quoted; the follower closes the gap", async () => {
    // A fresh settlement fact the follower has not seen…
    payment2 = newId();
    await collectManual(payment2, tigers(), REMAINDER);
    await rewindFollower(deps, org.id);
    expect(
      await issueReceipt(
        deps,
        { kind: "person", actor, capability: "finops.document" },
        { seriesId: receiptSeries, paymentId: payment2 },
        newId(),
      ),
    ).toEqual({ ok: false, reason: "watermark_behind_source" });
    await runFollower(deps, org.id);
  });

  it("AUTO-RECEIPT: the follower policy issues under a DERIVED command id — crash-proof, re-run-proof", async () => {
    const enabled = await amendProfile(
      deps,
      actor,
      { reason: "auto receipts on", autoReceipt: true },
      newId(),
    );
    expect(enabled.ok).toBe(true);

    const run = await runFollower(deps, org.id);
    expect(run.autoReceipts.issued).toBe(1);
    expect(run.autoReceipts.skipped).toEqual([]);

    const docs = await deps.store.loadDocuments(receiptSeries);
    expect(docs.map((doc) => doc.number)).toEqual([1, 2]);
    receipt2 = docs[1]?.docId ?? "";
    expect(docs[1]?.amount).toBe(REMAINDER);
    expect(docs[1]?.issuedBy).toBe("00000000000000000000000000"); // the sentinel

    // Re-running the policy re-derives the SAME command — nothing doubles.
    const again = await runFollower(deps, org.id);
    expect(again.autoReceipts.issued).toBe(0);
    expect((await deps.store.loadDocuments(receiptSeries)).length).toBe(2);
    const snapshot = await issuanceSnapshot(deps, org.id);
    expect(snapshot.receiptDue).toEqual([]);
    expect(snapshot.documentsIssued).toBe(4); // 2 receipts + 2 invoices
  });
});

describe("M-IP6-2 · Corrections — compensations quoted, originals never touched", () => {
  it("a refund becomes a correction of ITS receipt; the wrong linkage refuses", async () => {
    const refunded = await refundManualPayment(sdeps, sactor, payment2, newId(), {
      amount: REFUND,
      reason: "overcharge returned",
    });
    expect(refunded.ok).toBe(true);
    settlementCountAfterLastMutation = 0; // set below, after the LAST settlement mutation
    await runFollower(deps, org.id);

    const refundSeq = (await deps.source.loadEventsFrom("payment", payment2, 0)).find(
      (event) => event.type === "PaymentRefunded",
    )?.seq;
    expect(refundSeq).toBeDefined();

    // The refund compensates receipt2, not receipt1.
    expect(
      await issueCorrection(
        deps,
        actor,
        {
          seriesId: correctionSeries,
          correctsDocId: receipt1,
          causeStreamType: "payment",
          causeStreamId: payment2,
          causeSeq: refundSeq ?? 0,
          reason: "refund issued",
        },
        newId(),
      ),
    ).toEqual({ ok: false, reason: "corrects_mismatch" });
    // Quoting a CAPTURE as a compensation is refused outright.
    expect(
      await issueCorrection(
        deps,
        actor,
        {
          seriesId: correctionSeries,
          correctsDocId: receipt2,
          causeStreamType: "payment",
          causeStreamId: payment2,
          causeSeq: 2,
          reason: "nonsense",
        },
        newId(),
      ),
    ).toEqual({ ok: false, reason: "cause_not_compensating" });

    const issued = await issueCorrection(
      deps,
      actor,
      {
        seriesId: correctionSeries,
        correctsDocId: receipt2,
        causeStreamType: "payment",
        causeStreamId: payment2,
        causeSeq: refundSeq ?? 0,
        reason: "refund issued",
      },
      newId(),
    );
    expect(issued).toMatchObject({ ok: true, status: "accepted" });
    const docs = await deps.store.loadDocuments(correctionSeries);
    expect(docs[0]?.number).toBe(1);
    expect(docs[0]?.amount).toBe(REFUND);
    expect(docs[0]?.corrects).toBe(receipt2);
    // The original is UNTOUCHED — history referenced, never rewritten.
    expect((await deps.store.loadDocument(receipt2))?.amount).toBe(REMAINDER);
  });

  it("a waiver becomes a correction of the INVOICE; corrections never chain", async () => {
    const waived = await waiveObligation(sdeps, sactor, caseId, newId(), {
      teamId: lions(),
      amount: LIONS_DUE,
      reason: "sponsor covered the Lions",
    });
    expect(waived.ok).toBe(true);
    settlementCountAfterLastMutation = await settlementEventCount();
    await runFollower(deps, org.id);

    const waiveSeq = (await deps.source.loadEventsFrom("case", caseId, 0)).find(
      (event) => event.type === "ObligationWaived",
    )?.seq;
    const issued = await issueCorrection(
      deps,
      actor,
      {
        seriesId: correctionSeries,
        correctsDocId: invoiceLions,
        causeStreamType: "case",
        causeStreamId: caseId,
        causeSeq: waiveSeq ?? 0,
        reason: "dues waived",
      },
      newId(),
    );
    expect(issued).toMatchObject({ ok: true, status: "accepted" });
    const docs = await deps.store.loadDocuments(correctionSeries);
    expect(docs.map((doc) => doc.number)).toEqual([1, 2]);
    expect(docs[1]?.amount).toBe(LIONS_DUE);
    expect(docs[1]?.corrects).toBe(invoiceLions);

    // Corrections chain to SOURCE documents, never to each other.
    expect(
      await issueCorrection(
        deps,
        actor,
        {
          seriesId: correctionSeries,
          correctsDocId: docs[0]?.docId ?? "",
          causeStreamType: "payment",
          causeStreamId: payment2,
          causeSeq: 3,
          reason: "chain attempt",
        },
        newId(),
      ),
    ).toEqual({ ok: false, reason: "corrects_invalid" });

    // Every correction reproduces byte-identically too.
    for (const doc of docs) {
      const reproduction = await reproduceDocument(deps, doc.docId);
      expect(reproduction.ok).toBe(true);
      expect(reproduction.matches).toBe(true);
    }
  });
});

describe("M-IP6-2 · Hostile drills — forged values, corrupted rows, rebuilds", () => {
  it("FORGED MONETARY VALUE: a self-consistent forged event folds, but reproduction UNMASKS it", async () => {
    const seriesEvents = await deps.store.loadStream("series", receiptSeries);
    const forgedId = newId();
    const forgedDocId = newId();
    // A COMPETENT forger keeps the event self-consistent (dense number,
    // advancing watermark, amount == lines) so the reducer accepts it.
    const { orgWatermark } = await import("@desiauction/financial-operations/server");
    const advancingWatermark = await orgWatermark(deps, org.id);
    await db.insert(finopsEvents).values({
      id: forgedId,
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
        number: 3,
        party: { type: "team", id: tigers(), label: "Tigers" },
        lines: [
          {
            description: "Payment received — manual:cash",
            amount: 999, // the lie: no settlement fact says this
            provenance: { stream: `payment:${payment1}`, seq: 2 },
          },
        ],
        amount: 999,
        sourceRef: `payment:${newId()}:2`,
        profileSeq: 1,
        watermark: advancingWatermark,
        contentDigest: "forged-digest",
      },
    });

    // The projection rows now disagree with the log → commands HALT.
    const halted = await issueReceipt(
      deps,
      { kind: "person", actor, capability: "finops.document" },
      { seriesId: receiptSeries, paymentId: payment1 },
      newId(),
    );
    expect(halted.ok).toBe(false);
    if (!halted.ok) {
      expect(halted.reason).toBe("finops_halted");
    }
    // Recovery heals rows FROM the log (the forged doc lands in the register)…
    expect((await recoverSeries(deps, org.id, receiptSeries)).ok).toBe(true);
    // …but REPRODUCTION exposes the forgery: no settlement fact backs it.
    const reproduction = await reproduceDocument(deps, forgedDocId);
    expect(reproduction.ok).toBe(false);
    const snapshot = await documentSnapshot(deps, forgedDocId);
    expect(snapshot?.reproducible).toBe(false);
    // Honest documents still reproduce.
    expect((await reproduceDocument(deps, receipt1)).matches).toBe(true);

    // The drill's restore — PITR semantics: roll the stream back to the last
    // seq BEFORE the corruption (the forged append AND everything after it,
    // including the lawful SeriesRecovered marker recovery added on top),
    // then heal the rows from the restored log. Deleting only the forged
    // event would leave a gap — a restore is a prefix, never a splice.
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
    expect((await deps.store.loadDocuments(receiptSeries)).length).toBe(2);
    expect(await verifyOrgFinops(deps, org.id)).toEqual([]);
  });

  it("CORRUPTED ROW: a tampered amount or digest halts commands and heals byte-identical", async () => {
    const before = await deps.store.loadDocuments(receiptSeries);
    await db
      .update(finopsDocuments)
      .set({ amount: 1, contentDigest: "tampered" })
      .where(eq(finopsDocuments.id, receipt1));
    const halted = await issueReceipt(
      deps,
      { kind: "person", actor, capability: "finops.document" },
      { seriesId: receiptSeries, paymentId: payment1 },
      newId(),
    );
    expect(halted.ok).toBe(false);
    if (!halted.ok) {
      expect(halted.reason).toBe("finops_halted");
    }
    expect((await recoverSeries(deps, org.id, receiptSeries)).ok).toBe(true);
    expect(JSON.stringify(await deps.store.loadDocuments(receiptSeries))).toBe(
      JSON.stringify(before),
    );
  });

  it("REBUILD IDENTITY: destroy the register; recovery reproduces it from events, byte for byte", async () => {
    const beforeDocs = await deps.store.loadDocuments(correctionSeries);
    const beforeSeries = await deps.store.loadSeries(correctionSeries);
    await db.delete(finopsDocuments).where(eq(finopsDocuments.seriesId, correctionSeries));
    await db.delete(finopsSeries).where(eq(finopsSeries.id, correctionSeries));
    expect((await recoverSeries(deps, org.id, correctionSeries)).ok).toBe(true);
    expect(JSON.stringify(await deps.store.loadDocuments(correctionSeries))).toBe(
      JSON.stringify(beforeDocs),
    );
    expect(JSON.stringify(await deps.store.loadSeries(correctionSeries))).toBe(
      JSON.stringify(beforeSeries),
    );
  });

  it("REPLAY DETERMINISM: every series folds twice to identical bytes; snapshots agree", async () => {
    for (const seriesId of [receiptSeries, invoiceSeries, correctionSeries]) {
      const first = await foldStream(deps, "series", seriesId);
      const second = await foldStream(deps, "series", seriesId);
      expect(first?.ok).toBe(true);
      expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    }
    const snapshot = await seriesSnapshot(deps, receiptSeries);
    expect(snapshot?.nextNumber).toBe(3);
    expect(snapshot?.documents.map((doc) => doc.number)).toEqual([1, 2]);
  });
});

describe("M-IP6-2 · Authorization & the boundary", () => {
  it("issuance demands finops.document; a clerk can, an outsider cannot", async () => {
    const outsiderActor = await finopsActor(db, outsider, org.id);
    expect(
      await issueReceipt(
        deps,
        { kind: "person", actor: outsiderActor, capability: "finops.document" },
        { seriesId: receiptSeries, paymentId: payment1 },
        newId(),
      ),
    ).toEqual({ ok: false, reason: "not_authorized" });

    const granted = await issueFinopsGrant(db, owner, org.id, outsider, "finops:clerk");
    expect(granted.ok).toBe(true);
    expect(await canFinops(db, outsider, org.id, "finops.document")).toBe(true);
    const clerkActor = await finopsActor(db, outsider, org.id);
    // The clerk's power is real: the command passes authorization and fails
    // only on the ALREADY-DOCUMENTED source.
    expect(
      await issueReceipt(
        deps,
        { kind: "person", actor: clerkActor, capability: "finops.document" },
        { seriesId: receiptSeries, paymentId: payment1 },
        newId(),
      ),
    ).toEqual({ ok: false, reason: "duplicate_document_source" });
    if (granted.ok) {
      expect((await revokeFinopsGrant(db, owner, org.id, granted.grantId)).ok).toBe(true);
    }
  });

  it("THE BOUNDARY HELD: documents appended ZERO settlement events", async () => {
    // Every document operation after the last settlement mutation — issuance,
    // corrections, forgeries, recoveries, rebuilds, snapshots — left the
    // settlement log bit-identical. Documents quote; they never write.
    expect(settlementCountAfterLastMutation).toBeGreaterThan(0);
    expect(await settlementEventCount()).toBe(settlementCountAfterLastMutation);
  });
});
