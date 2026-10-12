// Actual settlement actions, canonical writes, current grants and production-role reads.
// Only request identity/cache APIs are supplied by the harness; no writer/store/authz mocks.
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
  createDb,
  newId,
  orgMembers,
  otpCodes,
  otpInbox,
  people,
  registrations as registrationsTable,
  sessions,
  settlementEvents,
  journalPostings,
  type DbHandle,
} from "@desiauction/db";
import { eq, inArray, like } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { env } from "../../env";
import type { FinancialIntent } from "../../lib/financial-intent";
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
import { derivedId } from "../derived-id";
import { dbHandle, systemHandle } from "../db";
import { purgeOrg } from "../test-support/purge-org";
import { issueSettlementGrant, revokeSettlementGrant, settlementActor } from "./authz";
import { settlementDeps, type SettlementDeps } from "./deps";
import { computeCaseObligations, openCase, verifyCase, type SettlementActor } from "./writer";
import {
  attestCaptureAction,
  recordPaymentAction,
  refundPaymentAction,
  reviewFinancialIntentAction,
  waiveObligationAction,
} from "./actions";

const session = vi.hoisted(() => ({ personId: "" }));
vi.mock("../auth/actions", () => ({
  currentSession: () => Promise.resolve({ personId: session.personId }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("next/headers", () => ({ headers: () => Promise.resolve(new Headers()) }));
vi.mock("../db", async () => {
  const { createDb } = await import("@desiauction/db");
  const { env } = await import("../../env");
  if (!env.APP_DATABASE_URL || !env.SYSTEM_DATABASE_URL)
    throw new Error("Explicit app/system URLs required");
  const dbHandle = createDb(env.APP_DATABASE_URL);
  const systemHandle = createDb(env.SYSTEM_DATABASE_URL);
  return { dbHandle, db: dbHandle.db, systemHandle, systemDb: systemHandle.db };
});
const handle: DbHandle = createDb(env.DATABASE_URL);
const db = handle.db;
const sender = new DevInboxSender(db);

const RUN = String(Date.now()).slice(-7);
const PHONE_OWNER = `+9168${RUN}1`;
const PHONE_OFFICER = `+9167${RUN}2`;
const PHONE_CONTROLLER = `+9166${RUN}3`;
const PHONE_OUTSIDER = `+9165${RUN}4`;
const TEST_PHONES = [PHONE_OWNER, PHONE_OFFICER, PHONE_CONTROLLER, PHONE_OUTSIDER];
const SEED_PHONE_PREFIX = `+91934${RUN}`;

// Band A base = ₹50,000; band B base = ₹25,000 (DEFAULT_AUCTION_CONFIG).
const SALE_A = 5_000_000;
const SALE_B = 2_500_000;

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
let controllerActor: SettlementActor;
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

beforeAll(async () => {
  owner = await login(PHONE_OWNER);
  officer = await login(PHONE_OFFICER);
  controller = await login(PHONE_CONTROLLER);
  outsider = await login(PHONE_OUTSIDER);

  org = await createOrg(db, owner, `Intent ${RUN}`);
  comp = await createCompetition(db, org.id, owner, {
    sport: "cricket",
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
  controllerActor = await settlementActor(db, controller, org.id);
  await db.insert(orgMembers).values([
    { orgId: org.id, personId: officer },
    { orgId: org.id, personId: controller },
  ]);
  controllerGrant = asController.grantId;
  const opened = await openCase(deps, controllerActor, {
    commandId: newId(),
    auctionId: auction.id,
    basis: "committed",
  });
  if (!opened.ok) throw new Error("case");
  caseId = opened.caseId;
  if (!(await verifyCase(deps, controllerActor, caseId, newId())).ok) throw new Error("verify");
  if (!(await computeCaseObligations(deps, controllerActor, caseId, newId())).ok)
    throw new Error("compute");
  session.personId = controller;
}, 120_000);

afterAll(async () => {
  if (org.id) await purgeOrg(db, org.id);
  await db.delete(otpCodes).where(inArray(otpCodes.phone, TEST_PHONES));
  await db.delete(otpInbox).where(inArray(otpInbox.phone, TEST_PHONES));
  await db
    .delete(sessions)
    .where(inArray(sessions.personId, [owner, officer, controller, outsider]));
  await db.delete(people).where(inArray(people.phone, TEST_PHONES));
  await db.delete(people).where(like(people.phone, `${SEED_PHONE_PREFIX}%`));
  await Promise.all([
    handle.sql.end({ timeout: 5 }),
    dbHandle.sql.end({ timeout: 5 }),
    systemHandle.sql.end({ timeout: 5 }),
  ]);
}, 60_000);

function intent(overrides: Partial<FinancialIntent> = {}): FinancialIntent {
  return {
    key: "original-payment",
    actorId: controller,
    orgId: org.id,
    caseId,
    targetId: kings(),
    kind: "payment",
    amount: "1000.01",
    method: "manual:cash",
    reason: "",
    ...overrides,
  };
}
async function evidence() {
  return {
    events: await db
      .select()
      .from(settlementEvents)
      .where(eq(settlementEvents.orgId, org.id))
      .orderBy(settlementEvents.id),
    postings: await db
      .select()
      .from(journalPostings)
      .where(eq(journalPostings.orgId, org.id))
      .orderBy(journalPostings.id),
  };
}
let paymentId = "";
let controllerGrant = "";
describe("E11 exact financial review", () => {
  it("runs as the restricted application role and leaves an absent command unknown without writes", async () => {
    const roles = await dbHandle.sql<
      { rolsuper: boolean; rolbypassrls: boolean }[]
    >`select rolsuper,rolbypassrls from pg_roles where rolname=current_user`;
    expect(roles).toEqual([{ rolsuper: false, rolbypassrls: false }]);
    const before = await evidence();
    expect(await reviewFinancialIntentAction(comp.slug, intent())).toEqual({ outcome: "unknown" });
    expect(await evidence()).toEqual(before);
  });
  it("attributes a committed payment to its exact original key and permits a genuinely identical second payment", async () => {
    const original = intent();
    expect(
      await recordPaymentAction(
        comp.slug,
        caseId,
        kings(),
        original.method,
        original.amount,
        original.key,
      ),
    ).toMatchObject({ ok: true });
    const command = `createPayment:${caseId}:${kings()}:manual:cash:100001:${original.key}`;
    paymentId = derivedId(command);
    const event = await deps.store.findByCommandId("payment", paymentId, command);
    if (!event) throw new Error("canonical payment");
    const before = await evidence();
    expect(await reviewFinancialIntentAction(comp.slug, original)).toEqual({
      outcome: "accepted",
      seq: event.seq,
    });
    expect(
      await reviewFinancialIntentAction(comp.slug, intent({ key: "different-unanswered-key" })),
    ).toEqual({ outcome: "unknown" });
    expect(await evidence()).toEqual(before);
    expect(
      await recordPaymentAction(
        comp.slug,
        caseId,
        kings(),
        original.method,
        original.amount,
        original.key,
      ),
    ).toMatchObject({ ok: true });
    expect(await evidence()).toEqual(before);
    expect(
      await recordPaymentAction(
        comp.slug,
        caseId,
        kings(),
        original.method,
        original.amount,
        "deliberate-second",
      ),
    ).toMatchObject({ ok: true });
    const after = await evidence();
    expect(after.events.filter((e) => e.type === "PaymentInitiated")).toHaveLength(2);
    expect(after.postings).toHaveLength(before.postings.length);
    expect(
      await reviewFinancialIntentAction(comp.slug, intent({ key: "deliberate-second" })),
    ).toMatchObject({ outcome: "accepted" });
  });
  it("never attributes by matching amount or time, and rejects actor/org/case/method/malformed or gateway scope", async () => {
    const before = await evidence();
    for (const changed of [
      { amount: "1000.02" },
      { targetId: chargers() },
      { method: "manual:bank" },
    ])
      expect(await reviewFinancialIntentAction(comp.slug, intent(changed))).toEqual({
        outcome: "unknown",
      });
    for (const changed of [
      { actorId: officer },
      { orgId: newId() },
      { caseId: newId() },
      { method: "gateway:razorpay" },
      { key: "invalid key" },
      { amount: "1.005" },
    ])
      expect(await reviewFinancialIntentAction(comp.slug, intent(changed))).toEqual({
        outcome: "unavailable",
      });
    expect(await evidence()).toEqual(before);
  });
  it("reviews partial refund and waiver only with their immutable exact reason/target/amount and keeps posting counts stable", async () => {
    expect(await attestCaptureAction(comp.slug, paymentId)).toMatchObject({ ok: true });
    const refund = intent({
      key: "partial-refund",
      kind: "refund",
      targetId: paymentId,
      amount: "100.01",
      reason: "Cash returned",
    });
    expect(
      await refundPaymentAction(comp.slug, paymentId, refund.amount, refund.reason, refund.key),
    ).toMatchObject({ ok: true });
    const waiver = intent({
      key: "partial-waiver",
      kind: "waiver",
      targetId: chargers(),
      amount: "250.01",
      reason: "Club concession",
      method: "",
    });
    expect(
      await waiveObligationAction(
        comp.slug,
        caseId,
        chargers(),
        waiver.amount,
        waiver.reason,
        waiver.key,
      ),
    ).toMatchObject({ ok: true });
    const before = await evidence();
    for (const original of [refund, waiver]) {
      expect(await reviewFinancialIntentAction(comp.slug, original)).toMatchObject({
        outcome: "accepted",
      });
      expect(
        await reviewFinancialIntentAction(comp.slug, { ...original, reason: "Different reason" }),
      ).toEqual({ outcome: "unavailable" });
      expect(await reviewFinancialIntentAction(comp.slug, { ...original, amount: "1.00" })).toEqual(
        { outcome: "unknown" },
      );
    }
    expect(await reviewFinancialIntentAction(comp.slug, { ...refund, targetId: newId() })).toEqual({
      outcome: "unavailable",
    });
    expect(
      await refundPaymentAction(comp.slug, paymentId, refund.amount, refund.reason, refund.key),
    ).toMatchObject({ ok: true });
    expect(
      await waiveObligationAction(
        comp.slug,
        caseId,
        chargers(),
        waiver.amount,
        waiver.reason,
        waiver.key,
      ),
    ).toMatchObject({ ok: true });
    expect(await evidence()).toEqual(before);
    expect(before.events.filter((e) => e.type === "PaymentRefunded")).toHaveLength(1);
    expect(before.events.filter((e) => e.type === "ObligationWaived")).toHaveLength(1);
  });
  it("uses current membership and operation grants, not stored intent or page authority", async () => {
    const before = await evidence();
    session.personId = officer;
    expect(await reviewFinancialIntentAction(comp.slug, intent())).toEqual({
      outcome: "unavailable",
    });
    expect(
      await reviewFinancialIntentAction(
        comp.slug,
        intent({
          actorId: officer,
          kind: "waiver",
          key: "partial-waiver",
          targetId: chargers(),
          amount: "250.01",
          reason: "Club concession",
        }),
      ),
    ).toEqual({ outcome: "unavailable" });
    session.personId = outsider;
    expect(await reviewFinancialIntentAction(comp.slug, intent({ actorId: outsider }))).toEqual({
      outcome: "unavailable",
    });
    session.personId = controller;
    expect((await revokeSettlementGrant(db, owner, org.id, controllerGrant)).ok).toBe(true);
    expect(await reviewFinancialIntentAction(comp.slug, intent())).toEqual({
      outcome: "unavailable",
    });
    expect(await evidence()).toEqual(before);
  });
});
