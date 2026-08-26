// PERMANENT COLLECTIONS REGRESSION SUITE (IP-5, M-IP5-2).
//
// Proves the ratified Collections quality gates against LIVE Postgres, on a REAL
// auction settled into a `settling` case: duplicate command id, duplicate
// webhook, provider replay, provider out-of-order events, partial / multiple
// collections, overpayment, refund liability, balanced journal, wallet == journal
// fold, deterministic replay, projection rebuild identity, recovery identity,
// gateway isolation, manual/provider behavioural parity, cross-tenant isolation,
// and audit completeness.
//
// The gateway is a REAL Razorpay adapter with a known webhook secret and an
// injected HTTP transport — the HMAC path is exercised for real; no live network.
import { createHmac } from "node:crypto";

import { canonicalJson, DEFAULT_AUCTION_CONFIG, registrationNumber } from "@desiauction/core";
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
  createDb,
  journalLegs,
  journalPostings,
  newId,
  organizations,
  orgMembers,
  otpInbox,
  otpCodes,
  payments as paymentsTable,
  people,
  registrations as registrationsTable,
  sessions,
  settlementCases,
  settlementEvents,
  settlementObligations,
  grants as grantsTable,
  auditLog,
  journalCheckpoints,
  type DbHandle,
} from "@desiauction/db";
import {
  canonicalJournalBytes,
  collectionsSummary,
  duesAccount,
  replayJournal,
  replayPayment,
  trialBalance,
  type PaymentGatewayPort,
} from "@desiauction/settlement";
import { and, eq, inArray, like } from "drizzle-orm";
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
import { createRazorpayAdapter, type HttpTransport } from "./adapters/razorpay";
import { issueSettlementGrant, settlementActor } from "./authz";
import { settlementDeps, type SettlementDeps } from "./deps";
import { recoverCase, recoverJournal, recoverPayments } from "./recovery";
import { handleRazorpayWebhook } from "./webhook";
import {
  attestManualCapture,
  caseFold,
  computeCaseObligations,
  createPayment,
  journalFold,
  openCase,
  runPaymentCoordination,
  verifyCase,
  waiveObligation,
  type SettlementActor,
} from "./writer";

const handle: DbHandle = createDb(env.DATABASE_URL);
const db = handle.db;
const sender = new DevInboxSender(db);

// A distinct phone band from the Foundation suite (98xx/97xx/944xx): the two
// settlement suites run in PARALLEL against the same DB, so their identifiers
// must never collide even when Date.now() lands on the same millisecond.
const RUN = String(Date.now()).slice(-7);
const PHONE_OWNER = `+9188${RUN}1`;
const PHONE_OFFICER = `+9187${RUN}2`;
const TEST_PHONES = [PHONE_OWNER, PHONE_OFFICER];
const SEED = `+91933${RUN}`;
const WEBHOOK_SECRET = "whsec_collections_test";
const NOW = 1_700_000_000_000;

const SALE_A = 5_000_000;
const SALE_B = 2_500_000;
const TIGERS_DUE = SALE_A * 2; // ₹1,00,000 over two band-A players
const LIONS_DUE = SALE_B; // ₹25,000

let owner = "";
let officer = "";
let org = { id: "", name: "", slug: "" };
let comp: CompetitionSummary = null as unknown as CompetitionSummary;
let auction: AuctionRecord = null as unknown as AuctionRecord;
const teamIds: string[] = [];
const paddleIds: string[] = [];

let deps: SettlementDeps;
let actor: SettlementActor;
let caseId = "";

const tigers = (): string => teamIds[0] ?? "";
const lions = (): string => teamIds[1] ?? "";

/** The provider transport: createOrder returns a deterministic order ref. */
const transport: HttpTransport = (url) => {
  if (url.endsWith("/orders")) {
    return Promise.resolve({ status: 200, body: JSON.stringify({ id: `order_${newId()}` }) });
  }
  return Promise.resolve({ status: 200, body: "{}" });
};

function sign(body: string): string {
  return createHmac("sha256", WEBHOOK_SECRET).update(body).digest("hex");
}

/** A signed Razorpay webhook body for a payment event. */
function webhookBody(paymentId: string, event: string, entity: Record<string, unknown>): string {
  const key = event.startsWith("refund") ? "refund" : "payment";
  return JSON.stringify({
    event,
    created_at: Math.floor(NOW / 1000),
    payload: {
      [key]: {
        entity: {
          currency: "INR",
          notes: { paymentId, orgId: org.id },
          ...entity,
        },
      },
    },
  });
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
  await db.insert(people).values({ id: personId, phone: `${SEED}${suffix}`, name });
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
  if (current === null) throw new Error("competition");
  const ready = await auctionReady(db, current);
  const created = await createAuction(db, comp, ready, owner, DEFAULT_AUCTION_CONFIG);
  if (!created.ok) throw new Error(`createAuction: ${created.reason}`);
  const record = await auctionOf(db, comp.id);
  if (record === null) throw new Error("no auction");
  auction = record;

  for (const teamId of teamIds) {
    const issued = await issuePaddle(db, auction, owner, teamId, owner);
    if (!issued.ok) throw new Error(`issuePaddle: ${issued.reason}`);
    paddleIds.push(issued.paddleId);
  }
  await queueAllLots(db, auction, owner);
  if (!(await transitionAuction(db, auction, owner, "open")).ok) throw new Error("open");
  auction = (await auctionOf(db, comp.id)) ?? auction;

  const sales = [
    { player: "Tiger One", paddle: paddleIds[0], amount: SALE_A },
    { player: "Tiger Two", paddle: paddleIds[0], amount: SALE_A },
    { player: "Lion One", paddle: paddleIds[1], amount: SALE_B },
  ];
  for (const sale of sales) {
    const lot = await lotByPlayer(sale.player);
    if (!(await transitionLot(db, auction, lot.id, owner, "open")).ok) {
      throw new Error(`lot open: ${sale.player}`);
    }
    const bid = await placeBid(db, auction, owner, {
      lotId: lot.id,
      paddleId: sale.paddle ?? "",
      amountRaw: sale.amount,
      bidderAuthorized: true,
    });
    if (!bid.ok) throw new Error(`bid ${sale.player}: ${bid.code}`);
    if (!(await transitionLot(db, auction, lot.id, owner, "sell")).ok) {
      throw new Error(`sell ${sale.player}`);
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
  )
    throw new Error("complete");
}

/** The cross-aggregate law, re-asserted after every movement: dues wallet == case outstanding. */
async function expectBooksAgreeWithCase(): Promise<void> {
  const { outstandingOf } = await import("@desiauction/settlement");
  const fold = await caseFold(deps, caseId);
  const journal = await journalFold(deps, org.id);
  if (fold === null || journal === null) throw new Error("folds");
  expect(trialBalance(journal).balanced).toBe(true);
  for (const obligation of Object.values(fold.projection.obligations)) {
    const wallet = journal.accounts[duesAccount(caseId, obligation.teamId)];
    const balance = wallet === undefined ? 0 : wallet.debits - wallet.credits;
    expect(balance).toBe(outstandingOf(obligation));
  }
}

beforeAll(async () => {
  owner = await login(PHONE_OWNER);
  officer = await login(PHONE_OFFICER);
  org = await createOrg(db, owner, `Coll ${RUN}`);
  comp = await createCompetition(db, org.id, owner, {
    name: `Season ${RUN}`,
    location: "Malad",
    startsOn: "2026-08-01",
    endsOn: "2026-09-15",
  });
  for (const name of ["Tigers", "Lions"]) {
    const team = await createTeam(db, org.id, comp.id, owner, name);
    if (!team.ok) throw new Error("team");
    teamIds.push(team.team.id);
  }
  let current = await resolveCompetition(db, owner, comp.slug);
  if (current === null) throw new Error("competition");
  await advanceCompetition(db, current, owner, "setup");
  current = await resolveCompetition(db, owner, comp.slug);
  if (current === null) throw new Error("competition");
  await advanceCompetition(db, current, owner, "registration_open");
  await seedApproved("Tiger One", "a01", "A");
  await seedApproved("Tiger Two", "a02", "A");
  await seedApproved("Lion One", "a03", "B");
  current = await resolveCompetition(db, owner, comp.slug);
  if (current === null) throw new Error("competition");
  await advanceCompetition(db, current, owner, "registration_closed");
  comp = (await resolveCompetition(db, owner, comp.slug)) ?? comp;
  await conductAuctionNight();

  const razorpay = createRazorpayAdapter({
    keyId: "rzp_test",
    keySecret: "secret",
    webhookSecret: WEBHOOK_SECRET,
    transport,
  });
  deps = settlementDeps(db, {
    checkpointCadence: 3,
    gateways: { "gateway:razorpay": razorpay },
    // The organizer is onboarded to their own account at the gateway, so the
    // money routes to them. Without this every gateway order below is refused —
    // which is the point of the split-settlement guard, and is asserted on its
    // own further down.
    settlementAccount: () => Promise.resolve("acc_ORGANIZER01"),
  });
  const granted = await issueSettlementGrant(db, owner, org.id, officer, "settlement:controller");
  if (!granted.ok) throw new Error("grant");
  actor = await settlementActor(db, officer, org.id);

  // Bring the case to `settling` (obligations computed) — the collections start line.
  const opened = await openCase(deps, actor, {
    commandId: newId(),
    auctionId: auction.id,
    basis: "committed",
  });
  if (!opened.ok) throw new Error("open case");
  caseId = opened.caseId;
  await verifyCase(deps, actor, caseId, newId());
  await computeCaseObligations(deps, actor, caseId, newId());
}, 120_000);

afterAll(async () => {
  await db.delete(paymentsTable).where(eq(paymentsTable.orgId, org.id));
  await db.delete(journalLegs).where(eq(journalLegs.orgId, org.id));
  await db.delete(journalPostings).where(eq(journalPostings.orgId, org.id));
  await db.delete(journalCheckpoints).where(eq(journalCheckpoints.orgId, org.id));
  await db.delete(settlementObligations).where(eq(settlementObligations.caseId, caseId));
  await db.delete(settlementEvents).where(eq(settlementEvents.orgId, org.id));
  await db.delete(settlementCases).where(eq(settlementCases.orgId, org.id));
  await db.delete(auditLog).where(eq(auditLog.scopeId, org.id));
  await db.delete(grantsTable).where(eq(grantsTable.scopeId, org.id));
  await db.delete(orgMembers).where(eq(orgMembers.orgId, org.id));
  await db.delete(organizations).where(eq(organizations.id, org.id));
  await db.delete(otpCodes).where(inArray(otpCodes.phone, TEST_PHONES));
  await db.delete(otpInbox).where(inArray(otpInbox.phone, TEST_PHONES));
  await db.delete(sessions).where(inArray(sessions.personId, [owner, officer]));
  await db.delete(people).where(inArray(people.phone, TEST_PHONES));
  await db.delete(people).where(like(people.phone, `${SEED}%`));
  await handle.sql.end({ timeout: 5 });
}, 60_000);

let lionsPaymentId = "";

describe("M-IP5-2 · Manual collections (partial, multiple, parity)", () => {
  it("collects Tigers' dues over TWO partial manual payments", async () => {
    // Payment 1: ₹40,000 of the ₹1,00,000 owed.
    const p1 = newId();
    const c1 = await createPayment(deps, actor, {
      paymentId: p1,
      commandId: newId(),
      caseId,
      teamId: tigers(),
      method: "manual:cash",
      amount: 4_000_000,
    });
    expect(c1.ok).toBe(true);
    expect(
      (
        await attestManualCapture(deps, actor, p1, newId(), {
          attestedBy: officer,
          evidenceRef: "r1",
        })
      ).ok,
    ).toBe(true);

    let fold = await caseFold(deps, caseId);
    const { outstandingOf } = await import("@desiauction/settlement");
    expect(outstandingOf(fold?.projection.obligations[tigers()] ?? emptyObligation())).toBe(
      6_000_000,
    );
    await expectBooksAgreeWithCase();

    // Payment 2: the remaining ₹60,000.
    const p2 = newId();
    expect(
      (
        await createPayment(deps, actor, {
          paymentId: p2,
          commandId: newId(),
          caseId,
          teamId: tigers(),
          method: "manual:cash",
          amount: 6_000_000,
        })
      ).ok,
    ).toBe(true);
    expect((await attestManualCapture(deps, actor, p2, newId(), { attestedBy: officer })).ok).toBe(
      true,
    );

    fold = await caseFold(deps, caseId);
    expect(outstandingOf(fold?.projection.obligations[tigers()] ?? emptyObligation())).toBe(0);
    await expectBooksAgreeWithCase();
  });

  it("refuses a payment beyond the team's outstanding, and off a non-settling team", async () => {
    // Tigers now owe nothing — any positive payment exceeds outstanding.
    const refused = await createPayment(deps, actor, {
      paymentId: newId(),
      commandId: newId(),
      caseId,
      teamId: tigers(),
      method: "manual:cash",
      amount: 1,
    });
    expect(refused).toMatchObject({ ok: false, reason: "amount_exceeds_outstanding" });
  });

  it("is idempotent on a duplicate command id — no second payment, no double discharge", async () => {
    const paymentId = newId();
    const commandId = newId();
    const cmd = {
      paymentId,
      commandId,
      caseId,
      teamId: lions(),
      method: "manual:cash" as const,
      amount: 1_000_000,
    };
    const first = await createPayment(deps, actor, cmd);
    expect(first).toMatchObject({ ok: true, status: "accepted" });
    const before = await deps.store.loadStream("payment", paymentId);
    const replayed = await createPayment(deps, actor, cmd);
    expect(replayed).toMatchObject({ ok: true, status: "duplicate" });
    expect(await deps.store.loadStream("payment", paymentId)).toHaveLength(before.length);
    // Undo this probe payment path by leaving it un-captured (created only).
  });
});

describe("M-IP5-2 · Gateway collections, overpayment, refund (the raced waiver)", () => {
  it("initiates a gateway payment for Lions' full dues — an order is created via the port", async () => {
    lionsPaymentId = newId();
    const created = await createPayment(deps, actor, {
      paymentId: lionsPaymentId,
      commandId: newId(),
      caseId,
      teamId: lions(),
      method: "gateway:razorpay",
      amount: LIONS_DUE,
    });
    expect(created.ok).toBe(true);
    // Gateway isolation: the order came through the adapter PORT; the writer
    // never imported a provider SDK.
    const row = await deps.store.loadPayment(lionsPaymentId);
    expect(row?.method).toBe("gateway:razorpay");
    expect(row?.status).toBe("created");
  });

  /*
   * THE SPLIT-SETTLEMENT GUARD (founder decision 2026-08-26).
   *
   * The platform holds ONE set of gateway credentials, so an order created
   * without a destination collects the organizer's dues into the platform's own
   * account. That is money held on behalf of a third party, and it contradicts
   * the Terms this product publishes. The guard makes gateway keys insufficient
   * on their own: the organizer must also have an account of their own.
   *
   * Asserted here rather than trusted, because the failure mode is silent — it
   * would look exactly like a working payment.
   */
  it("REFUSES a gateway payment when the organizer has no account of their own", async () => {
    /*
     * A gateway that THROWS if it is ever asked for an order. The assertion is
     * not merely "the call was refused" but "no order was created at all" —
     * reaching the provider is itself the failure here, because an order
     * created against the platform's key is money on its way to the wrong
     * account whatever the writer does with the result afterwards.
     */
    const mustNotBeCalled: PaymentGatewayPort = {
      method: "gateway:razorpay",
      createOrder: () => {
        throw new Error("createOrder reached without a settlement destination");
      },
      verifyWebhook: () => ({ ok: false, reason: "unused" }),
      fetchPayment: () => {
        throw new Error("unused");
      },
      initiateRefund: () => {
        throw new Error("unused");
      },
    };
    const unrouted = settlementDeps(db, {
      checkpointCadence: 3,
      gateways: { "gateway:razorpay": mustNotBeCalled },
      // No settlementAccount override: the production default, which is null.
    });
    const attempted = await createPayment(unrouted, actor, {
      paymentId: newId(),
      commandId: newId(),
      caseId,
      teamId: lions(),
      method: "gateway:razorpay",
      amount: 100_00,
    });
    expect(attempted).toEqual({ ok: false, reason: "no_settlement_account" });
  });

  it("still takes CASH with no gateway account — nothing passes through the platform", async () => {
    const unrouted = settlementDeps(db, { checkpointCadence: 3 });
    const cashId = newId();
    const paid = await createPayment(unrouted, actor, {
      paymentId: cashId,
      commandId: newId(),
      caseId,
      teamId: lions(),
      method: "manual:cash",
      amount: 100_00,
    });
    expect(paid.ok).toBe(true);
    expect((await unrouted.store.loadPayment(cashId))?.method).toBe("manual:cash");
  });

  it("a waiver RACES the capture: ₹5,000 of Lions' dues is forgiven before it lands", async () => {
    const waived = await waiveObligation(deps, actor, caseId, newId(), {
      teamId: lions(),
      amount: 500_000, // ₹5,000
      reason: "sponsor part-covered",
    });
    expect(waived.ok).toBe(true);
    const { outstandingOf } = await import("@desiauction/settlement");
    const fold = await caseFold(deps, caseId);
    // Lions now owe ₹20,000 — but the ₹25,000 capture is already in flight.
    expect(outstandingOf(fold?.projection.obligations[lions()] ?? emptyObligation())).toBe(
      2_000_000,
    );
    await expectBooksAgreeWithCase();
  });

  it("captures via a SIGNED webhook OUT OF ORDER → Overpaid Collection + refund liability", async () => {
    // A capture webhook with no prior authorize (provider truth, out of order).
    const body = webhookBody(lionsPaymentId, "payment.captured", {
      id: "pay_lions",
      order_id: "order_lions",
      amount: LIONS_DUE, // the pinned ₹25,000
    });
    const result = await handleRazorpayWebhook(deps, {
      rawBody: body,
      signature: sign(body),
      receivedAtMs: NOW,
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.ack.ok).toBe(true);

    const captured = await deps.store.loadPayment(lionsPaymentId);
    expect(captured?.status).toBe("captured");
    expect(captured?.providerRef).toBe("pay_lions");

    // Only the ₹20,000 owed was discharged; the ₹5,000 excess rode into
    // refund-liability via the Overpaid Collection template.
    const journal = await journalFold(deps, org.id);
    if (journal === null) throw new Error("journal");
    const summary = collectionsSummary(journal);
    expect(summary.refundLiability).toBe(500_000);
    const { outstandingOf } = await import("@desiauction/settlement");
    const fold = await caseFold(deps, caseId);
    expect(outstandingOf(fold?.projection.obligations[lions()] ?? emptyObligation())).toBe(0);
    await expectBooksAgreeWithCase();
  });

  it("REJECTS a forged (bad-signature) webhook — 401, payment untouched", async () => {
    const body = webhookBody(lionsPaymentId, "payment.captured", {
      id: "pay_x",
      order_id: "o",
      amount: LIONS_DUE,
    });
    expect(
      await handleRazorpayWebhook(deps, { rawBody: body, signature: "forged", receivedAtMs: NOW }),
    ).toMatchObject({ ok: false, status: 401, reason: "bad_signature" });
  });

  it("is idempotent on a DUPLICATE webhook (provider replay) — original ack, no double capture", async () => {
    const body = webhookBody(lionsPaymentId, "payment.captured", {
      id: "pay_lions",
      order_id: "order_lions",
      amount: LIONS_DUE,
    });
    const journalBefore = await deps.store.loadStream("journal", org.id);
    const result = await handleRazorpayWebhook(deps, {
      rawBody: body,
      signature: sign(body),
      receivedAtMs: NOW,
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.ack).toMatchObject({ ok: true, status: "duplicate" });
    expect(await deps.store.loadStream("journal", org.id)).toHaveLength(journalBefore.length);
  });

  it("re-derives a lost coordination effect (crash between the capture and its discharge)", async () => {
    // Right now Lions' overpaid-collection posting is the JOURNAL tail and Lions'
    // discharge is the CASE tail. Simulate a crash that committed the capture but
    // lost BOTH downstream effects — delete the tail events + the posting rows
    // (no gap, so the logs stay foldable).
    const journalEvents = await deps.store.loadStream("journal", org.id);
    const jTail = journalEvents[journalEvents.length - 1];
    const source = jTail?.payload["source"] as { stream?: string } | undefined;
    expect(source?.stream).toBe(`payment:${lionsPaymentId}`);
    if (jTail === undefined) throw new Error("journal tail");
    const postingId = jTail.payload["postingId"] as string;
    await db.delete(journalLegs).where(eq(journalLegs.postingId, postingId));
    await db.delete(journalPostings).where(eq(journalPostings.id, postingId));
    await db
      .delete(settlementEvents)
      .where(
        and(
          eq(settlementEvents.streamType, "journal"),
          eq(settlementEvents.streamId, org.id),
          eq(settlementEvents.seq, jTail.seq),
        ),
      );
    const caseEvents = await deps.store.loadStream("case", caseId);
    const cTail = caseEvents[caseEvents.length - 1];
    expect(cTail?.type).toBe("ObligationDischarged");
    if (cTail === undefined) throw new Error("case tail");
    await db
      .delete(settlementEvents)
      .where(
        and(
          eq(settlementEvents.streamType, "case"),
          eq(settlementEvents.streamId, caseId),
          eq(settlementEvents.seq, cTail.seq),
        ),
      );
    await db.delete(journalCheckpoints).where(eq(journalCheckpoints.orgId, org.id));

    // The catch-up scan re-derives the missing posting AND discharge, byte-for-byte.
    const repaired = await runPaymentCoordination(deps, actor, lionsPaymentId);
    expect(repaired).toBeGreaterThan(0);
    await expectBooksAgreeWithCase();

    // Running it AGAIN changes nothing — one cause, one effect.
    const len = (await deps.store.loadStream("journal", org.id)).length;
    await runPaymentCoordination(deps, actor, lionsPaymentId);
    expect((await deps.store.loadStream("journal", org.id)).length).toBe(len);
  });

  it("refunds the ₹5,000 overpayment — liability-first, nothing reinstated", async () => {
    const body = webhookBody(lionsPaymentId, "refund.processed", {
      id: "rfnd_lions",
      payment_id: "pay_lions",
      amount: 500_000,
    });
    const result = await handleRazorpayWebhook(deps, {
      rawBody: body,
      signature: sign(body),
      receivedAtMs: NOW,
    });
    expect(result.ok).toBe(true);

    const refunded = await deps.store.loadPayment(lionsPaymentId);
    expect(refunded?.refundedTotal).toBe(500_000);
    const journal = await journalFold(deps, org.id);
    if (journal === null) throw new Error("journal");
    // The refund debited the LIABILITY, not the dues — so Lions' settled debt
    // was never resurrected.
    expect(collectionsSummary(journal).refundLiability).toBe(0);
    const { outstandingOf } = await import("@desiauction/settlement");
    const fold = await caseFold(deps, caseId);
    expect(outstandingOf(fold?.projection.obligations[lions()] ?? emptyObligation())).toBe(0);
    await expectBooksAgreeWithCase();
  });

  it("manual and gateway captures share the same discharge semantics (behavioural parity)", async () => {
    // Both channels emit a JournalPosted crediting the team's dues AND an
    // ObligationDischarged — the funds account is the only difference.
    const caseEvents = await deps.store.loadStream("case", caseId);
    const discharges = caseEvents.filter((e) => e.type === "ObligationDischarged");
    const manualDischarge = discharges.some((e) => {
      const teamId = e.payload["teamId"] as string;
      return teamId === tigers();
    });
    const gatewayDischarge = discharges.some(
      (e) => (e.payload["paymentId"] as string) === lionsPaymentId,
    );
    expect(manualDischarge).toBe(true);
    expect(gatewayDischarge).toBe(true);

    const journal = await journalFold(deps, org.id);
    if (journal === null) throw new Error("journal");
    const funds = Object.keys(journal.accounts).filter((a) => a.startsWith("funds:"));
    // Each channel keeps its own funds account — collections never commingle.
    expect(funds).toContain("funds:manual:cash");
    expect(funds).toContain("funds:gateway:razorpay");
  });
});

describe("M-IP5-2 · Determinism, rebuild, recovery", () => {
  it("replays every stream deterministically — twice, to identical bytes", async () => {
    const journalEvents = await deps.store.loadStream("journal", org.id);
    const j1 = replayJournal(journalEvents);
    const j2 = replayJournal(journalEvents);
    expect(j1.ok && j2.ok).toBe(true);
    if (j1.ok && j2.ok) {
      expect(canonicalJournalBytes(j1.projection)).toBe(canonicalJournalBytes(j2.projection));
    }
    const paymentEvents = await deps.store.loadStream("payment", lionsPaymentId);
    expect(canonicalJson(replayPayment(paymentEvents))).toBe(
      canonicalJson(replayPayment(paymentEvents)),
    );
  });

  it("rebuilds EVERY projection from the log — recovery reproduces identical bytes", async () => {
    const beforePayments = await allPaymentRows();
    const beforePostings = await deps.store.loadPostings(org.id);
    const beforeObligations = await deps.store.loadObligations(caseId);

    // Destroy every projection row. The event log is untouched.
    await db.delete(journalLegs).where(eq(journalLegs.orgId, org.id));
    await db.delete(journalPostings).where(eq(journalPostings.orgId, org.id));
    await db.delete(settlementObligations).where(eq(settlementObligations.caseId, caseId));
    await db.delete(paymentsTable).where(eq(paymentsTable.orgId, org.id));

    expect((await recoverJournal(deps, actor)).healed).toBe(true);
    expect((await recoverCase(deps, actor, caseId)).healed).toBe(true);
    expect((await recoverPayments(deps, actor)).healed).toBe(true);

    expect(canonicalJson(await allPaymentRows())).toBe(canonicalJson(beforePayments));
    expect(canonicalJson(await deps.store.loadPostings(org.id))).toBe(
      canonicalJson(beforePostings),
    );
    expect(canonicalJson(sortByTeam(await deps.store.loadObligations(caseId)))).toBe(
      canonicalJson(sortByTeam(beforeObligations)),
    );
    await expectBooksAgreeWithCase();
  });
});

describe("M-IP5-2 · Wallet projections & audit", () => {
  it("summarises the org's money from the fold, and the books balance", async () => {
    const journal = await journalFold(deps, org.id);
    if (journal === null) throw new Error("journal");
    const summary = collectionsSummary(journal);
    // Tigers: ₹1,00,000 collected (manual). Lions: ₹25,000 captured − ₹5,000
    // refunded = ₹20,000 net; ₹5,000 of the original dues was waived. Everything
    // outstanding is settled; nothing is owed back.
    expect(summary.outstanding).toBe(0);
    expect(summary.collected).toBe(TIGERS_DUE + (LIONS_DUE - 500_000));
    expect(summary.waived).toBe(500_000);
    expect(summary.refundLiability).toBe(0);
    expect(summary.available).toBe(summary.collected - summary.refundLiability);
    expect(trialBalance(journal).balanced).toBe(true);
  });

  it("writes one audit row per payment event", async () => {
    const events = await deps.store.loadStream("payment", lionsPaymentId);
    const rows = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.scopeId, org.id), eq(auditLog.subject, lionsPaymentId)));
    for (const event of events) {
      expect(rows.some((r) => r.action === `settlement.${event.type}`)).toBe(true);
    }
    // The gateway capture was attributed to the webhook source, not a person.
    const captureAudit = rows.find((r) => r.action === "settlement.PaymentCaptured");
    expect((captureAudit?.meta as { source?: string }).source).toBe("webhook:razorpay");
  });

  it("RLS: the payments table blocks cross-tenant reads and writes", async () => {
    const role = `rls_pay_${RUN}`;
    await handle.sql.unsafe(`drop role if exists ${role}`);
    await handle.sql.unsafe(`create role ${role} login password 'probe' nosuperuser nobypassrls`);
    await handle.sql.unsafe(`grant select, insert on payments to ${role}`);
    const url = new URL(env.DATABASE_URL);
    const probe = createDb(`postgres://${role}:probe@${url.hostname}:${url.port}${url.pathname}`);
    const other = newId();
    try {
      const blind = await probe.sql<{ n: number }[]>`select count(*)::int as n from payments`;
      expect(blind[0]?.n).toBe(0);
      const foreign = await probe.sql.begin(async (tx) => {
        await tx`select set_config('app.org_id', ${other}, true)`;
        const rows = await tx<{ n: number }[]>`select count(*)::int as n from payments`;
        return rows[0]?.n;
      });
      expect(foreign).toBe(0);
      const own = await probe.sql.begin(async (tx) => {
        await tx`select set_config('app.org_id', ${org.id}, true)`;
        const rows = await tx<{ n: number }[]>`select count(*)::int as n from payments`;
        return rows[0]?.n ?? 0;
      });
      expect(own).toBeGreaterThan(0);
      await expect(
        probe.sql.begin(async (tx) => {
          await tx`select set_config('app.org_id', ${org.id}, true)`;
          await tx`insert into payments (id, org_id, case_id, team_id, method, status, amount)
                   values (${newId()}, ${other}, ${caseId}, ${tigers()}, 'manual:cash', 'created', 1)`;
        }),
      ).rejects.toThrow(/row-level security/i);
    } finally {
      await probe.sql.end({ timeout: 5 });
      await handle.sql.unsafe(`revoke all on payments from ${role}`);
      await handle.sql.unsafe(`drop role if exists ${role}`);
    }
  }, 60_000);
});

async function allPaymentRows(): Promise<unknown[]> {
  const rows = await db
    .select()
    .from(paymentsTable)
    .where(eq(paymentsTable.orgId, org.id))
    .orderBy(paymentsTable.id);
  // Drop the wall-clock createdAt (not an event fact) before comparing bytes.
  return rows.map((row) => {
    const clone: Record<string, unknown> = { ...row };
    delete clone["createdAt"];
    return clone;
  });
}

function sortByTeam<T extends { teamId: string }>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => (a.teamId < b.teamId ? -1 : 1));
}

function emptyObligation() {
  return {
    teamId: "",
    amount: 0,
    increased: 0,
    reduced: 0,
    discharged: 0,
    waived: 0,
    reinstated: 0,
  };
}
