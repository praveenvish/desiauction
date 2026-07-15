// Closure & Ceremony performance harness (M-IP5-3). Conducts a real auction,
// collects it to zero outstanding, then measures the hot closure paths with real
// timings (median · p95 · worst over N runs) and cleans up after itself.
// Rerunnable evidence: `pnpm --filter @desiauction/web perf:closure`.
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
import { eq, inArray } from "drizzle-orm";

import { auctionReady } from "../src/server/auction/auction-ready.js";
import { closureCeremony, reproduceClosureEvidence } from "../src/server/settlement/ceremony.js";
import { settlementDeps } from "../src/server/settlement/deps.js";
import { recoverCase } from "../src/server/settlement/recovery.js";
import {
  attestManualCapture,
  caseFold,
  closeCase,
  computeCaseObligations,
  createPayment,
  openCase,
  readyForClosure,
  reopenCase,
  settleCase,
  verifyCase,
  type SettlementActor,
} from "../src/server/settlement/writer.js";

const DATABASE_URL = process.env["DATABASE_URL"];
if (DATABASE_URL === undefined) {
  throw new Error("DATABASE_URL is required (run via pnpm perf:closure)");
}
const handle = createDb(DATABASE_URL);
const db = handle.db;
const RUN = String(Date.now()).slice(-7);

function report(name: string, samples: number[]): void {
  const sorted = [...samples].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
  const p95 = sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)] ?? 0;
  const worst = sorted[sorted.length - 1] ?? 0;
  console.log(
    `${name.padEnd(34)} median ${median.toFixed(2).padStart(7)} · p95 ${p95.toFixed(2).padStart(7)} · worst ${worst.toFixed(2).padStart(7)} ms · n=${String(samples.length)}`,
  );
}

async function measure(name: string, runs: number, fn: () => Promise<void>): Promise<void> {
  const samples: number[] = [];
  for (let i = 0; i < runs; i++) {
    const t = performance.now();
    await fn();
    samples.push(performance.now() - t);
  }
  report(name, samples);
}

async function main(): Promise<void> {
  const owner = newId();
  const orgId = newId();
  await db.insert(people).values({ id: owner, phone: `+9190close${RUN}`, name: "Perf Owner" });
  await db
    .insert(organizations)
    .values({ id: orgId, name: `Perf ${RUN}`, slug: `perf-close-${RUN}`, createdBy: owner });
  await db.insert(orgMembers).values({ orgId, personId: owner });
  for (const set of ["org:owner", "settlement:controller"]) {
    await db.insert(grants).values({
      id: newId(),
      personId: owner,
      scopeType: "org",
      scopeId: orgId,
      capabilitySet: set,
      grantedBy: owner,
    });
  }

  const compId = newId();
  await db.insert(competitions).values({
    id: compId,
    orgId,
    name: `Perf Season ${RUN}`,
    slug: `perf-season-${RUN}`,
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
  const regIds: string[] = [];
  const personIds: string[] = [owner];
  for (let i = 0; i < 3; i++) {
    const pid = newId();
    personIds.push(pid);
    await db
      .insert(people)
      .values({ id: pid, phone: `+9191close${RUN}${String(i)}`, name: `Player ${String(i)}` });
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
    name: `Perf Season ${RUN}`,
    slug: `perf-season-${RUN}`,
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
  // Bid each lot at its own base price (a valid first bid regardless of band);
  // the first two lots go to team 0, the third to team 1.
  for (const [index, lot] of view.lots.entries()) {
    const paddle = index < 2 ? paddles[0] : paddles[1];
    if (!(await transitionLot(db, auction, lot.id, owner, "open")).ok) throw new Error("open");
    const bid = await placeBid(db, auction, owner, {
      lotId: lot.id,
      paddleId: paddle ?? "",
      amountRaw: lot.basePrice,
      bidderAuthorized: true,
    });
    if (!bid.ok) throw new Error(`bid: ${bid.code}`);
    if (!(await transitionLot(db, auction, lot.id, owner, "sell")).ok) throw new Error("sell");
  }
  if (!(await transitionAuction(db, auction, owner, "complete")).ok) throw new Error("complete");

  const deps = settlementDeps(db);
  const actor: SettlementActor = {
    personId: owner,
    orgId,
    grants: [
      { scopeType: "org", scopeId: orgId, capabilitySet: "settlement:controller", revokedAt: null },
    ],
  };

  const opened = await openCase(deps, actor, {
    commandId: newId(),
    auctionId: auction.id,
    basis: "committed",
  });
  if (!opened.ok) throw new Error(`open: ${opened.reason}`);
  const caseId = opened.caseId;
  await verifyCase(deps, actor, caseId, newId());
  await computeCaseObligations(deps, actor, caseId, newId());
  // Collect team 0's exact obligation; waive team 1's exact obligation → zero out.
  const settling = await caseFold(deps, caseId);
  const team0Due = settling?.projection.obligations[teamIds[0] ?? ""]?.amount ?? 0;
  const team1Due = settling?.projection.obligations[teamIds[1] ?? ""]?.amount ?? 0;
  const p = newId();
  await createPayment(deps, actor, {
    paymentId: p,
    commandId: newId(),
    caseId,
    teamId: teamIds[0] ?? "",
    method: "manual:cash",
    amount: team0Due,
  });
  await attestManualCapture(deps, actor, p, newId(), { attestedBy: owner });
  const { waiveObligation } = await import("../src/server/settlement/writer.js");
  if (team1Due > 0) {
    await waiveObligation(deps, actor, caseId, newId(), {
      teamId: teamIds[1] ?? "",
      amount: team1Due,
      reason: "sponsor",
    });
  }
  await settleCase(deps, actor, caseId, newId());

  const N = 40;

  await measure("verification (readyForClosure)", N, async () => {
    await readyForClosure(deps, orgId, caseId);
  });

  // Closure + reopen + re-close, in a repeating cycle so each is measured N times.
  const closureSamples: number[] = [];
  const reopenSamples: number[] = [];
  const recloseSamples: number[] = [];
  for (let i = 0; i < N; i++) {
    let t = performance.now();
    await closeCase(deps, actor, caseId, newId());
    (i === 0 ? closureSamples : recloseSamples).push(performance.now() - t);
    t = performance.now();
    await reopenCase(deps, actor, caseId, newId(), "perf cycle");
    reopenSamples.push(performance.now() - t);
    await settleCase(deps, actor, caseId, newId());
  }
  // Close a final time to leave it closed for the read-side measurements.
  await closeCase(deps, actor, caseId, newId());
  report("closure (first close)", closureSamples.concat(recloseSamples.slice(0, 1)));
  report("re-open (override)", reopenSamples);
  report("re-close (verify + seal)", recloseSamples);

  await measure("ceremony projection", 40, async () => {
    await closureCeremony(deps, caseId);
  });
  await measure("timeline rebuild", 40, async () => {
    const fold = await caseFold(deps, caseId);
    void fold;
  });
  await measure("evidence reproduction (replay)", 40, async () => {
    await reproduceClosureEvidence(deps, caseId);
  });
  await measure("projection rebuild + recovery", 20, async () => {
    await db
      .update(settlementCases)
      .set({ closureEvidence: null, closedAtSeq: null, status: "settled" })
      .where(eq(settlementCases.id, caseId));
    await recoverCase(deps, actor, caseId);
  });

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
