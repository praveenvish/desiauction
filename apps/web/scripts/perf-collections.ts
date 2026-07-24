// Collections performance harness (M-IP5-2). Conducts a real auction, opens a
// settling case with a large declared (fixed-basis) obligation, then measures
// the hot collections paths with real timings (median · p95 · worst over N runs)
// and cleans up after itself. Rerunnable evidence for the freeze PERFORMANCE
// record: `pnpm --filter @desiauction/web perf:collections`.
import { createHmac } from "node:crypto";
import { performance } from "node:perf_hooks";

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
  competitions,
  createDb,
  grants,
  journalCheckpoints,
  journalLegs,
  journalPostings,
  newId,
  organizations,
  orgMembers,
  payments as paymentsTable,
  people,
  registrations,
  settlementCases,
  settlementEvents,
  settlementObligations,
  teams,
} from "@desiauction/db";
import { collectionsSummary, replayJournal } from "@desiauction/settlement";
import { eq, inArray } from "drizzle-orm";

import { auctionReady } from "../src/server/auction/auction-ready.js";
import {
  createRazorpayAdapter,
  type HttpTransport,
} from "../src/server/settlement/adapters/razorpay.js";
import { settlementDeps } from "../src/server/settlement/deps.js";
import { recoverCase, recoverJournal, recoverPayments } from "../src/server/settlement/recovery.js";
import { handleRazorpayWebhook } from "../src/server/settlement/webhook.js";
import {
  attestManualCapture,
  computeCaseObligations,
  createPayment,
  journalFold,
  openCase,
  verifyCase,
  type SettlementActor,
} from "../src/server/settlement/writer.js";

const DATABASE_URL = process.env["DATABASE_URL"];
if (DATABASE_URL === undefined) {
  throw new Error("DATABASE_URL is required (run via pnpm perf:collections)");
}
const handle = createDb(DATABASE_URL);
const db = handle.db;

const RUN = String(Date.now()).slice(-7);
const WEBHOOK_SECRET = "whsec_perf";
const NOW = 1_700_000_000_000;
const FIXED_DUE = 500_000_000; // ₹50,00,000 declared — headroom for many payments

const transport: HttpTransport = (url) =>
  Promise.resolve(
    url.endsWith("/orders")
      ? { status: 200, body: JSON.stringify({ id: `order_${newId()}` }) }
      : { status: 200, body: "{}" },
  );

function sign(body: string): string {
  return createHmac("sha256", WEBHOOK_SECRET).update(body).digest("hex");
}

function report(name: string, samples: number[]): void {
  const sorted = [...samples].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
  const p95 = sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)] ?? 0;
  const worst = sorted[sorted.length - 1] ?? 0;
  console.log(
    `${name.padEnd(42)} median ${median.toFixed(2).padStart(7)} · p95 ${p95.toFixed(2).padStart(7)} · worst ${worst.toFixed(2).padStart(7)} ms · n=${String(samples.length)}`,
  );
}

async function main(): Promise<void> {
  const owner = newId();
  const orgId = newId();
  await db.insert(people).values({ id: owner, phone: `+9190perf${RUN}`, name: "Perf Owner" });
  await db
    .insert(organizations)
    .values({ id: orgId, name: `Perf ${RUN}`, slug: `perf-coll-${RUN}`, createdBy: owner });
  await db.insert(orgMembers).values({ orgId, personId: owner });
  await db.insert(grants).values({
    id: newId(),
    personId: owner,
    scopeType: "org",
    scopeId: orgId,
    capabilitySet: "org:owner",
    grantedBy: owner,
  });
  await db.insert(grants).values({
    id: newId(),
    personId: owner,
    scopeType: "org",
    scopeId: orgId,
    capabilitySet: "settlement:controller",
    grantedBy: owner,
  });

  const compId = newId();
  await db.insert(competitions).values({
    id: compId,
    orgId,
    tournamentId: null,
    name: `Perf Season ${RUN}`,
    slug: `perf-season-${RUN}`,
    status: "registration_closed",
    visibility: "private" as const,
    location: "Local",
    startsOn: "2026-01-01",
    endsOn: "2026-12-31",
    createdBy: owner,
  });
  const teamIds = [newId(), newId()];
  await db.insert(teams).values(
    teamIds.map((id, i) => ({
      id,
      orgId,
      competitionId: compId,
      name: `Team ${String(i)} ${RUN}`,
      createdBy: owner,
    })),
  );
  const regIds: string[] = [];
  const personIds: string[] = [owner];
  for (let i = 0; i < 3; i++) {
    const pid = newId();
    personIds.push(pid);
    await db
      .insert(people)
      .values({ id: pid, phone: `+9191perf${RUN}${String(i)}`, name: `Player ${String(i)}` });
    const rid = newId();
    regIds.push(rid);
    await db.insert(registrations).values({
      id: rid,
      orgId,
      competitionId: compId,
      personId: pid,
      role: "batter",
      status: "approved",
      registrationNumber: registrationNumber(rid),
      basePriceBand: i < 2 ? "A" : "B",
    });
  }

  const comp = {
    id: compId,
    orgId,
    tournamentId: null,
    name: `Perf Season ${RUN}`,
    slug: `perf-season-${RUN}`,
    status: "registration_closed" as const,
    visibility: "private" as const,
    location: "Local",
    startsOn: "2026-01-01",
    endsOn: "2026-12-31",
  };
  const ready = await auctionReady(db, comp);
  const created = await createAuction(db, comp, ready, owner, DEFAULT_AUCTION_CONFIG);
  if (!created.ok) throw new Error(`createAuction: ${created.reason}`);
  let auction = (await auctionOf(db, compId)) as AuctionRecord;
  const paddles: string[] = [];
  for (const teamId of teamIds) {
    const issued = await issuePaddle(db, auction, owner, teamId, owner);
    if (!issued.ok) throw new Error("paddle");
    paddles.push(issued.paddleId);
  }
  await queueAllLots(db, auction, owner);
  await transitionAuction(db, auction, owner, "open");
  auction = (await auctionOf(db, compId)) as AuctionRecord;
  const view = await auctionView(db, auction);
  // Bid each lot's own base: lot seq derives from same-millisecond ULIDs, so
  // queue position does not track registration band — a fixed band-by-position
  // amount intermittently lands under an A-band base (PVP-1 D3). Obligations
  // below use a fixed basis, so sale amounts only need to be valid bids.
  const sales = [
    { player: view.lots[0]?.playerName, paddle: paddles[0], amount: view.lots[0]?.basePrice ?? 0 },
    { player: view.lots[1]?.playerName, paddle: paddles[0], amount: view.lots[1]?.basePrice ?? 0 },
    { player: view.lots[2]?.playerName, paddle: paddles[1], amount: view.lots[2]?.basePrice ?? 0 },
  ];
  for (const sale of sales) {
    const lot = view.lots.find((l) => l.playerName === sale.player);
    if (lot === undefined) throw new Error("lot");
    const opened = await transitionLot(db, auction, lot.id, owner, "open");
    if (!opened.ok) throw new Error(`lot open: ${opened.reason}`);
    const bid = await placeBid(db, auction, owner, {
      lotId: lot.id,
      paddleId: sale.paddle ?? "",
      amountRaw: sale.amount,
      bidderAuthorized: true,
    });
    if (!bid.ok) throw new Error(`bid: ${bid.code}`);
    const sold = await transitionLot(db, auction, lot.id, owner, "sell");
    if (!sold.ok) throw new Error(`sell: ${sold.reason}`);
  }
  const completed = await transitionAuction(db, auction, owner, "complete");
  if (!completed.ok) throw new Error(`complete: ${completed.reason}`);

  const razorpay = createRazorpayAdapter({
    keyId: "k",
    keySecret: "s",
    webhookSecret: WEBHOOK_SECRET,
    transport,
  });
  const deps = settlementDeps(db, { gateways: { "gateway:razorpay": razorpay } });
  const actor: SettlementActor = {
    personId: owner,
    orgId,
    grants: [
      { scopeType: "org", scopeId: orgId, capabilitySet: "settlement:controller", revokedAt: null },
    ],
  };

  // A large fixed obligation on team 0 → room for hundreds of payments.
  const opened = await openCase(deps, actor, {
    commandId: newId(),
    auctionId: auction.id,
    basis: "fixed",
    fixed: { [teamIds[0] ?? ""]: FIXED_DUE },
  });
  if (!opened.ok) throw new Error(`open: ${opened.reason}`);
  const caseId = opened.caseId;
  await verifyCase(deps, actor, caseId, newId());
  await computeCaseObligations(deps, actor, caseId, newId());

  // --- Benchmarks --------------------------------------------------------------
  const N = 60;

  // 1 · Payment creation (manual, uncaptured — initiation only).
  const creation: number[] = [];
  const createdManual: string[] = [];
  for (let i = 0; i < N; i++) {
    const pid = newId();
    const t = performance.now();
    const ack = await createPayment(deps, actor, {
      paymentId: pid,
      commandId: newId(),
      caseId,
      teamId: teamIds[0] ?? "",
      method: "manual:cash",
      amount: 100_000,
    });
    creation.push(performance.now() - t);
    if (ack.ok) createdManual.push(pid);
  }
  report("payment creation (manual initiate)", creation);

  // 2 · Journal posting via manual attest (capture → Collection posting + discharge).
  const posting: number[] = [];
  for (const pid of createdManual) {
    const t = performance.now();
    await attestManualCapture(deps, actor, pid, newId(), { attestedBy: owner });
    posting.push(performance.now() - t);
  }
  report("journal posting (manual capture+discharge)", posting);

  // 3 · Webhook processing (gateway create + signed capture).
  const gatewayIds: string[] = [];
  for (let i = 0; i < N; i++) {
    const pid = newId();
    const ack = await createPayment(deps, actor, {
      paymentId: pid,
      commandId: newId(),
      caseId,
      teamId: teamIds[0] ?? "",
      method: "gateway:razorpay",
      amount: 100_000,
    });
    if (ack.ok) gatewayIds.push(pid);
  }
  const webhook: number[] = [];
  for (const pid of gatewayIds) {
    const body = JSON.stringify({
      event: "payment.captured",
      created_at: Math.floor(NOW / 1000),
      payload: {
        payment: {
          entity: {
            id: `pay_${pid}`,
            order_id: `order_${pid}`,
            amount: 100_000,
            currency: "INR",
            notes: { paymentId: pid, orgId },
          },
        },
      },
    });
    const t = performance.now();
    await handleRazorpayWebhook(deps, { rawBody: body, signature: sign(body), receivedAtMs: NOW });
    webhook.push(performance.now() - t);
  }
  report("webhook processing (capture ingress)", webhook);

  // The stream is now substantial (≈ 2N captures + postings + discharges).
  const eventCount = (await deps.store.loadStream("journal", orgId)).length;

  // 4 · Wallet rebuild (fold + summary).
  const wallet: number[] = [];
  for (let i = 0; i < 30; i++) {
    const t = performance.now();
    const journal = await journalFold(deps, orgId);
    if (journal !== null) collectionsSummary(journal);
    wallet.push(performance.now() - t);
  }
  report(`wallet rebuild (@${String(eventCount)} journal events)`, wallet);

  // 5 · Replay (genesis journal fold).
  const events = await deps.store.loadStream("journal", orgId);
  const replay: number[] = [];
  for (let i = 0; i < 30; i++) {
    const t = performance.now();
    replayJournal(events);
    replay.push(performance.now() - t);
  }
  report(`replay (genesis journal fold @${String(eventCount)})`, replay);

  // 6 · Projection rebuild + recovery (destroy every row, rebuild from the log).
  const recovery: number[] = [];
  for (let i = 0; i < 15; i++) {
    await db.delete(journalLegs).where(eq(journalLegs.orgId, orgId));
    await db.delete(journalPostings).where(eq(journalPostings.orgId, orgId));
    await db.delete(settlementObligations).where(eq(settlementObligations.caseId, caseId));
    await db.delete(paymentsTable).where(eq(paymentsTable.orgId, orgId));
    const t = performance.now();
    await recoverJournal(deps, actor);
    await recoverCase(deps, actor, caseId);
    await recoverPayments(deps, actor);
    recovery.push(performance.now() - t);
  }
  report("projection rebuild + recovery (whole org)", recovery);

  // --- Cleanup -----------------------------------------------------------------
  await db.delete(paymentsTable).where(eq(paymentsTable.orgId, orgId));
  await db.delete(journalLegs).where(eq(journalLegs.orgId, orgId));
  await db.delete(journalPostings).where(eq(journalPostings.orgId, orgId));
  await db.delete(journalCheckpoints).where(eq(journalCheckpoints.orgId, orgId));
  await db.delete(settlementObligations).where(eq(settlementObligations.caseId, caseId));
  await db.delete(settlementEvents).where(eq(settlementEvents.orgId, orgId));
  await db.delete(settlementCases).where(eq(settlementCases.orgId, orgId));
  await db.delete(auditLog).where(eq(auditLog.scopeId, orgId));
  await db.delete(grants).where(eq(grants.scopeId, orgId));
  const {
    auctionEvents,
    bids,
    lots,
    paddles: paddlesT,
    auctions,
  } = await import("@desiauction/db");
  await db.delete(auctionEvents).where(eq(auctionEvents.orgId, orgId));
  await db.delete(bids).where(eq(bids.orgId, orgId));
  await db.delete(lots).where(eq(lots.orgId, orgId));
  await db.delete(paddlesT).where(eq(paddlesT.orgId, orgId));
  await db.delete(auctions).where(eq(auctions.orgId, orgId));
  await db.delete(registrations).where(inArray(registrations.id, regIds));
  await db.delete(teams).where(inArray(teams.id, teamIds));
  await db.delete(competitions).where(eq(competitions.id, compId));
  await db.delete(orgMembers).where(eq(orgMembers.orgId, orgId));
  await db.delete(organizations).where(eq(organizations.id, orgId));
  await db.delete(people).where(inArray(people.id, personIds));
  await handle.sql.end({ timeout: 5 });
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
