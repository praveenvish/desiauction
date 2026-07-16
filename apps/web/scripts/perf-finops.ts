// Financial-operations performance harness (IP-6 freeze). Conducts a real
// auction, opens a settling fixed-basis case with headroom for many payments,
// then measures every hot financial-operations path with real timings
// (median · p95 · worst over N runs) and cleans up after itself. Rerunnable
// evidence for the freeze PERFORMANCE record:
// `pnpm --filter @desiauction/web perf:finops`.
import { performance } from "node:perf_hooks";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

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
import { endedFiscalYearFor, fiscalYearBounds } from "@desiauction/financial-operations";
import {
  attestDay,
  certifyOperations,
  closePeriod,
  declareProfile,
  finopsDeps,
  issueInvoice,
  issueReceipt,
  openPeriod,
  openSeries,
  reproduceDocument,
  reproduceFiscalEvidence,
  requestDispatch,
  requestExport,
  rewindFollower,
  runDispatchSend,
  runExportGenerate,
  runFollower,
  superviseOperations,
  type FinopsActor,
} from "@desiauction/financial-operations/server";
import { eq, inArray, like } from "drizzle-orm";

import { auctionReady } from "../src/server/auction/auction-ready.js";
import { settlementDeps } from "../src/server/settlement/deps.js";
import {
  attestManualCapture,
  createPayment,
  computeCaseObligations,
  openCase,
  verifyCase,
  type SettlementActor,
} from "../src/server/settlement/writer.js";

const DATABASE_URL = process.env["DATABASE_URL"];
if (DATABASE_URL === undefined) {
  throw new Error("DATABASE_URL is required (run via pnpm perf:finops)");
}
const handle = createDb(DATABASE_URL);
const db = handle.db;

const RUN = String(Date.now()).slice(-7);
const STORAGE_DIR = join(tmpdir(), `finops-perf-${RUN}`);
const FIXED_DUE = 500_000_000; // ₹50,00,000 declared — headroom for many payments
const RECEIPTS = 30;
const PAYMENT_AMOUNT = 100_000;

function report(name: string, samples: number[]): void {
  const sorted = [...samples].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
  const p95 = sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)] ?? 0;
  const worst = sorted[sorted.length - 1] ?? 0;
  console.log(
    `${name.padEnd(46)} median ${median.toFixed(2).padStart(7)} · p95 ${p95.toFixed(2).padStart(7)} · worst ${worst.toFixed(2).padStart(7)} ms · n=${String(samples.length)}`,
  );
}

async function timed(samples: number[], fn: () => Promise<unknown>): Promise<void> {
  const start = performance.now();
  const result = (await fn()) as { ok?: boolean } | undefined;
  samples.push(performance.now() - start);
  if (result !== undefined && result.ok === false) {
    throw new Error(`perf step failed: ${JSON.stringify(result)}`);
  }
}

async function main(): Promise<void> {
  const owner = newId();
  const orgId = newId();
  await db.insert(people).values({ id: owner, phone: `+9189perf${RUN}`, name: "Perf Owner" });
  await db
    .insert(organizations)
    .values({ id: orgId, name: `Perf ${RUN}`, slug: `perf-finops-${RUN}`, createdBy: owner });
  await db.insert(orgMembers).values({ orgId, personId: owner });
  for (const capabilitySet of ["org:owner", "settlement:controller", "finops:controller"]) {
    await db.insert(grants).values({
      id: newId(),
      personId: owner,
      scopeType: "org",
      scopeId: orgId,
      capabilitySet,
      grantedBy: owner,
    });
  }

  const compId = newId();
  await db.insert(competitions).values({
    id: compId,
    orgId,
    name: `Perf Season ${RUN}`,
    slug: `perf-finops-season-${RUN}`,
    status: "registration_closed",
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
  for (let i = 0; i < 3; i++) {
    const pid = newId();
    await db
      .insert(people)
      .values({ id: pid, phone: `+9188perf${RUN}${String(i)}`, name: `Player ${String(i)}` });
    const rid = newId();
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
    name: `Perf Season ${RUN}`,
    slug: `perf-finops-season-${RUN}`,
    status: "registration_closed" as const,
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
  for (const [i, lot] of view.lots.entries()) {
    const opened = await transitionLot(db, auction, lot.id, owner, "open");
    if (!opened.ok) throw new Error("lot open");
    // The first bid on a lot may be the base itself — band-safe on the ladder.
    const bid = await placeBid(db, auction, owner, {
      lotId: lot.id,
      paddleId: (i < 2 ? paddles[0] : paddles[1]) ?? "",
      amountRaw: lot.basePrice,
      bidderAuthorized: true,
    });
    if (!bid.ok) throw new Error(`bid: ${bid.code}`);
    const sold = await transitionLot(db, auction, lot.id, owner, "sell");
    if (!sold.ok) throw new Error("sell");
  }
  const completed = await transitionAuction(db, auction, owner, "complete");
  if (!completed.ok) throw new Error("complete");

  const sdeps = settlementDeps(db);
  const sactor: SettlementActor = {
    personId: owner,
    orgId,
    grants: [
      { scopeType: "org", scopeId: orgId, capabilitySet: "settlement:controller", revokedAt: null },
    ],
  };
  const opened = await openCase(sdeps, sactor, {
    commandId: newId(),
    auctionId: auction.id,
    basis: "fixed",
    fixed: { [teamIds[0] ?? ""]: FIXED_DUE, [teamIds[1] ?? ""]: FIXED_DUE },
  });
  if (!opened.ok) throw new Error(`openCase: ${opened.reason}`);
  const caseId = opened.caseId;
  if (!(await verifyCase(sdeps, sactor, caseId, newId())).ok) throw new Error("verify");
  if (!(await computeCaseObligations(sdeps, sactor, caseId, newId())).ok)
    throw new Error("compute");

  // N captured payments — the receipt corpus.
  const paymentIds: string[] = [];
  for (let i = 0; i < RECEIPTS; i++) {
    const paymentId = newId();
    paymentIds.push(paymentId);
    const createdPayment = await createPayment(sdeps, sactor, {
      paymentId,
      commandId: newId(),
      caseId,
      teamId: teamIds[i % 2] ?? "",
      method: "manual:cash",
      amount: PAYMENT_AMOUNT,
    });
    if (!createdPayment.ok) throw new Error(`createPayment: ${createdPayment.reason}`);
    const capturedPayment = await attestManualCapture(sdeps, sactor, paymentId, newId(), {
      attestedBy: owner,
      evidenceRef: `perf-${String(i)}`,
    });
    if (!capturedPayment.ok) throw new Error("attest");
  }

  const deps = finopsDeps(db, { storageDir: STORAGE_DIR });
  const actor: FinopsActor = {
    personId: owner,
    orgId,
    grants: [
      { scopeType: "org", scopeId: orgId, capabilitySet: "finops:controller", revokedAt: null },
    ],
  };
  const declared = await declareProfile(
    deps,
    actor,
    { legalName: `Perf ${RUN} Trust`, posture: "none" },
    newId(),
  );
  if (!declared.ok) throw new Error("declareProfile");

  console.log(`\nfinops performance (live PG17) · ${String(RECEIPTS)} payments · run ${RUN}\n`);

  // 1 · Follower: initial catch-up over the whole settlement history.
  const followerInitial: number[] = [];
  await timed(followerInitial, async () => runFollower(deps, orgId));
  report(
    `follower.run initial (${String((await deps.store.loadCursors(orgId)).length)} streams)`,
    followerInitial,
  );

  // 2 · Follower steady-state (nothing new).
  const followerSteady: number[] = [];
  for (let i = 0; i < 10; i++) {
    await timed(followerSteady, async () => runFollower(deps, orgId));
  }
  report("follower.run steady-state", followerSteady);

  const { fiscalYearOf, istDateOf } = await import("@desiauction/financial-operations");
  const currentFy = fiscalYearOf(istDateOf(Date.now()));
  const seriesAck = await openSeries(
    deps,
    actor,
    { kind: "receipt", fy: currentFy, prefix: "RCT" },
    newId(),
  );
  if (!seriesAck.ok) throw new Error("openSeries");
  const receiptSeries = seriesAck.streamId;
  const invoiceAck = await openSeries(
    deps,
    actor,
    { kind: "tax-invoice", fy: currentFy, prefix: "INV" },
    newId(),
  );
  if (!invoiceAck.ok) throw new Error("openSeries invoice");

  // 3 · Document issuance (fold-verify + quote + render + append + project).
  const issue: number[] = [];
  for (const paymentId of paymentIds) {
    await timed(issue, async () =>
      issueReceipt(
        deps,
        { kind: "person", actor, capability: "finops.document" },
        { seriesId: receiptSeries, paymentId },
        newId(),
      ),
    );
  }
  report(`issueReceipt (register grows 1→${String(RECEIPTS)})`, issue);

  const invoices: number[] = [];
  for (const teamId of teamIds) {
    await timed(invoices, async () =>
      issueInvoice(deps, actor, { seriesId: invoiceAck.streamId, caseId, teamId }, newId()),
    );
  }
  report("issueInvoice", invoices);

  // 4 · Reproduction (re-render from frozen sources + digest compare).
  const documents = await deps.store.loadDocuments(receiptSeries);
  const reproduce: number[] = [];
  for (const doc of documents) {
    await timed(reproduce, async () => reproduceDocument(deps, doc.docId));
  }
  report(`reproduceDocument (@${String(RECEIPTS)} docs)`, reproduce);

  // 5 · Dispatch: request + in-app send (reproduce body + 2 transitions).
  const dispatchSamples: number[] = [];
  for (const doc of documents.slice(0, 10)) {
    const requested = await requestDispatch(
      deps,
      actor,
      {
        channel: "in-app",
        recipientRef: `owner:${doc.partyId}`,
        templateId: "receipt-issued",
        templateVersion: "v1",
        subjectRef: `doc:${doc.docId}`,
      },
      newId(),
    );
    if (!requested.ok) throw new Error("requestDispatch");
    await timed(dispatchSamples, async () =>
      runDispatchSend(deps, {
        jobId: newId(),
        orgId,
        kind: "dispatch.send",
        dedupeKey: `dispatch.send:${requested.streamId}`,
        state: "leased",
        attempts: 0,
        maxAttempts: 5,
        notBeforeMs: Date.now(),
        leasedUntilMs: null,
        lastError: null,
        payload: { dispatchId: requested.streamId },
      }),
    );
  }
  report("dispatch send (in-app, reproduced body)", dispatchSamples);

  // 6 · Export generation (gather + reproduce all + build + store + verify).
  const exportSamples: number[] = [];
  for (let i = 0; i < 5; i++) {
    const requested = await requestExport(
      deps,
      actor,
      { kind: "journal-csv", params: { fy: currentFy, perf: i } },
      newId(),
    );
    if (!requested.ok) throw new Error("requestExport");
    await timed(exportSamples, async () =>
      runExportGenerate(deps, {
        jobId: newId(),
        orgId,
        kind: "export.generate",
        dedupeKey: `export.generate:${requested.streamId}`,
        state: "leased",
        attempts: 0,
        maxAttempts: 5,
        notBeforeMs: Date.now(),
        leasedUntilMs: null,
        lastError: null,
        payload: { exportId: requested.streamId },
      }),
    );
  }
  report(`export generate (journal-csv @${String(RECEIPTS + 2)} docs)`, exportSamples);

  // 7 · Fiscal: period on the ENDED year, attest, seal, reproduce evidence.
  const fy = endedFiscalYearFor(Date.now());
  const periodAck = await openPeriod(deps, actor, { fy }, newId());
  if (!periodAck.ok) throw new Error("openPeriod");
  const periodId = periodAck.streamId;
  const attest: number[] = [];
  const end = fiscalYearBounds(fy).end;
  await timed(attest, async () =>
    attestDay(
      deps,
      { kind: "person", actor, capability: "finops.operate" },
      periodId,
      { date: end, checks: [{ name: "manual-perf", outcome: "pass", detail: null }] },
      newId(),
    ),
  );
  report("attestDay (human)", attest);

  const close: number[] = [];
  await timed(close, async () => closePeriod(deps, actor, periodId, newId()));
  report(`closePeriod (seal · evidence v2 @${String(RECEIPTS + 2)} docs)`, close);

  const evidence: number[] = [];
  for (let i = 0; i < 10; i++) {
    await timed(evidence, async () => reproduceFiscalEvidence(deps, periodId));
  }
  report("reproduceFiscalEvidence", evidence);

  // 8 · Supervisor and certification (the governance hot paths).
  const supervise: number[] = [];
  for (let i = 0; i < 5; i++) {
    await timed(supervise, async () => superviseOperations(deps, orgId));
  }
  report(`superviseOperations (7 components @${String(RECEIPTS + 2)} docs)`, supervise);

  const certify: number[] = [];
  for (let i = 0; i < 3; i++) {
    await timed(certify, async () => certifyOperations(deps, orgId));
  }
  report("certifyOperations (double-derived replay)", certify);

  // 9 · Follower full rebuild (rewind → genesis re-consumption).
  const rebuild: number[] = [];
  for (let i = 0; i < 3; i++) {
    await rewindFollower(deps, orgId);
    await timed(rebuild, async () => runFollower(deps, orgId));
  }
  report("follower full rebuild (rewind → genesis)", rebuild);

  // Cleanup.
  rmSync(STORAGE_DIR, { recursive: true, force: true });
  await db.delete(finopsCursors).where(eq(finopsCursors.orgId, orgId));
  await db.delete(finopsJobs).where(eq(finopsJobs.orgId, orgId));
  await db.delete(finopsPeriodDays).where(eq(finopsPeriodDays.orgId, orgId));
  await db.delete(finopsPeriods).where(eq(finopsPeriods.orgId, orgId));
  await db.delete(finopsExports).where(eq(finopsExports.orgId, orgId));
  await db.delete(finopsDispatches).where(eq(finopsDispatches.orgId, orgId));
  await db.delete(finopsDocuments).where(eq(finopsDocuments.orgId, orgId));
  await db.delete(finopsSeries).where(eq(finopsSeries.orgId, orgId));
  await db.delete(finopsProfiles).where(eq(finopsProfiles.orgId, orgId));
  await db.delete(finopsEvents).where(eq(finopsEvents.orgId, orgId));
  await db.delete(paymentsTable).where(eq(paymentsTable.orgId, orgId));
  await db.delete(journalLegs).where(eq(journalLegs.orgId, orgId));
  await db.delete(journalPostings).where(eq(journalPostings.orgId, orgId));
  await db.delete(journalCheckpoints).where(eq(journalCheckpoints.orgId, orgId));
  await db.delete(settlementObligations).where(eq(settlementObligations.orgId, orgId));
  await db.delete(settlementEvents).where(eq(settlementEvents.orgId, orgId));
  await db.delete(settlementCases).where(eq(settlementCases.orgId, orgId));
  await db.delete(auditLog).where(eq(auditLog.scopeId, orgId));
  await db.delete(grants).where(eq(grants.scopeId, orgId));
  await db.delete(orgMembers).where(eq(orgMembers.orgId, orgId));
  // Auction-side rows (org-scoped cleanup mirrors the settlement harness).
  const {
    auctionEvents,
    auctionOwnerInvites,
    auctions,
    bids,
    lots,
    paddleGrants,
    paddles: paddlesTable,
  } = await import("@desiauction/db");
  const auctionRows = await db
    .select({ id: auctions.id })
    .from(auctions)
    .where(eq(auctions.orgId, orgId));
  const auctionIds = auctionRows.map((row) => row.id);
  if (auctionIds.length > 0) {
    await db.delete(auctionEvents).where(inArray(auctionEvents.auctionId, auctionIds));
    await db.delete(bids).where(inArray(bids.auctionId, auctionIds));
    await db.delete(lots).where(inArray(lots.auctionId, auctionIds));
    await db.delete(paddlesTable).where(inArray(paddlesTable.auctionId, auctionIds));
    await db.delete(paddleGrants).where(inArray(paddleGrants.auctionId, auctionIds));
    await db.delete(auctionOwnerInvites).where(inArray(auctionOwnerInvites.auctionId, auctionIds));
    await db.delete(auctions).where(inArray(auctions.id, auctionIds));
  }
  await db.delete(registrations).where(eq(registrations.orgId, orgId));
  await db.delete(teams).where(eq(teams.orgId, orgId));
  await db.delete(competitions).where(eq(competitions.id, compId));
  await db.delete(organizations).where(eq(organizations.id, orgId));
  await db.delete(people).where(like(people.phone, `+9189perf${RUN}%`));
  await db.delete(people).where(like(people.phone, `+9188perf${RUN}%`));

  await handle.sql.end({ timeout: 5 });
  console.log("\nperf:finops complete — all rows cleaned.\n");
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
