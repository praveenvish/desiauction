// Repeatable demo seed (LOCAL_SETUP): fixed identities, real domain functions,
// no mocked business logic. Re-running is safe — demo people are upserted by
// phone (stable identities, live sessions survive) and the demo org's data is
// deleted and rebuilt from scratch, so no duplicate rows ever accumulate.
//
// Seeds:
//   · 7 demo users (credentials printed at the end; codes land in /dev/inbox)
//   · "Demo Cricket Club" org with memberships + capability grants
//   · "Demo Premier League" — registration OPEN, 4 teams, 10 approved + 2
//     submitted players: ready for the full journey (approve → close →
//     create auction → live auction night)
//   · "Demo Cup (settled)" — a COMPLETED exemplar: auction conducted, case
//     settled, payments attested, receipts/invoices issued, one in-app
//     dispatch, one export artifact, and a sealed fiscal period
//
// Run: pnpm --filter @desiauction/web seed:demo   (or via pnpm setup:local)
import { mkdirSync } from "node:fs";
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
  auctionEvents,
  auctionOwnerInvites,
  auctions,
  auditLog,
  bids,
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
  fixtures,
  grants,
  grounds,
  invites,
  journalCheckpoints,
  journalLegs,
  journalPostings,
  lots,
  newId,
  organizations,
  orgMembers,
  paddleGrants,
  paddles,
  payments as paymentsTable,
  people,
  registrations,
  tournaments,
  settlementCases,
  settlementEvents,
  settlementObligations,
  teams,
  venues,
} from "@desiauction/db";
import { endedFiscalYearFor, fiscalYearBounds } from "@desiauction/financial-operations";
import {
  attestDay,
  closePeriod,
  declareProfile,
  finopsDeps,
  issueInvoice,
  issueReceipt,
  openPeriod,
  openSeries,
  requestDispatch,
  requestExport,
  runDispatchSend,
  runExportGenerate,
  runFollower,
  type FinopsActor,
} from "@desiauction/financial-operations/server";
import { and, eq, inArray, isNull } from "drizzle-orm";

import { PLATFORM_SCOPE_ID, PLATFORM_SCOPE_TYPE } from "../src/server/admin/capabilities.js";
import { auctionReady } from "../src/server/auction/auction-ready.js";
import { FINOPS_STORAGE_DIR } from "../src/server/financial-operations/deps.js";
import { settlementDeps } from "../src/server/settlement/deps.js";
import {
  attestManualCapture,
  computeCaseObligations,
  createPayment,
  openCase,
  verifyCase,
  type SettlementActor,
} from "../src/server/settlement/writer.js";

const DATABASE_URL = process.env["DATABASE_URL"];
if (DATABASE_URL === undefined) {
  throw new Error("DATABASE_URL is required (run via pnpm seed:demo)");
}
const handle = createDb(DATABASE_URL);
const db = handle.db;

// PX-9: the platform grant is RLS-forbidden on the app role by design, so the
// seed reaches for the system pool for that ONE row. Unset locally, it aliases
// the main pool (same rule as src/server/db.ts) and costs no extra connection.
const SYSTEM_DATABASE_URL = process.env["SYSTEM_DATABASE_URL"];
const systemHandle = SYSTEM_DATABASE_URL === undefined ? handle : createDb(SYSTEM_DATABASE_URL);
const systemDb = systemHandle.db;

const ORG_SLUG = "demo-club";
// PX-8: the ONE finops storage root, shared with the web tier and the runner.
// A seed that writes artifacts somewhere the app cannot read them makes the ops
// board report a false "exports failed" (IP-6 §22 — everything injected).
const ARTIFACT_DIR = FINOPS_STORAGE_DIR;

/** Fixed demo identities — phone IS the login credential (OTP via /dev/inbox). */
const USERS = [
  { key: "founder", name: "Demo Founder", phone: "+919999000001" },
  { key: "admin", name: "Demo Admin", phone: "+919999000002" },
  { key: "organizer", name: "Demo Organizer", phone: "+919999000003" },
  { key: "bidderA", name: "Demo Bidder A", phone: "+919999000004" },
  { key: "bidderB", name: "Demo Bidder B", phone: "+919999000005" },
  { key: "bidderC", name: "Demo Bidder C", phone: "+919999000006" },
  { key: "viewer", name: "Demo Viewer", phone: "+919999000007" },
] as const;

const PLAYER_NAMES = [
  "Arjun Sharma",
  "Vikram Patel",
  "Rohit Kumar",
  "Sanjay Gupta",
  "Amit Verma",
  "Rahul Singh",
  "Karan Mehta",
  "Deepak Yadav",
  "Nikhil Joshi",
  "Suresh Reddy",
  "Manish Tiwari",
  "Prakash Nair",
] as const;
const playerPhone = (i: number): string => `+9199990010${String(i + 1).padStart(2, "0")}`;

async function upsertPerson(name: string, phone: string): Promise<string> {
  await db.insert(people).values({ id: newId(), phone, name }).onConflictDoNothing();
  const [row] = await db.select({ id: people.id }).from(people).where(eq(people.phone, phone));
  if (row === undefined) throw new Error(`person upsert failed for ${phone}`);
  await db.update(people).set({ name }).where(eq(people.id, row.id));
  return row.id;
}

/** Delete every row belonging to a previous demo org — FK-safe order. */
async function resetDemoOrg(): Promise<void> {
  const [org] = await db
    .select({ id: organizations.id })
    .from(organizations)
    .where(eq(organizations.slug, ORG_SLUG));
  if (org === undefined) return;
  const orgId = org.id;
  const caseRows = await db
    .select({ id: settlementCases.id })
    .from(settlementCases)
    .where(eq(settlementCases.orgId, orgId));
  const caseIds = caseRows.map((row) => row.id);

  await db.delete(finopsEvents).where(eq(finopsEvents.orgId, orgId));
  await db.delete(finopsCursors).where(eq(finopsCursors.orgId, orgId));
  await db.delete(finopsDocuments).where(eq(finopsDocuments.orgId, orgId));
  await db.delete(finopsDispatches).where(eq(finopsDispatches.orgId, orgId));
  await db.delete(finopsExports).where(eq(finopsExports.orgId, orgId));
  await db.delete(finopsJobs).where(eq(finopsJobs.orgId, orgId));
  await db.delete(finopsPeriodDays).where(eq(finopsPeriodDays.orgId, orgId));
  await db.delete(finopsPeriods).where(eq(finopsPeriods.orgId, orgId));
  await db.delete(finopsProfiles).where(eq(finopsProfiles.orgId, orgId));
  await db.delete(finopsSeries).where(eq(finopsSeries.orgId, orgId));
  await db.delete(journalLegs).where(eq(journalLegs.orgId, orgId));
  await db.delete(journalPostings).where(eq(journalPostings.orgId, orgId));
  await db.delete(journalCheckpoints).where(eq(journalCheckpoints.orgId, orgId));
  await db.delete(paymentsTable).where(eq(paymentsTable.orgId, orgId));
  await db.delete(settlementEvents).where(eq(settlementEvents.orgId, orgId));
  if (caseIds.length > 0) {
    await db.delete(settlementObligations).where(inArray(settlementObligations.caseId, caseIds));
  }
  await db.delete(settlementCases).where(eq(settlementCases.orgId, orgId));
  await db.delete(auctionEvents).where(eq(auctionEvents.orgId, orgId));
  await db.delete(bids).where(eq(bids.orgId, orgId));
  await db.delete(lots).where(eq(lots.orgId, orgId));
  await db.delete(paddleGrants).where(eq(paddleGrants.orgId, orgId));
  await db.delete(auctionOwnerInvites).where(eq(auctionOwnerInvites.orgId, orgId));
  await db.delete(paddles).where(eq(paddles.orgId, orgId));
  await db.delete(auctions).where(eq(auctions.orgId, orgId));
  await db.delete(registrations).where(eq(registrations.orgId, orgId));
  await db.delete(fixtures).where(eq(fixtures.orgId, orgId));
  await db.delete(grounds).where(eq(grounds.orgId, orgId));
  await db.delete(venues).where(eq(venues.orgId, orgId));
  await db.delete(tournaments).where(eq(tournaments.orgId, orgId));
  await db.delete(teams).where(eq(teams.orgId, orgId));
  await db.delete(competitions).where(eq(competitions.orgId, orgId));
  await db.delete(invites).where(eq(invites.orgId, orgId));
  await db.delete(grants).where(and(eq(grants.scopeType, "org"), eq(grants.scopeId, orgId)));
  await db.delete(orgMembers).where(eq(orgMembers.orgId, orgId));
  await db.delete(auditLog).where(eq(auditLog.scopeId, orgId));
  await db.delete(organizations).where(eq(organizations.id, orgId));
}

async function grantSet(
  orgId: string,
  personId: string,
  capabilitySet: string,
  grantedBy: string,
): Promise<void> {
  await db.insert(grants).values({
    id: newId(),
    personId,
    scopeType: "org",
    scopeId: orgId,
    capabilitySet,
    grantedBy,
  });
}

/**
 * The platform grant (PX-9). Written on the SYSTEM pool, because RLS forbids
 * the app role to write a non-org-scoped grant at all (migration 0004) — the
 * seed observes the same rule the product does, so this stays honest against a
 * production role recipe instead of only against a local superuser.
 */
async function grantPlatformAdmin(personId: string): Promise<void> {
  const existing = await systemDb
    .select({ id: grants.id })
    .from(grants)
    .where(
      and(
        eq(grants.personId, personId),
        eq(grants.scopeType, PLATFORM_SCOPE_TYPE),
        eq(grants.scopeId, PLATFORM_SCOPE_ID),
        isNull(grants.revokedAt),
      ),
    )
    .limit(1);
  if (existing.length > 0) {
    return;
  }
  await systemDb.insert(grants).values({
    id: newId(),
    personId,
    scopeType: PLATFORM_SCOPE_TYPE,
    scopeId: PLATFORM_SCOPE_ID,
    capabilitySet: "platform:admin",
    grantedBy: personId,
  });
}

async function main(): Promise<void> {
  console.log("seed:demo — resetting previous demo data…");
  await resetDemoOrg();

  // --- People (stable identities: upsert by phone) ----------------------------
  const ids: Record<string, string> = {};
  for (const user of USERS) {
    ids[user.key] = await upsertPerson(user.name, user.phone);
  }
  const founder = ids["founder"] as string;
  const playerIds: string[] = [];
  for (let i = 0; i < PLAYER_NAMES.length; i++) {
    playerIds.push(await upsertPerson(PLAYER_NAMES[i] as string, playerPhone(i)));
  }

  // --- Organization, memberships, capability grants ---------------------------
  const orgId = newId();
  await db.insert(organizations).values({
    id: orgId,
    name: "Demo Cricket Club",
    slug: ORG_SLUG,
    createdBy: founder,
  });
  await db
    .insert(orgMembers)
    .values(USERS.map((user) => ({ orgId, personId: ids[user.key] as string })));
  await grantSet(orgId, founder, "org:owner", founder);
  await grantSet(orgId, founder, "settlement:controller", founder);
  await grantSet(orgId, founder, "finops:controller", founder);
  await grantSet(orgId, ids["admin"] as string, "org:owner", founder);
  await grantSet(orgId, ids["organizer"] as string, "org:staff", founder);
  for (const key of ["bidderA", "bidderB", "bidderC", "viewer"] as const) {
    await grantSet(orgId, ids[key] as string, "viewer", founder);
  }
  // PX-9: the founder is also the PLATFORM admin, so /admin is walkable from a
  // fresh setup:local. Note the scope — this grant is on the platform, not on
  // demo-club: none of the org grants above confer it, and it confers none of
  // them. Demo Admin (+919999000002) is deliberately NOT a platform admin
  // despite the name and `org:owner`, which is what makes the escalation suite
  // meaningful: "admin" of an org is not admin of the platform.
  await grantPlatformAdmin(founder);

  // --- Demo Premier League: the journey playground -----------------------------
  const leagueId = newId();
  await db.insert(competitions).values({
    id: leagueId,
    orgId,
    name: "Demo Premier League",
    slug: "demo-premier-league",
    status: "registration_open",
    location: "Mumbai",
    startsOn: "2026-08-01",
    endsOn: "2026-10-31",
    createdBy: founder,
  });
  const leagueTeams = ["Demo Tigers", "Demo Falcons", "Demo Panthers", "Demo Wolves"].map(
    (name) => ({ id: newId(), orgId, competitionId: leagueId, name, createdBy: founder }),
  );
  await db.insert(teams).values(leagueTeams);
  const bands = ["A", "A", "B", "B", "B", "C", "C", "C", "C", "C"] as const;
  await db.insert(registrations).values(
    playerIds.map((personId, i) => {
      const rid = newId();
      return {
        id: rid,
        orgId,
        competitionId: leagueId,
        personId,
        role: (["batter", "bowler", "all_rounder"] as const)[i % 3] as "batter",
        // 10 approved and ready; the last 2 stay submitted for the
        // approve-registration journey step.
        status: (i < 10 ? "approved" : "submitted") as "approved",
        registrationNumber: registrationNumber(rid),
        basePriceBand: i < 10 ? (bands[i] as string) : null,
      };
    }),
  );

  // --- Demo Cup (settled): the completed exemplar ------------------------------
  const cupId = newId();
  await db.insert(competitions).values({
    id: cupId,
    orgId,
    name: "Demo Cup (settled)",
    slug: "demo-cup-settled",
    status: "registration_closed",
    tournamentId: null,
    visibility: "private" as const,
    location: "Mumbai",
    startsOn: "2026-01-10",
    endsOn: "2026-03-15",
    createdBy: founder,
  });
  const cupTeams = ["Cup Kings", "Cup Chargers"].map((name) => ({
    id: newId(),
    orgId,
    competitionId: cupId,
    name,
    createdBy: founder,
  }));
  await db.insert(teams).values(cupTeams);
  const cupPlayerIds = playerIds.slice(0, 3);
  await db.insert(registrations).values(
    cupPlayerIds.map((personId, i) => {
      const rid = newId();
      return {
        id: rid,
        orgId,
        competitionId: cupId,
        personId,
        role: "batter" as const,
        status: "approved" as const,
        registrationNumber: registrationNumber(rid),
        basePriceBand: i === 0 ? "A" : "B",
      };
    }),
  );

  const cup = {
    id: cupId,
    orgId,
    name: "Demo Cup (settled)",
    slug: "demo-cup-settled",
    status: "registration_closed" as const,
    tournamentId: null,
    visibility: "private" as const,
    location: "Mumbai",
    startsOn: "2026-01-10",
    endsOn: "2026-03-15",
  };
  const ready = await auctionReady(db, cup);
  const created = await createAuction(db, cup, ready, founder, DEFAULT_AUCTION_CONFIG);
  if (!created.ok) throw new Error(`createAuction: ${created.reason}`);
  let auction = (await auctionOf(db, cupId)) as AuctionRecord;
  const cupPaddles: string[] = [];
  for (const team of cupTeams) {
    const issued = await issuePaddle(db, auction, founder, team.id, founder);
    if (!issued.ok) throw new Error("issuePaddle");
    cupPaddles.push(issued.paddleId);
  }
  await queueAllLots(db, auction, founder);
  await transitionAuction(db, auction, founder, "open");
  auction = (await auctionOf(db, cupId)) as AuctionRecord;
  const view = await auctionView(db, auction);
  for (const [i, lot] of view.lots.entries()) {
    const opened = await transitionLot(db, auction, lot.id, founder, "open");
    if (!opened.ok) throw new Error(`lot open: ${opened.reason}`);
    const bid = await placeBid(db, auction, founder, {
      lotId: lot.id,
      paddleId: (cupPaddles[i % 2] ?? "") as string,
      amountRaw: lot.basePrice,
      bidderAuthorized: true,
    });
    if (!bid.ok) throw new Error(`bid: ${bid.code}`);
    const sold = await transitionLot(db, auction, lot.id, founder, "sell");
    if (!sold.ok) throw new Error(`sell: ${sold.reason}`);
  }
  const completed = await transitionAuction(db, auction, founder, "complete");
  if (!completed.ok) throw new Error(`complete: ${completed.reason}`);

  // --- Settlement: case → obligations → manual payments → journal -------------
  const sDeps = settlementDeps(db, { gateways: {} });
  const sActor: SettlementActor = {
    personId: founder,
    orgId,
    grants: [
      { scopeType: "org", scopeId: orgId, capabilitySet: "settlement:controller", revokedAt: null },
    ],
  };
  const dues = { [cupTeams[0]?.id ?? ""]: 12_000_000, [cupTeams[1]?.id ?? ""]: 8_000_000 };
  const openedCase = await openCase(sDeps, sActor, {
    commandId: newId(),
    auctionId: auction.id,
    basis: "fixed",
    fixed: dues,
  });
  if (!openedCase.ok) throw new Error(`openCase: ${openedCase.reason}`);
  const caseId = openedCase.caseId;
  await verifyCase(sDeps, sActor, caseId, newId());
  await computeCaseObligations(sDeps, sActor, caseId, newId());

  const paymentIds: string[] = [];
  const installments = [
    { teamId: cupTeams[0]?.id ?? "", amount: 7_000_000 },
    { teamId: cupTeams[0]?.id ?? "", amount: 5_000_000 },
    { teamId: cupTeams[1]?.id ?? "", amount: 8_000_000 },
  ];
  for (const installment of installments) {
    const pid = newId();
    const ack = await createPayment(sDeps, sActor, {
      paymentId: pid,
      commandId: newId(),
      caseId,
      teamId: installment.teamId,
      method: "manual:cash",
      amount: installment.amount,
    });
    if (!ack.ok) throw new Error("createPayment");
    const captured = await attestManualCapture(sDeps, sActor, pid, newId(), {
      attestedBy: founder,
      evidenceRef: "seed-demo",
    });
    if (!captured.ok) throw new Error("attestManualCapture");
    paymentIds.push(pid);
  }

  // --- Financial operations: documents → dispatch → export → fiscal close -----
  mkdirSync(ARTIFACT_DIR, { recursive: true });
  const fDeps = finopsDeps(db, { storageDir: ARTIFACT_DIR });
  const fActor: FinopsActor = {
    personId: founder,
    orgId,
    grants: [
      { scopeType: "org", scopeId: orgId, capabilitySet: "finops:controller", revokedAt: null },
    ],
  };
  const declared = await declareProfile(
    fDeps,
    fActor,
    { legalName: "Demo Cricket Club Trust", posture: "none" },
    newId(),
  );
  if (!declared.ok) throw new Error("declareProfile");
  await runFollower(fDeps, orgId);

  const { fiscalYearOf, istDateOf } = await import("@desiauction/financial-operations");
  const currentFy = fiscalYearOf(istDateOf(Date.now()));
  const receiptSeries = await openSeries(
    fDeps,
    fActor,
    { kind: "receipt", fy: currentFy, prefix: "RCT" },
    newId(),
  );
  const invoiceSeries = await openSeries(
    fDeps,
    fActor,
    { kind: "tax-invoice", fy: currentFy, prefix: "INV" },
    newId(),
  );
  if (!receiptSeries.ok || !invoiceSeries.ok) throw new Error("openSeries");
  for (const paymentId of paymentIds) {
    const issued = await issueReceipt(
      fDeps,
      { kind: "person", actor: fActor, capability: "finops.document" },
      { seriesId: receiptSeries.streamId, paymentId },
      newId(),
    );
    if (!issued.ok) throw new Error("issueReceipt");
  }
  for (const team of cupTeams) {
    const invoiced = await issueInvoice(
      fDeps,
      fActor,
      { seriesId: invoiceSeries.streamId, caseId, teamId: team.id },
      newId(),
    );
    if (!invoiced.ok) throw new Error("issueInvoice");
  }

  const [firstDoc] = await fDeps.store.loadDocuments(receiptSeries.streamId);
  if (firstDoc !== undefined) {
    const requested = await requestDispatch(
      fDeps,
      fActor,
      {
        channel: "in-app",
        recipientRef: `owner:${firstDoc.partyId}`,
        templateId: "receipt-issued",
        templateVersion: "v1",
        subjectRef: `doc:${firstDoc.docId}`,
      },
      newId(),
    );
    if (!requested.ok) throw new Error("requestDispatch");
    await runDispatchSend(fDeps, {
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
    });
  }

  const exportRequested = await requestExport(
    fDeps,
    fActor,
    { kind: "journal-csv", params: { fy: currentFy, seed: "demo" } },
    newId(),
  );
  if (!exportRequested.ok) throw new Error("requestExport");
  await runExportGenerate(fDeps, {
    jobId: newId(),
    orgId,
    kind: "export.generate",
    dedupeKey: `export.generate:${exportRequested.streamId}`,
    state: "leased",
    attempts: 0,
    maxAttempts: 5,
    notBeforeMs: Date.now(),
    leasedUntilMs: null,
    lastError: null,
    payload: { exportId: exportRequested.streamId },
  });

  const endedFy = endedFiscalYearFor(Date.now());
  const period = await openPeriod(fDeps, fActor, { fy: endedFy }, newId());
  if (!period.ok) throw new Error("openPeriod");
  const attested = await attestDay(
    fDeps,
    { kind: "person", actor: fActor, capability: "finops.operate" },
    period.streamId,
    {
      date: fiscalYearBounds(endedFy).end,
      checks: [{ name: "seed-demo", outcome: "pass", detail: null }],
    },
    newId(),
  );
  if (!attested.ok) throw new Error("attestDay");
  const closed = await closePeriod(fDeps, fActor, period.streamId, newId());
  if (!closed.ok) throw new Error("closePeriod");

  // --- Summary -----------------------------------------------------------------
  console.log(`
DEMO DATA READY (repeatable — rerun any time)

  Organization    Demo Cricket Club        /org/${ORG_SLUG}
  Playground      Demo Premier League      /competitions/demo-premier-league
                  4 teams · 10 approved + 2 submitted players · registration OPEN
  Settled example Demo Cup (settled)       /competitions/demo-cup-settled
                  auction complete · case settled · ${String(paymentIds.length)} payments · receipts,
                  invoices, 1 in-app dispatch, 1 export, fiscal ${endedFy} SEALED

  Sign in at /login with a phone below — the code appears at /dev/inbox.

  ROLE        PHONE (10-digit)   CAPABILITIES`);
  const caps: Record<string, string> = {
    founder: "org:owner + settlement:controller + finops:controller + platform:admin",
    admin: "org:owner (NOT a platform admin — /admin 404s for them)",
    organizer: "org:staff",
    bidderA: "viewer (claims a paddle via owner invite)",
    bidderB: "viewer (claims a paddle via owner invite)",
    bidderC: "viewer (claims a paddle via owner invite)",
    viewer: "viewer",
  };
  for (const user of USERS) {
    console.log(
      `  ${user.name.replace("Demo ", "").padEnd(11)} ${user.phone.replace("+91", "").padEnd(18)} ${caps[user.key] ?? ""}`,
    );
  }
  console.log(`\n  Players +919999001001…+919999001012 (12, seeded into both competitions)\n`);
}

main()
  .then(async () => {
    await handle.sql.end();
  })
  .catch(async (error: unknown) => {
    console.error(error);
    await handle.sql.end();
    process.exit(1);
  });
