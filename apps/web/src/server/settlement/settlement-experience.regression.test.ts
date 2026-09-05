// PERMANENT SETTLEMENT EXPERIENCE REGRESSION SUITE (PX-7).
//
// IP-5 certified the settlement PLATFORM; these suites certify the EXPERIENCE
// built on it — the read model every screen consumes, the worklist the desk
// filters, the rupee adapter the keyboard feeds, and the capability partition
// the surfaces are gated by.
//
// The property under test throughout: **the experience adds no truth**. Every
// figure a screen shows is the writer's own fold, every refusal a screen shows
// is the writer's own rejection, and no screen can reach a state the certified
// machine forbids. Where a test could pass by re-implementing settlement, it
// asserts against `caseFold`/`caseFinancial` instead — so a drift between what
// the console renders and what the books say fails HERE, loudly.
//
// The auction it settles is a REAL auction conducted through the FROZEN IP-4
// aggregate. The `it` blocks run in order and share one case: settlement is a
// story, not a bag of assertions.
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
import { caseFinancial, outstandingOf } from "@desiauction/settlement";
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
import { parseRupees } from "./amount";
import {
  canSettlement,
  issueSettlementGrant,
  revokeSettlementGrant,
  settlementActor,
} from "./authz";
import { closureCeremony, reproduceClosureEvidence } from "./ceremony";
import { settlementDeps, type SettlementDeps } from "./deps";
import { caseAudit, caseView, capturedSince, dashboardView, settlementGrantsOf } from "./views";
import {
  CASE_REVIEW_TABS,
  CASE_STATUS_LABEL,
  DEFAULT_CASE_TAB,
  caseTabFrom,
  filterCases,
  isSavedView,
  SAVED_VIEWS,
} from "./worklist";
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
  voidCase,
  waiveObligation,
  type SettlementActor,
} from "./writer";
import { purgeOrg } from "../test-support/purge-org";

const handle: DbHandle = createDb(env.DATABASE_URL);
const db = handle.db;
const sender = new DevInboxSender(db);

const RUN = String(Date.now()).slice(-7);
const PHONE_OWNER = `+9188${RUN}1`;
const PHONE_OFFICER = `+9187${RUN}2`;
const PHONE_CONTROLLER = `+9186${RUN}3`;
const PHONE_OUTSIDER = `+9185${RUN}4`;
const TEST_PHONES = [PHONE_OWNER, PHONE_OFFICER, PHONE_CONTROLLER, PHONE_OUTSIDER];
const SEED_PHONE_PREFIX = `+91933${RUN}`;

// Band A base = ₹50,000; band B base = ₹25,000 (DEFAULT_AUCTION_CONFIG).
const SALE_A = 5_000_000;
const SALE_B = 2_500_000;
const KINGS_DUE = SALE_A * 2;
const CHARGERS_DUE = SALE_B;

let owner = "";
let officer = "";
let controller = "";
let outsider = "";
let org = { id: "", name: "", slug: "" };
let comp: CompetitionSummary = null as unknown as CompetitionSummary;
let auction: AuctionRecord = null as unknown as AuctionRecord;
const teamIds: string[] = [];
const paddleIds: string[] = [];

let deps: SettlementDeps;
let officerActor: SettlementActor;
let controllerActor: SettlementActor;
let ownerActor: SettlementActor;
let caseId = "";

const kings = (): string => teamIds[0] ?? "";
const chargers = (): string => teamIds[1] ?? "";

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

/** Reload a competition after a status advance — narrow by THROWING, never by cast. */
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
  const ready = await auctionReady(db, await reload(comp.slug));
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
    { player: "King One", paddle: paddleIds[0], amount: SALE_A },
    { player: "King Two", paddle: paddleIds[0], amount: SALE_A },
    { player: "Charger One", paddle: paddleIds[1], amount: SALE_B },
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

/**
 * THE LOAD-BEARING PROPERTY OF PX-7: what the SCREEN reads is exactly what the
 * WRITER folded. Asserted after every state change — if a view ever computes
 * its own money, this is the assertion that catches it.
 */
async function expectViewMatchesFold(): Promise<void> {
  const view = await caseView(deps, db, caseId);
  const fold = await caseFold(deps, caseId);
  expect(view).not.toBeNull();
  expect(fold).not.toBeNull();
  if (view === null || fold === null) {
    return;
  }
  const truth = caseFinancial(fold.projection);
  expect(view.status).toBe(fold.projection.status);
  expect(view.financial).toEqual(truth);
  for (const obligation of view.obligations) {
    const source = fold.projection.obligations[obligation.teamId];
    expect(source).toBeDefined();
    if (source === undefined) {
      continue;
    }
    expect(obligation.outstanding).toBe(outstandingOf(source));
    expect(obligation.discharged).toBe(source.discharged);
    expect(obligation.waived).toBe(source.waived);
  }
  // Money renders against NAMES, and a name is never a raw id.
  for (const obligation of view.obligations) {
    expect(obligation.teamName).not.toBe(obligation.teamId);
    expect(obligation.teamName.length).toBeGreaterThan(0);
  }
}

beforeAll(async () => {
  owner = await login(PHONE_OWNER);
  officer = await login(PHONE_OFFICER);
  controller = await login(PHONE_CONTROLLER);
  outsider = await login(PHONE_OUTSIDER);

  org = await createOrg(db, owner, `Desk ${RUN}`);
  comp = await createCompetition(db, org.id, owner, {
    name: `Cup ${RUN}`,
    location: "Pune",
    startsOn: "2026-08-01",
    endsOn: "2026-09-15",
  });

  for (const name of ["Kings", "Chargers"]) {
    const team = await createTeam(db, org.id, comp.id, owner, name);
    if (!team.ok) {
      throw new Error("team");
    }
    teamIds.push(team.team.id);
  }

  await advanceCompetition(db, await reload(comp.slug), owner, "setup");
  await advanceCompetition(db, await reload(comp.slug), owner, "registration_open");

  await seedApproved("King One", "b01", "A");
  await seedApproved("King Two", "b02", "A");
  await seedApproved("Charger One", "b03", "B");

  await advanceCompetition(db, await reload(comp.slug), owner, "registration_closed");
  comp = await reload(comp.slug);
  await conductAuctionNight();

  deps = settlementDeps(db);
  // Money authority is granted EXPLICITLY — org:owner is not a treasurer.
  const asOfficer = await issueSettlementGrant(db, owner, org.id, officer, "settlement:officer");
  const asController = await issueSettlementGrant(
    db,
    owner,
    org.id,
    controller,
    "settlement:controller",
  );
  if (!asOfficer.ok || !asController.ok) {
    throw new Error("grant");
  }
  officerActor = await settlementActor(db, officer, org.id);
  controllerActor = await settlementActor(db, controller, org.id);
  ownerActor = await settlementActor(db, owner, org.id);
}, 120_000);

afterAll(async () => {
  // PA-1R Phase 3: the spine this teardown never deleted (see purge-org.ts).
  await purgeOrg(db, org.id);
  const caseRows = await db
    .select({ id: settlementCases.id })
    .from(settlementCases)
    .where(eq(settlementCases.orgId, org.id));
  const caseIds = caseRows.map((row) => row.id);
  await db.delete(journalLegs).where(eq(journalLegs.orgId, org.id));
  await db.delete(journalPostings).where(eq(journalPostings.orgId, org.id));
  await db.delete(journalCheckpoints).where(eq(journalCheckpoints.orgId, org.id));
  await db.delete(paymentsTable).where(eq(paymentsTable.orgId, org.id));
  if (caseIds.length > 0) {
    await db.delete(settlementObligations).where(inArray(settlementObligations.caseId, caseIds));
  }
  await db.delete(settlementEvents).where(eq(settlementEvents.orgId, org.id));
  await db.delete(settlementCases).where(eq(settlementCases.orgId, org.id));
  await db.delete(auditLog).where(eq(auditLog.scopeId, org.id));
  await db.delete(grantsTable).where(eq(grantsTable.scopeId, org.id));
  await db.delete(orgMembers).where(eq(orgMembers.orgId, org.id));
  // Tests that prove isolation spin up a SECOND org and delete only the
  // organization row, leaving its membership and grants behind. Both reference
  // `people` under RESTRICT (0040), so clear them BY PERSON as well as by org.
  await db
    .delete(grantsTable)
    .where(inArray(grantsTable.personId, [owner, officer, controller, outsider]));
  await db
    .delete(orgMembers)
    .where(inArray(orgMembers.personId, [owner, officer, controller, outsider]));
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
  await db
    .delete(sessions)
    .where(inArray(sessions.personId, [owner, officer, controller, outsider]));
  await db.delete(people).where(inArray(people.phone, TEST_PHONES));
  await db.delete(people).where(like(people.phone, `${SEED_PHONE_PREFIX}%`));
  await handle.sql.end({ timeout: 5 });
}, 60_000);

// ============================================================================
describe("PX-7 · The rupee adapter — the keyboard never invents money", () => {
  it("converts what an organizer actually types into exact paise", () => {
    expect(parseRupees("70000")).toEqual({ ok: true, paise: 7_000_000 });
    expect(parseRupees("1,20,000")).toEqual({ ok: true, paise: 12_000_000 });
    expect(parseRupees("₹ 1,20,000")).toEqual({ ok: true, paise: 12_000_000 });
    expect(parseRupees("1234.50")).toEqual({ ok: true, paise: 123_450 });
    // One decimal place means tenths of a rupee, not tenths of a paisa.
    expect(parseRupees("1234.5")).toEqual({ ok: true, paise: 123_450 });
    expect(parseRupees("0.01")).toEqual({ ok: true, paise: 1 });
  });

  it("REFUSES anything it cannot represent exactly", () => {
    // Sub-paise precision is money the ledger cannot hold — refuse, never round.
    expect(parseRupees("1.005").ok).toBe(false);
    expect(parseRupees("-5").ok).toBe(false);
    expect(parseRupees("abc").ok).toBe(false);
    expect(parseRupees("1e5").ok).toBe(false);
    expect(parseRupees("").ok).toBe(false);
    expect(parseRupees("   ").ok).toBe(false);
    expect(parseRupees("0")).toEqual({ ok: false, reason: "zero" });
    expect(parseRupees("1.2.3").ok).toBe(false);
    expect(parseRupees("99999999999999999999").ok).toBe(false);
  });

  it("never produces an unsafe integer", () => {
    for (const input of ["99999999999999", "12345678901234.99"]) {
      const parsed = parseRupees(input);
      if (parsed.ok) {
        expect(Number.isSafeInteger(parsed.paise)).toBe(true);
      }
    }
  });
});

// ============================================================================
describe("PX-7 · Permissions — the money surfaces are gated by settlement grants", () => {
  it("gives an org OWNER no settlement power at all (the partition holds)", async () => {
    for (const capability of [
      "settlement.view",
      "settlement.manage",
      "settlement.collect",
      "settlement.override",
    ] as const) {
      expect(await canSettlement(db, owner, org.id, capability)).toBe(false);
    }
  });

  it("gives an OFFICER view/manage/collect but NEVER override", async () => {
    expect(await canSettlement(db, officer, org.id, "settlement.view")).toBe(true);
    expect(await canSettlement(db, officer, org.id, "settlement.manage")).toBe(true);
    expect(await canSettlement(db, officer, org.id, "settlement.collect")).toBe(true);
    expect(await canSettlement(db, officer, org.id, "settlement.override")).toBe(false);
  });

  it("gives a CONTROLLER the override power on top", async () => {
    expect(await canSettlement(db, controller, org.id, "settlement.override")).toBe(true);
  });

  it("gives an outsider nothing", async () => {
    expect(await canSettlement(db, outsider, org.id, "settlement.view")).toBe(false);
  });
});

// ============================================================================
describe("PX-7 · Money authority — settlement is reachable from the product", () => {
  it("lists exactly the settlement grants, never the org roles", async () => {
    const rows = await settlementGrantsOf(db, org.id);
    const sets = rows.map((row) => row.capabilitySet).sort();
    expect(sets).toEqual(["settlement:controller", "settlement:officer"]);
    // The panel renders people, so the read must carry them.
    expect(rows.every((row) => row.phone.length > 0)).toBe(true);
    // `org:owner` is a grant on the same table — and must NOT appear here.
    expect(sets).not.toContain("org:owner");
  });

  it("REFUSES to mint a grant for anyone without the frozen grant.issue", async () => {
    const result = await issueSettlementGrant(
      db,
      outsider,
      org.id,
      outsider,
      "settlement:controller",
    );
    expect(result).toEqual({ ok: false, reason: "forbidden" });
  });

  it("REFUSES a capability set settlement does not recognise", async () => {
    // Nothing mints an unexpandable grant — the IP-2 invites discipline.
    for (const set of ["org:owner", "settlement:admin", "finops:controller"]) {
      const result = await issueSettlementGrant(db, owner, org.id, outsider, set);
      expect(result).toEqual({ ok: false, reason: "unknown_set" });
    }
  });

  it("issues and revokes money authority, and the capability follows immediately", async () => {
    const issued = await issueSettlementGrant(db, owner, org.id, outsider, "settlement:officer");
    expect(issued.ok).toBe(true);
    if (!issued.ok) {
      return;
    }
    expect(await canSettlement(db, outsider, org.id, "settlement.view")).toBe(true);
    expect(await canSettlement(db, outsider, org.id, "settlement.override")).toBe(false);

    const revoked = await revokeSettlementGrant(db, owner, org.id, issued.grantId);
    expect(revoked.ok).toBe(true);
    // A revoked grant confers nothing — the read is by active grant, not cache.
    expect(await canSettlement(db, outsider, org.id, "settlement.view")).toBe(false);
    expect((await settlementGrantsOf(db, org.id)).map((row) => row.personId)).not.toContain(
      outsider,
    );
  });

  it("REFUSES to revoke an identity grant through the settlement path", async () => {
    // org:owner is identity's business; settlement revokes settlement grants only.
    const [ownerGrant] = await db
      .select({ id: grantsTable.id })
      .from(grantsTable)
      .where(and(eq(grantsTable.scopeId, org.id), eq(grantsTable.capabilitySet, "org:owner")))
      .limit(1);
    expect(ownerGrant).toBeDefined();
    const result = await revokeSettlementGrant(db, owner, org.id, ownerGrant?.id ?? "");
    expect(result).toEqual({ ok: false, reason: "unknown_set" });
  });
});

// ============================================================================
describe("PX-7 · Case lifecycle — the console walks the certified machine", () => {
  it("REFUSES to open a case as anyone without settlement.manage", async () => {
    const ack = await openCase(deps, ownerActor, {
      commandId: newId(),
      auctionId: auction.id,
      basis: "committed",
    });
    expect(ack).toEqual({ ok: false, reason: "not_authorized" });
  });

  it("opens the case an officer would open from the console", async () => {
    const ack = await openCase(deps, officerActor, {
      commandId: newId(),
      auctionId: auction.id,
      basis: "committed",
    });
    expect(ack.ok).toBe(true);
    if (!ack.ok) {
      return;
    }
    caseId = ack.caseId;

    const view = await caseView(deps, db, caseId);
    expect(view?.status).toBe("opened");
    expect(view?.basis).toBe("committed");
    // The console shows the pin because the pin is what the money stands on.
    expect(view?.sourceDigest).toHaveLength(64);
    expect(view?.foldDigest).toBeNull();
    expect(view?.obligations).toEqual([]);
    expect(view?.evidence).toBeNull();
    expect(view?.overlay.reconciled).toBe(false);
  });

  it("ATTACK · refuses every step the machine does not allow from `opened`", async () => {
    // Each of these is a button the console must never offer — and a request
    // the writer must refuse even if someone forges it.
    expect((await settleCase(deps, officerActor, caseId, newId())).ok).toBe(false);
    expect((await closeCase(deps, officerActor, caseId, newId())).ok).toBe(false);
    expect((await computeCaseObligations(deps, officerActor, caseId, newId())).ok).toBe(false);
    expect((await reopenCase(deps, controllerActor, caseId, newId(), "x")).ok).toBe(false);
  });

  it("ATTACK · refuses a payment before the case is collecting", async () => {
    const ack = await createPayment(deps, officerActor, {
      paymentId: newId(),
      commandId: newId(),
      caseId,
      teamId: kings(),
      method: "manual:cash",
      amount: 100,
    });
    expect(ack).toEqual({ ok: false, reason: "case_not_collecting" });
  });

  it("verifies against the frozen auction and records the fold digest", async () => {
    const ack = await verifyCase(deps, officerActor, caseId, newId());
    expect(ack.ok).toBe(true);
    const view = await caseView(deps, db, caseId);
    expect(view?.status).toBe("verified");
    expect(view?.foldDigest).toHaveLength(64);
  });

  it("computes obligations the console renders against team NAMES", async () => {
    const ack = await computeCaseObligations(deps, officerActor, caseId, newId());
    expect(ack.ok).toBe(true);
    const view = await caseView(deps, db, caseId);
    expect(view?.status).toBe("settling");
    const byName = new Map(view?.obligations.map((row) => [row.teamName, row]));
    expect(byName.get("Kings")?.amount).toBe(KINGS_DUE);
    expect(byName.get("Chargers")?.amount).toBe(CHARGERS_DUE);
    expect(view?.financial.totalObligations).toBe(KINGS_DUE + CHARGERS_DUE);
    expect(view?.financial.outstanding).toBe(KINGS_DUE + CHARGERS_DUE);
    await expectViewMatchesFold();
  });

  it("ATTACK · refuses to settle while a rupee is outstanding", async () => {
    const ack = await settleCase(deps, officerActor, caseId, newId());
    expect(ack).toEqual({ ok: false, reason: "obligations_outstanding" });
  });
});

// ============================================================================
describe("PX-7 · Collection — record, then attest", () => {
  let firstPayment = "";

  it("records a payment WITHOUT moving any money (created, not captured)", async () => {
    firstPayment = newId();
    const ack = await createPayment(deps, officerActor, {
      paymentId: firstPayment,
      commandId: newId(),
      caseId,
      teamId: kings(),
      method: "manual:cash",
      amount: 4_000_000,
    });
    expect(ack.ok).toBe(true);

    const view = await caseView(deps, db, caseId);
    const payment = view?.payments.find((row) => row.paymentId === firstPayment);
    expect(payment?.status).toBe("created");
    expect(payment?.captured).toBe(0);
    expect(payment?.teamName).toBe("Kings");
    // Recording is not collecting: nothing is discharged until it is attested.
    expect(view?.financial.discharged).toBe(0);
    await expectViewMatchesFold();
  });

  it("ATTACK · refuses a payment larger than the team still owes", async () => {
    const ack = await createPayment(deps, officerActor, {
      paymentId: newId(),
      commandId: newId(),
      caseId,
      teamId: chargers(),
      method: "manual:cash",
      amount: CHARGERS_DUE + 1,
    });
    expect(ack).toEqual({ ok: false, reason: "amount_exceeds_outstanding" });
  });

  it("attests the manual capture and DISCHARGES the obligation", async () => {
    const ack = await attestManualCapture(deps, officerActor, firstPayment, newId(), {
      attestedBy: officer,
    });
    expect(ack.ok).toBe(true);

    const view = await caseView(deps, db, caseId);
    const payment = view?.payments.find((row) => row.paymentId === firstPayment);
    expect(payment?.status).toBe("captured");
    expect(payment?.captured).toBe(4_000_000);
    // An attestation names the person who made it — that is the whole point.
    expect(payment?.attested).toBe(true);
    expect(payment?.attestedBy).toBe(officer);

    const kingsRow = view?.obligations.find((row) => row.teamName === "Kings");
    expect(kingsRow?.discharged).toBe(4_000_000);
    expect(kingsRow?.outstanding).toBe(KINGS_DUE - 4_000_000);
    await expectViewMatchesFold();
  });

  it("ATTACK · refuses to attest the same capture twice", async () => {
    const ack = await attestManualCapture(deps, officerActor, firstPayment, newId(), {
      attestedBy: officer,
    });
    expect(ack).toEqual({ ok: false, reason: "illegal_transition" });
  });

  it("counts today's collections from the payment projection, not a tally", async () => {
    const today = await capturedSince(db, org.id, Date.now() - 60_000);
    expect(today.count).toBe(1);
    expect(today.total).toBe(4_000_000);
    // A window that closed before the capture sees nothing.
    const future = await capturedSince(db, org.id, Date.now() + 60_000);
    expect(future).toEqual({ total: 0, count: 0 });
  });

  it("collects the rest of the Kings' dues", async () => {
    const paymentId = newId();
    expect(
      (
        await createPayment(deps, officerActor, {
          paymentId,
          commandId: newId(),
          caseId,
          teamId: kings(),
          method: "manual:upi-direct",
          amount: KINGS_DUE - 4_000_000,
        })
      ).ok,
    ).toBe(true);
    expect(
      (await attestManualCapture(deps, officerActor, paymentId, newId(), { attestedBy: officer }))
        .ok,
    ).toBe(true);

    const view = await caseView(deps, db, caseId);
    expect(view?.obligations.find((row) => row.teamName === "Kings")?.outstanding).toBe(0);
    await expectViewMatchesFold();
  });
});

// ============================================================================
describe("PX-7 · Waiver — the override well", () => {
  it("REFUSES a waiver from an officer (no override capability)", async () => {
    const ack = await waiveObligation(deps, officerActor, caseId, newId(), {
      teamId: chargers(),
      amount: CHARGERS_DUE,
      reason: "goodwill",
    });
    expect(ack).toEqual({ ok: false, reason: "not_authorized" });
  });

  it("ATTACK · refuses a waiver larger than what is owed", async () => {
    const ack = await waiveObligation(deps, controllerActor, caseId, newId(), {
      teamId: chargers(),
      amount: CHARGERS_DUE + 1,
      reason: "typo",
    });
    expect(ack).toEqual({ ok: false, reason: "amount_exceeds_outstanding" });
  });

  it("ATTACK · refuses a waiver against a team that is not on the case", async () => {
    const ack = await waiveObligation(deps, controllerActor, caseId, newId(), {
      teamId: newId(),
      amount: 100,
      reason: "forged",
    });
    expect(ack).toEqual({ ok: false, reason: "unknown_team" });
  });

  it("lets a CONTROLLER waive, and shows it on the case", async () => {
    const ack = await waiveObligation(deps, controllerActor, caseId, newId(), {
      teamId: chargers(),
      amount: CHARGERS_DUE,
      reason: "Sponsor covered the shortfall",
    });
    expect(ack.ok).toBe(true);

    const view = await caseView(deps, db, caseId);
    const row = view?.obligations.find((entry) => entry.teamName === "Chargers");
    expect(row?.waived).toBe(CHARGERS_DUE);
    expect(row?.outstanding).toBe(0);
    expect(view?.financial.waived).toBe(CHARGERS_DUE);
    expect(view?.financial.outstanding).toBe(0);
    await expectViewMatchesFold();
  });

  it("records the waiver on the timeline with its reason, in a human's words", async () => {
    const audit = await caseAudit(deps, org.id, caseId, comp.id, db);
    const waived = audit.timeline.filter((row) => row.type === "ObligationWaived");
    expect(waived).toHaveLength(1);
    const row = waived[0];

    // The frozen `closureTimeline` summary renders raw paise and a raw team id
    // and DROPS the reason the event carries. The desk shows all three properly:
    // a name, rupees, and why — read from that same event, inventing nothing.
    expect(row?.headline).toContain("Chargers");
    expect(row?.headline).toContain("₹25,000");
    expect(row?.headline).not.toContain(chargers());
    expect(row?.headline).not.toContain("2500000");
    expect(row?.reason).toBe("Sponsor covered the shortfall");
    // An audit names the person, not a ULID.
    expect(row?.actor).not.toBe(controller);
    expect(row?.actor).toContain(PHONE_CONTROLLER);

    // The books moved with it: a waiver is a posting, not a note.
    expect(audit.journal.length).toBeGreaterThan(0);
  });

  it("leaves every non-money event in the frozen projection's own words", async () => {
    const audit = await caseAudit(deps, org.id, caseId, comp.id, db);
    const opened = audit.timeline.find((row) => row.type === "CaseOpened");
    // Unenriched types keep exactly what settlement says about them.
    expect(opened?.headline).toBe("Case opened · basis committed");
    expect(opened?.reason).toBeNull();
  });
});

// ============================================================================
describe("PX-7 · Closure — verification, evidence and the Reconciled overlay", () => {
  it("settles once nothing is outstanding", async () => {
    const ack = await settleCase(deps, officerActor, caseId, newId());
    expect(ack.ok).toBe(true);
    expect((await caseView(deps, db, caseId))?.status).toBe("settled");
  });

  it("reports readiness with every closure check passing", async () => {
    const readiness = await readyForClosure(deps, org.id, caseId);
    expect(readiness.status).toBe("settled");
    expect(readiness.blockers).toEqual([]);
    expect(readiness.ready).toBe(true);
  });

  it("ATTACK · refuses a collection on a settled case", async () => {
    const ack = await createPayment(deps, officerActor, {
      paymentId: newId(),
      commandId: newId(),
      caseId,
      teamId: kings(),
      method: "manual:cash",
      amount: 100,
    });
    expect(ack).toEqual({ ok: false, reason: "case_not_collecting" });
  });

  it("ATTACK · refuses to void a case that has moved money", async () => {
    const ack = await voidCase(deps, controllerActor, caseId, newId(), "changed my mind");
    expect(ack.ok).toBe(false);
  });

  it("closes the case and SEALS the evidence the screen renders", async () => {
    const ack = await closeCase(deps, officerActor, caseId, newId());
    expect(ack.ok).toBe(true);

    const view = await caseView(deps, db, caseId);
    expect(view?.status).toBe("closed");
    expect(view?.overlay.reconciled).toBe(true);
    expect(view?.closures).toBe(1);

    // Every field the Evidence tab renders must actually be there.
    const evidence = view?.evidence;
    expect(evidence).not.toBeNull();
    for (const key of [
      "verificationDigest",
      "projectionDigest",
      "journalDigest",
      "walletDigest",
      "paymentDigest",
      "trialBalanceDigest",
      "caseEventCount",
      "journalSeq",
    ]) {
      expect(evidence?.[key]).toBeDefined();
    }
    expect(String(evidence?.["verificationDigest"])).toHaveLength(64);
  });

  it("REPLAYS the evidence byte-for-byte from the log", async () => {
    const replay = await reproduceClosureEvidence(deps, caseId);
    expect(replay.ok).toBe(true);
    // The founder demonstration's final beat: the proof reproduces.
    expect(replay.matches).toBe(true);
    expect(replay.reproduced).toEqual(replay.stored);
  });

  it("assembles the ceremony every closure screen reads", async () => {
    const ceremony = await closureCeremony(deps, caseId);
    expect(ceremony).not.toBeNull();
    expect(ceremony?.summary.status).toBe("closed");
    expect(ceremony?.overlay.reconciled).toBe(true);
    expect(ceremony?.financial.outstanding).toBe(0);
    expect(ceremony?.financial.discharged).toBe(KINGS_DUE);
    expect(ceremony?.financial.waived).toBe(CHARGERS_DUE);
    expect(ceremony?.evidence).not.toBeNull();
    // The timeline is the case's whole life, opened → closed.
    expect(ceremony?.timeline[0]?.type).toBe("CaseOpened");
    expect(ceremony?.timeline.at(-1)?.type).toBe("CaseClosed");
  });

  it("ATTACK · refuses to close twice", async () => {
    const ack = await closeCase(deps, officerActor, caseId, newId());
    expect(ack).toEqual({ ok: false, reason: "illegal_transition" });
  });

  it("REFUSES a reopen from an officer, allows it for a controller, and un-reconciles", async () => {
    expect((await reopenCase(deps, officerActor, caseId, newId(), "oops")).ok).toBe(false);

    const ack = await reopenCase(deps, controllerActor, caseId, newId(), "A cheque bounced");
    expect(ack.ok).toBe(true);

    const view = await caseView(deps, db, caseId);
    expect(view?.status).toBe("settling");
    expect(view?.reopenings).toBe(1);
    // A reopened case is NOT reconciled and shows no sealed evidence.
    expect(view?.overlay.reconciled).toBe(false);
    expect(view?.evidence).toBeNull();
  });

  it("re-closes and re-seals reproducible evidence", async () => {
    expect((await settleCase(deps, officerActor, caseId, newId())).ok).toBe(true);
    expect((await closeCase(deps, officerActor, caseId, newId())).ok).toBe(true);
    const view = await caseView(deps, db, caseId);
    expect(view?.status).toBe("closed");
    expect(view?.closures).toBe(2);
    const replay = await reproduceClosureEvidence(deps, caseId);
    expect(replay.matches).toBe(true);
  });
});

// ============================================================================
describe("PX-7 · The dashboard worklist", () => {
  it("lists the org's cases with the case fold's own money", async () => {
    const view = await dashboardView(deps, db, org.id);
    const row = view.cases.find((entry) => entry.caseId === caseId);
    expect(row).toBeDefined();
    expect(row?.competitionName).toBe(comp.name);
    expect(row?.competitionSlug).toBe(comp.slug);
    expect(row?.status).toBe("closed");
    expect(row?.teamCount).toBe(2);

    // The row and the case screen read the same fold — they cannot disagree.
    const detail = await caseView(deps, db, caseId);
    expect(row?.totalObligations).toBe(detail?.financial.totalObligations);
    expect(row?.discharged).toBe(detail?.financial.discharged);
    expect(row?.waived).toBe(detail?.financial.waived);
    expect(row?.outstanding).toBe(detail?.financial.outstanding);
  });

  it("reports stats a desk acts on", async () => {
    const view = await dashboardView(deps, db, org.id);
    expect(view.stats.closed).toBe(1);
    expect(view.stats.attention).toBe(0);
    expect(view.stats.outstanding).toBe(0);
    expect(view.stats.collectedToday).toBe(KINGS_DUE);
    expect(view.stats.collectedTodayCount).toBe(2);
  });

  it("never leaks another org's cases", async () => {
    const other = await createOrg(db, outsider, `Other ${RUN}`);
    const view = await dashboardView(deps, db, other.id);
    expect(view.cases).toEqual([]);
    await db.delete(orgMembers).where(eq(orgMembers.orgId, other.id));
    await db.delete(organizations).where(eq(organizations.id, other.id));
  });
});

// ============================================================================
describe("PX-7 · Search & saved views — filtering narrows, never invents", () => {
  const rows = [
    {
      caseId: "01CASEKINGS",
      status: "settling" as const,
      basis: "committed" as const,
      competitionId: "c1",
      competitionName: "Mumbai Premier League",
      competitionSlug: "mumbai-premier-league",
      teamCount: 2,
      totalObligations: 1000,
      discharged: 400,
      waived: 0,
      outstanding: 600,
      needsAttention: true,
      closedAtSeq: null,
      openedAt: "2026-07-01T00:00:00.000Z",
    },
    {
      caseId: "01CASECLOSED",
      status: "closed" as const,
      basis: "fixed" as const,
      competitionId: "c2",
      competitionName: "Pune Cup",
      competitionSlug: "pune-cup",
      teamCount: 4,
      totalObligations: 2000,
      discharged: 2000,
      waived: 0,
      outstanding: 0,
      needsAttention: false,
      closedAtSeq: 12,
      openedAt: "2026-06-01T00:00:00.000Z",
    },
  ];

  it("defaults every saved view to a real key", () => {
    for (const view of SAVED_VIEWS) {
      expect(isSavedView(view.key)).toBe(true);
    }
    expect(isSavedView("nonsense")).toBe(false);
  });

  it("filters by saved view", () => {
    expect(filterCases(rows, "attention", "", "").map((row) => row.caseId)).toEqual([
      "01CASEKINGS",
    ]);
    expect(filterCases(rows, "outstanding", "", "").map((row) => row.caseId)).toEqual([
      "01CASEKINGS",
    ]);
    expect(filterCases(rows, "closed", "", "").map((row) => row.caseId)).toEqual(["01CASECLOSED"]);
    expect(filterCases(rows, "all", "", "")).toHaveLength(2);
  });

  it("filters by status independently of the saved view", () => {
    expect(filterCases(rows, "all", "closed", "")).toHaveLength(1);
    expect(filterCases(rows, "all", "settling", "")).toHaveLength(1);
    expect(filterCases(rows, "all", "voided", "")).toHaveLength(0);
  });

  it("searches the competition, the slug, the case reference and the status word", () => {
    expect(filterCases(rows, "all", "", "mumbai")).toHaveLength(1);
    expect(filterCases(rows, "all", "", "PUNE-CUP")).toHaveLength(1);
    expect(filterCases(rows, "all", "", "01CASECLOSED")).toHaveLength(1);
    // "Reconciled" is the word on screen for `closed` — search must find it.
    expect(filterCases(rows, "all", "", "reconciled").map((row) => row.caseId)).toEqual([
      "01CASECLOSED",
    ]);
    expect(filterCases(rows, "all", "", "collecting").map((row) => row.caseId)).toEqual([
      "01CASEKINGS",
    ]);
    expect(filterCases(rows, "all", "", "nothing-matches")).toHaveLength(0);
  });

  it("ignores surrounding whitespace and case", () => {
    expect(filterCases(rows, "all", "", "   Mumbai   ")).toHaveLength(1);
  });

  it("resolves the case-review tab from the URL, and falls back rather than breaking", () => {
    // REGRESSION (PX-7): this list once lived in the "use client" panel, so the
    // server component imported a client-reference PROXY and `.includes` threw
    // at request time — but only when `?tab=` was present, because `&&`
    // short-circuited it away otherwise. It stays in a plain module for good.
    expect(CASE_REVIEW_TABS).toBeInstanceOf(Array);
    for (const tab of CASE_REVIEW_TABS) {
      expect(caseTabFrom(tab)).toBe(tab);
    }
    expect(caseTabFrom(undefined)).toBe(DEFAULT_CASE_TAB);
    expect(caseTabFrom("nonsense")).toBe(DEFAULT_CASE_TAB);
    expect(caseTabFrom("")).toBe(DEFAULT_CASE_TAB);
    expect(CASE_REVIEW_TABS).toContain(DEFAULT_CASE_TAB);
  });

  it("labels every status the machine can reach", () => {
    for (const status of [
      "opened",
      "verified",
      "discrepant",
      "settling",
      "settled",
      "closed",
      "voided",
    ]) {
      expect(CASE_STATUS_LABEL[status]).toBeDefined();
    }
  });
});

// ============================================================================
describe("PX-7 · A voided case", () => {
  it("opens a second case on a fresh auction and voids it before money moves", async () => {
    // A voided case never blocks a fresh attempt — but it must be voidable only
    // while it is clean, which the earlier ATTACK proved for a paid case.
    const secondComp = await createCompetition(db, org.id, owner, {
      name: `Void ${RUN}`,
      location: "Nashik",
      startsOn: "2026-10-01",
      endsOn: "2026-10-20",
    });
    // AuctionReady demands two teams and a non-empty approved pool.
    const voidTeams: string[] = [];
    for (const name of ["Voiders", "Nullers"]) {
      const team = await createTeam(db, org.id, secondComp.id, owner, name);
      if (!team.ok) {
        throw new Error("team");
      }
      voidTeams.push(team.team.id);
    }
    await advanceCompetition(db, await reload(secondComp.slug), owner, "setup");
    await advanceCompetition(db, await reload(secondComp.slug), owner, "registration_open");

    const personId = newId();
    await db
      .insert(people)
      .values({ id: personId, phone: `${SEED_PHONE_PREFIX}v01`, name: "Void One" });
    const regId = newId();
    await db.insert(registrationsTable).values({
      id: regId,
      orgId: org.id,
      competitionId: secondComp.id,
      personId,
      role: "batter",
      status: "approved",
      registrationNumber: registrationNumber(regId),
      basePriceBand: "B",
    });
    await advanceCompetition(db, await reload(secondComp.slug), owner, "registration_closed");
    const closed = await reload(secondComp.slug);

    const ready = await auctionReady(db, closed);
    const created = await createAuction(db, closed, ready, owner, DEFAULT_AUCTION_CONFIG);
    if (!created.ok) {
      throw new Error(`createAuction: ${created.reason}`);
    }
    const secondAuction = (await auctionOf(db, secondComp.id)) as AuctionRecord;
    // Opening needs ≥2 paddles and ≥1 queued lot; completing needs zero
    // unresolved lots. Nothing is sold — the case must open with nothing owed.
    for (const teamId of voidTeams) {
      const issued = await issuePaddle(db, secondAuction, owner, teamId, owner);
      if (!issued.ok) {
        throw new Error(`issuePaddle: ${issued.reason}`);
      }
    }
    await queueAllLots(db, secondAuction, owner);
    const openedAuction = await transitionAuction(db, secondAuction, owner, "open");
    if (!openedAuction.ok) {
      throw new Error(`open: ${openedAuction.reason}`);
    }
    const live = (await auctionOf(db, secondComp.id)) as AuctionRecord;
    const completed = await transitionAuction(
      db,
      live,
      owner,
      "complete",
      undefined,
      /* squads are deliberately tiny in this fixture — override DA-06 */ true,
    );
    if (!completed.ok) {
      throw new Error(`complete: ${completed.reason}`);
    }

    const opened = await openCase(deps, officerActor, {
      commandId: newId(),
      auctionId: secondAuction.id,
      basis: "committed",
    });
    expect(opened.ok).toBe(true);
    if (!opened.ok) {
      return;
    }

    // Void needs a REASON and the override capability.
    expect((await voidCase(deps, officerActor, opened.caseId, newId(), "no")).ok).toBe(false);
    const voided = await voidCase(
      deps,
      controllerActor,
      opened.caseId,
      newId(),
      "Auction abandoned; rerunning next week",
    );
    expect(voided.ok).toBe(true);

    const view = await caseView(deps, db, opened.caseId);
    expect(view?.status).toBe("voided");
    expect(view?.overlay.reconciled).toBe(false);

    // A voided case is terminal: nothing further is legal from it.
    expect((await verifyCase(deps, officerActor, opened.caseId, newId())).ok).toBe(false);
    expect((await computeCaseObligations(deps, officerActor, opened.caseId, newId())).ok).toBe(
      false,
    );
    expect((await reopenCase(deps, controllerActor, opened.caseId, newId(), "x")).ok).toBe(false);
  }, 60_000);
});
